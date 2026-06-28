"""HTTP-to-graph bridge for the demo API service (spec 07).

The TypeScript Hono server spawns this script once per plan/session request. It
reuses the *verified* hero seam (``plan_flows/hero_flow.py``) over the
proven ``psql``-subprocess connection — there is no ``psycopg`` in this
environment, so the same adapter the hero gate uses is the reliable path.

Contract: each subcommand prints exactly one JSON envelope as its final stdout
line:

    {"ok": true,  "data": <result | null>}
    {"ok": false, "error": {"code": "validation|not_found|conflict", "message": ...}}

`data` is the view model defined in ``apps/api/src/plans/types.ts``. This script
owns the single DB→view projection so reads and writes never drift.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from schema.mutations import (  # noqa: E402
    ConcurrencyConflictError,
    CreatePlanRequest,
    CreatePlanStepRequest,
    MutationCommitError,
    MutationValidationError,
    RecordStateDependencyRequest,
    TransferPointsRequest,
    V31GraphWriteService,
)
from plan_flows.hero_flow import (  # noqa: E402
    BalanceTransferSpec,
    HeroPlanSnapshot,
    _plan_snapshot,
    create_direct_plan_from_query,
    create_plan_from_query,
    replan_after_balance_transfer,
)

DEMO_SEED_PATH = REPO_ROOT / "fixtures" / "demo-seed.json"
HYATT_DIRECT_FIXTURE_PATH = REPO_ROOT / "fixtures" / "person-c-hyatt-direct-seed.json"


class BridgeError(Exception):
    """Domain error mapped to an HTTP status by the TS caller."""

    def __init__(self, code: str, message: str) -> None:
        """Attach an HTTP-mappable error ``code`` to the exception message."""
        super().__init__(message)
        self.code = code


# --------------------------------------------------------------------------- #
# psql connection adapter (mirrors tests/integration/test_hero_moment.py)
# --------------------------------------------------------------------------- #


class _PsqlConnection:
    """Minimal connection shim so ``hero_flow`` can run over ``psql`` subprocesses."""

    def cursor(self) -> "_PsqlCursor":
        """Return a cursor that executes SQL via ``_psql_rows``."""
        return _PsqlCursor()


class _PsqlCursor:
    """Single-statement cursor: one ``execute`` → one ``fetchone`` result set."""

    def __init__(self) -> None:
        """Initialize with no pending result."""
        self.result: list[tuple[Any, ...]] | None = None

    def __enter__(self) -> "_PsqlCursor":
        """Enter a ``with`` block (no-op; satisfies the connection protocol)."""
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        """Exit a ``with`` block without suppressing exceptions."""
        return False

    def execute(self, sql: str, params: tuple[Any, ...] | None = None) -> None:
        """Run parameterized SQL and stash the first result set on this cursor."""
        self.result = _psql_rows(_format_psql_query(sql, params or ()))

    def fetchone(self) -> tuple[Any, ...] | None:
        """Return the first row of the last ``execute`` result, or ``None``."""
        if not self.result:
            return None
        return self.result[0]


def _psql_command(*extra: str) -> list[str]:
    """Build a ``psql`` argv list, appending ``DATABASE_URL`` when set."""
    command = ["psql", "--set", "ON_ERROR_STOP=1", "--quiet", *extra]
    database_url = os.environ.get("DATABASE_URL")
    if database_url:
        command.append(database_url)
    return command


def _psql_exec(sql: str) -> None:
    """Run a SQL script via ``psql``; raise ``RuntimeError`` on non-zero exit."""
    result = subprocess.run(
        _psql_command(),
        input=sql,
        env=os.environ.copy(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"psql failed: {result.stderr.strip() or result.stdout.strip()}")


def _psql_tx(statements: list[str]) -> None:
    """Run statements atomically in one transaction.

    A single `psql` process with ON_ERROR_STOP=1 aborts on the first failure, so
    the wrapping BEGIN/COMMIT never commits a partial result — the connection
    closes and Postgres rolls the transaction back.
    """
    body = ";\n".join(statement.strip().rstrip(";") for statement in statements)
    _psql_exec(f"BEGIN;\n{body};\nCOMMIT;")


# Marker psql prints for SQL NULL so we can keep it distinct from an empty
# string (both render blank otherwise). ASCII Group Separator, matching the
# control-char field/record separators below.
_PSQL_NULL = "\x1d"


def _psql_rows(sql: str) -> list[tuple[Any, ...]]:
    """Execute a read-only query and return all rows as typed Python tuples."""
    result = subprocess.run(
        _psql_command(
            "--no-align",
            "--tuples-only",
            f"--pset=null={_PSQL_NULL}",
            "--field-separator",
            "\x1f",
            "--record-separator",
            "\x1e",
        ),
        input=sql,
        env=os.environ.copy(),
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    # psql places the record separator BETWEEN rows and terminates output with a
    # single newline. So "" means zero rows, while a lone "\n" is one row with a
    # single empty-string column — do not conflate them, and never split away a
    # genuine trailing empty record.
    output = result.stdout
    if output == "":
        return []
    if output.endswith("\n"):
        output = output[:-1]
    return [
        tuple(
            None if value == _PSQL_NULL else _parse_psql_value(value)
            for value in row.split("\x1f")
        )
        for row in output.split("\x1e")
    ]


def _format_psql_query(sql: str, params: tuple[Any, ...]) -> str:
    """Interpolate ``%s`` placeholders with safely escaped ``psql`` literals.

    Splits on placeholders once and interleaves escaped values, so an escaped
    literal that itself contains ``%s`` can never be re-scanned and consume a
    later placeholder.
    """
    parts = sql.split("%s")
    if len(parts) != len(params) + 1:
        raise ValueError("SQL placeholder count does not match parameter count")

    formatted: list[str] = []
    for prefix, param in zip(parts[:-1], params):
        formatted.append(prefix)
        formatted.append(_psql_literal(param))
    formatted.append(parts[-1])
    return "".join(formatted)


def _psql_literal(value: Any) -> str:
    """Render a Python value as a Postgres literal for inline SQL."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, (dict, list)):
        escaped = json.dumps(value).replace("'", "''")
        return f"'{escaped}'"
    escaped = str(value).replace("'", "''")
    return f"'{escaped}'"


def _parse_psql_value(value: str) -> Any:
    """Decode a single ``psql`` text field (booleans, ints, or plain strings)."""
    # SQL NULL is decoded by the caller via the null sentinel, so a bare empty
    # string here is a genuine empty string, not NULL.
    if value == "t":
        return True
    if value == "f":
        return False
    if value.lstrip("-").isdigit():
        return int(value)
    return value


# --------------------------------------------------------------------------- #
# DB → view-model projection (single source of truth)
# --------------------------------------------------------------------------- #


def project_plan(user_id: str, plan_id: str) -> dict[str, Any] | None:
    """Project a ``plans`` row + steps into the spec-07 ``PlanView`` JSON shape."""
    header = _psql_rows(
        _format_psql_query(
            """
            SELECT plan_lineage_id, revision_number, status, query_text, summary
              FROM plans
             WHERE id = %s AND user_id = %s
            """,
            (plan_id, user_id),
        )
    )
    if not header:
        return None
    plan_lineage_id, revision_number, status, query_text, summary = header[0]

    step_rows = _psql_rows(
        _format_psql_query(
            """
            SELECT id, step_order, step_type, status,
                   payload::text, payload->>'action', payload->>'reasoning'
              FROM plan_steps
             WHERE plan_id = %s
             ORDER BY step_order
            """,
            (plan_id,),
        )
    )

    dependencies_by_step = _dependencies_by_step(plan_id)
    steps = []
    step_payloads: list[dict[str, Any]] = []
    for (
        step_id,
        step_order,
        step_type,
        status_value,
        payload_text,
        action,
        reasoning,
    ) in step_rows:
        payload = _json_object(payload_text)
        step_payloads.append(payload)
        dependencies = dependencies_by_step.get(str(step_id), [])
        steps.append(
            {
                "order": int(step_order),
                "type": step_type,
                "summary": action or "",
                "reasoning": reasoning or "",
                "status": status_value,
                "dependsOn": [dependency["id"] for dependency in dependencies],
                "dependencies": dependencies,
            }
        )

    return {
        "planId": str(plan_id),
        "planLineageId": str(plan_lineage_id),
        "revisionNumber": int(revision_number),
        "status": status,
        "query": query_text,
        "summary": summary,
        "steps": steps,
        "graph": _build_plan_graph(steps, step_payloads),
    }


def _dependencies_by_step(plan_id: str) -> dict[str, list[dict[str, Any]]]:
    """Map each plan-step id to typed dependency metadata for its graph reads."""
    rows = _psql_rows(
        _format_psql_query(
            """
            SELECT sd.plan_step_id,
                   sd.target_node_id,
                   sd.target_node_type,
                   sd.target_table,
                   sd.snapshot_value::text
              FROM state_dependencies sd
              JOIN plan_steps ps ON ps.id = sd.plan_step_id
             WHERE ps.plan_id = %s
             ORDER BY sd.plan_step_id
            """,
            (plan_id,),
        )
    )
    grouped: dict[str, list[dict[str, Any]]] = {}
    for (
        plan_step_id,
        target_node_id,
        target_node_type,
        target_table,
        snapshot_value,
    ) in rows:
        if target_node_id is None:
            continue
        grouped.setdefault(str(plan_step_id), []).append(
            _dependency_metadata(
                target_node_id=str(target_node_id),
                target_node_type=str(target_node_type),
                target_table=str(target_table),
                snapshot_value=_json_object(snapshot_value),
            )
        )
    return grouped


def _json_object(value: Any) -> dict[str, Any]:
    """Return a JSON object from a psql text field, or an empty object."""
    if isinstance(value, dict):
        return value
    if not isinstance(value, str) or not value:
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _dependency_metadata(
    *,
    target_node_id: str,
    target_node_type: str,
    target_table: str,
    snapshot_value: dict[str, Any],
) -> dict[str, Any]:
    """Resolve a polymorphic dependency id to typed display metadata."""
    if target_table == "user_balances":
        rows = _psql_rows(
            _format_psql_query(
                """
                SELECT rp.id, rp.slug, rp.name
                  FROM user_balances ub
                  JOIN reward_programs rp ON rp.id = ub.program_id
                 WHERE ub.id = %s
                """,
                (target_node_id,),
            )
        )
        if rows:
            program_id, slug, label = rows[0]
            return _dependency_view(
                target_node_id,
                target_node_type,
                target_table,
                str(slug),
                str(label),
                str(program_id),
            )
        slug = str(snapshot_value.get("program_slug") or target_node_id)
        return _dependency_view(
            target_node_id,
            target_node_type,
            target_table,
            slug,
            _label_from_slug(slug),
            None,
        )

    if target_table == "user_program_statuses":
        rows = _psql_rows(
            _format_psql_query(
                """
                SELECT rp.id, rp.slug, rp.name
                  FROM user_program_statuses ups
                  JOIN reward_programs rp ON rp.id = ups.program_id
                 WHERE ups.id = %s
                """,
                (target_node_id,),
            )
        )
        if rows:
            program_id, slug, label = rows[0]
            return _dependency_view(
                target_node_id,
                target_node_type,
                target_table,
                str(slug),
                str(label),
                str(program_id),
            )

    if target_table == "reward_programs":
        rows = _psql_rows(
            _format_psql_query(
                "SELECT id, slug, name FROM reward_programs WHERE id = %s",
                (target_node_id,),
            )
        )
        if rows:
            program_id, slug, label = rows[0]
            return _dependency_view(
                target_node_id,
                target_node_type,
                target_table,
                str(slug),
                str(label),
                str(program_id),
            )

    if target_table == "transfers_to":
        rows = _psql_rows(
            _format_psql_query(
                """
                SELECT src.slug, src.name, dest.id, dest.slug, dest.name
                  FROM transfers_to route
                  JOIN reward_programs src ON src.id = route.source_program_id
                  JOIN reward_programs dest ON dest.id = route.dest_program_id
                 WHERE route.id = %s
                """,
                (target_node_id,),
            )
        )
        if rows:
            src_slug, src_name, dest_id, dest_slug, dest_name = rows[0]
            slug = _transfer_slug(str(src_slug), str(dest_slug))
            label = f"{src_name} -> {dest_name}"
            return _dependency_view(
                target_node_id,
                target_node_type,
                target_table,
                slug,
                label,
                str(dest_id),
            )

    if target_table == "redemption_options":
        rows = _psql_rows(
            _format_psql_query(
                """
                SELECT ro.program_id,
                       rp.slug,
                       COALESCE(ro.description, rp.name)
                  FROM redemption_options ro
                  JOIN reward_programs rp ON rp.id = ro.program_id
                 WHERE ro.id = %s
                """,
                (target_node_id,),
            )
        )
        if rows:
            program_id, program_slug, label = rows[0]
            return _dependency_view(
                target_node_id,
                target_node_type,
                target_table,
                f"redemption:{target_node_id}",
                str(label),
                str(program_id),
                program_slug=str(program_slug),
            )

    return _dependency_view(
        target_node_id,
        target_node_type,
        target_table,
        str(snapshot_value.get("slug") or target_node_id),
        str(snapshot_value.get("label") or _label_from_slug(target_node_type)),
        None,
    )


def _dependency_view(
    target_node_id: str,
    target_node_type: str,
    target_table: str,
    slug: str,
    label: str,
    program_id: str | None,
    *,
    program_slug: str | None = None,
) -> dict[str, Any]:
    view = {
        "id": target_node_id,
        "kind": target_node_type,
        "table": target_table,
        "slug": slug,
        "label": label,
        "programId": program_id,
    }
    if program_slug is not None:
        view["programSlug"] = program_slug
    return view


def _build_plan_graph(
    steps: list[dict[str, Any]],
    step_payloads: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """Build the typed traversal projection consumed by the database-less web tier."""
    nodes: dict[str, dict[str, Any]] = {}
    edges: dict[str, dict[str, Any]] = {}
    last_dest_program_slug: str | None = None

    for step, payload in zip(steps, step_payloads, strict=True):
        for dependency in step["dependencies"]:
            if dependency["slug"].startswith("program:"):
                _add_program_node(
                    nodes,
                    dependency["slug"],
                    label=dependency["label"],
                    program_id=dependency["programId"],
                )

        planner_payload = payload.get("planner_payload")
        planner = planner_payload if isinstance(planner_payload, dict) else {}
        candidate_fact_slugs = planner.get("candidate_fact_slugs") or []
        candidate_slugs = [
            slug
            for slug in candidate_fact_slugs
            if isinstance(slug, str)
        ]
        candidate_transfer = next(
            (slug for slug in candidate_slugs if slug.startswith("transfer:")),
            None,
        )

        source_slug = _string_or_none(planner.get("source_program_slug"))
        dest_slug = _string_or_none(planner.get("dest_program_slug"))
        if source_slug is None or dest_slug is None:
            parsed_source, parsed_dest = _parse_transfer_slug(candidate_transfer)
            source_slug = source_slug or parsed_source
            dest_slug = dest_slug or parsed_dest

        if source_slug is not None:
            _add_program_node(nodes, source_slug)
        if dest_slug is not None:
            _add_program_node(nodes, dest_slug)
            last_dest_program_slug = dest_slug

        if (
            step["type"] == "transfer_recommendation"
            and source_slug is not None
            and dest_slug is not None
        ):
            edge_id = candidate_transfer or _transfer_slug(source_slug, dest_slug)
            edges[edge_id] = {
                "id": edge_id,
                "from": source_slug,
                "to": dest_slug,
                "kind": "transfer",
            }

        award_slug = _string_or_none(planner.get("award_slug"))
        if award_slug is None:
            award_slug = next(
                (slug for slug in candidate_slugs if slug.startswith("award:")),
                None,
            )
        if award_slug is None:
            continue

        program_slug = dest_slug or last_dest_program_slug or _program_slug_from_dependencies(
            step["dependencies"]
        )
        if program_slug is None:
            continue
        _add_program_node(nodes, program_slug)

        award_label = _string_or_none(planner.get("hotel_name")) or step["summary"]
        nodes[award_slug] = {
            "id": award_slug,
            "kind": "redemption",
            "slug": award_slug,
            "label": award_label,
            "programId": _program_id_for_slug(program_slug),
        }
        edge_id = f"redeem:{program_slug}->{award_slug}"
        edges[edge_id] = {
            "id": edge_id,
            "from": program_slug,
            "to": award_slug,
            "kind": "redeem",
        }

    return {"nodes": list(nodes.values()), "edges": list(edges.values())}


def _add_program_node(
    nodes: dict[str, dict[str, Any]],
    slug: str,
    *,
    label: str | None = None,
    program_id: str | None = None,
) -> None:
    if slug in nodes:
        if label and nodes[slug].get("label") == _label_from_slug(slug):
            nodes[slug]["label"] = label
        if program_id and nodes[slug].get("programId") is None:
            nodes[slug]["programId"] = program_id
        return

    program = _program_by_slug(slug)
    nodes[slug] = {
        "id": slug,
        "kind": "program",
        "slug": slug,
        "label": label or program.get("label") or _label_from_slug(slug),
        "programId": program_id or program.get("programId"),
    }


def _program_by_slug(slug: str) -> dict[str, str | None]:
    rows = _psql_rows(
        _format_psql_query(
            "SELECT id, name FROM reward_programs WHERE slug = %s",
            (slug,),
        )
    )
    if not rows:
        return {"programId": None, "label": None}
    program_id, label = rows[0]
    return {"programId": str(program_id), "label": str(label)}


def _program_id_for_slug(slug: str) -> str | None:
    return _program_by_slug(slug).get("programId")


def _program_slug_from_dependencies(
    dependencies: list[dict[str, Any]],
) -> str | None:
    for dependency in dependencies:
        slug = dependency.get("slug")
        if isinstance(slug, str) and slug.startswith("program:"):
            return slug
        program_slug = dependency.get("programSlug")
        if isinstance(program_slug, str) and program_slug.startswith("program:"):
            return program_slug
    return None


def _parse_transfer_slug(slug: str | None) -> tuple[str | None, str | None]:
    if not slug or not slug.startswith("transfer:"):
        return None, None
    parts = slug.split(":")
    if len(parts) != 3:
        return None, None
    return f"program:{parts[1]}", f"program:{parts[2]}"


def _transfer_slug(source_slug: str, dest_slug: str) -> str:
    return f"transfer:{_strip_prefix(source_slug)}:{_strip_prefix(dest_slug)}"


def _strip_prefix(slug: str) -> str:
    return slug.split(":", 1)[1] if ":" in slug else slug


def _string_or_none(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _label_from_slug(slug: str) -> str:
    tail = _strip_prefix(slug)
    return tail.replace("_", " ").replace("-", " ").title()


def resolve_balance(user_id: str, program_id: str) -> tuple[str, int]:
    """Return ``(balance_id, version)`` for a user's program balance row."""
    rows = _psql_rows(
        _format_psql_query(
            """
            SELECT id, version
              FROM user_balances
             WHERE user_id = %s AND program_id = %s
            """,
            (user_id, program_id),
        )
    )
    if not rows:
        raise BridgeError("not_found", f"no balance for program {program_id}")
    balance_id, version = rows[0]
    return str(balance_id), int(version)


def current_plan_id_for_user(user_id: str) -> str | None:
    """Return the user's newest ``plans.status = 'current'`` row id, if any."""
    rows = _psql_rows(
        _format_psql_query(
            """
            SELECT id
              FROM plans
             WHERE user_id = %s AND status = 'current'
             ORDER BY updated_at DESC
             LIMIT 1
            """,
            (user_id,),
        )
    )
    return str(rows[0][0]) if rows else None


# --------------------------------------------------------------------------- #
# command handlers
# --------------------------------------------------------------------------- #


def do_session(
    *,
    user_id: str | None = None,
    clerk_id: str | None = None,
    email: str | None = None,
) -> dict[str, Any]:
    """Resolve the caller, bootstrapping a fresh persona for a new Clerk user.

    Two identity paths: an already-resolved `user_id` (existing row / dev
    bypass) reads the row as-is; a `clerk_id` with no matching row triggers an
    idempotent persona clone on first login.
    """

    if user_id:
        rows = _psql_rows(
            _format_psql_query(
                "SELECT clerk_id FROM users WHERE id = %s",
                (user_id,),
            )
        )
        if not rows:
            raise BridgeError("not_found", f"user not found: {user_id}")
        _ensure_persona_seeded(user_id)
        return {"userId": user_id, "clerkId": rows[0][0], "seeded": True}

    if clerk_id:
        resolved_id = ensure_user_by_clerk_id(clerk_id, email)
        return {"userId": resolved_id, "clerkId": clerk_id, "seeded": True}

    raise BridgeError("validation", "session requires user-id or clerk-id")


def ensure_user_by_clerk_id(clerk_id: str, email: str | None) -> str:
    """Return the user id for a Clerk subject, cloning the seed persona if new.

    The user row and its persona clone are written in a single transaction so a
    failure can never leave a half-seeded user. A pre-existing row (including the
    winner of a concurrent first-login race) is verified complete and repaired
    if an older partial seed is found.
    """

    rows = _psql_rows(
        _format_psql_query(
            "SELECT id FROM users WHERE clerk_id = %s",
            (clerk_id,),
        )
    )
    if rows:
        existing_id = str(rows[0][0])
        _ensure_persona_seeded(existing_id)
        return existing_id

    new_user_id = str(uuid.uuid4())
    insert_user = _format_psql_query(
        "INSERT INTO users (id, clerk_id, email) VALUES (%s, %s, %s)",
        (new_user_id, clerk_id, email),
    )
    try:
        _psql_tx([insert_user, *_persona_clone_statements(new_user_id)])
    except RuntimeError as exc:
        # Concurrent first-login requests can race on users.clerk_id UNIQUE.
        if "duplicate key" not in str(exc).lower():
            raise
        rows = _psql_rows(
            _format_psql_query(
                "SELECT id FROM users WHERE clerk_id = %s",
                (clerk_id,),
            )
        )
        if not rows:
            raise
        existing_id = str(rows[0][0])
        _ensure_persona_seeded(existing_id)
        return existing_id
    return new_user_id


def _ensure_persona_seeded(user_id: str) -> None:
    """Repair a user that predates atomic bootstrap and has no persona rows.

    Post-fix every bootstrap is atomic, so a complete persona is guaranteed; this
    only rebuilds a legacy half-seeded row. Delete-then-clone in one transaction
    keeps it idempotent regardless of the partial state found.
    """

    if _persona_is_complete(user_id):
        return
    _psql_tx(
        [*_persona_delete_statements(user_id), *_persona_clone_statements(user_id)]
    )


# Per-user persona tables the seed clone populates, FK-safe delete order.
_PERSONA_TABLES = (
    "user_balances",
    "user_program_statuses",
    "user_goals",
    "holds",
)


def _persona_is_complete(user_id: str) -> bool:
    """A persona is complete only if every table the seed populates is fully
    cloned. Checking just one table would miss a clone that failed partway."""

    seed = json.loads(DEMO_SEED_PATH.read_text(encoding="utf-8"))
    for table in _PERSONA_TABLES:
        expected = len(seed.get(table, []))
        if expected == 0:
            continue
        rows = _psql_rows(
            _format_psql_query(
                # table is from the fixed _PERSONA_TABLES tuple, never user input.
                f"SELECT count(*) FROM {table} WHERE user_id = %s",
                (user_id,),
            )
        )
        actual = int(rows[0][0]) if rows else 0
        if actual < expected:
            return False
    return True


def _persona_delete_statements(user_id: str) -> list[str]:
    """Clear any per-user persona rows before a re-clone, reverse of the seed
    order so foreign keys never block the delete."""

    return [
        # table is from the fixed _PERSONA_TABLES tuple, never user input.
        _format_psql_query(f"DELETE FROM {table} WHERE user_id = %s", (user_id,))
        for table in reversed(_PERSONA_TABLES)
    ]


def _persona_clone_statements(new_user_id: str) -> list[str]:
    """Build the INSERTs that copy the seed persona's per-user rows to a new user.

    World-tier rows (programs, cards, awards) are shared and referenced by the
    same ids, so only per-user nodes are cloned, each with a fresh row id. The
    statements are returned (not executed) so the caller can run them atomically.
    """

    seed = json.loads(DEMO_SEED_PATH.read_text(encoding="utf-8"))
    statements: list[str] = []

    for balance in seed.get("user_balances", []):
        statements.append(
            _format_psql_query(
                """
                INSERT INTO user_balances
                  (id, user_id, program_id, balance_points, source, version)
                VALUES (%s, %s, %s, %s, %s, 1)
                """,
                (
                    str(uuid.uuid4()),
                    new_user_id,
                    balance["program_id"],
                    balance["balance_points"],
                    balance.get("source", "manual_entry"),
                ),
            )
        )

    for status in seed.get("user_program_statuses", []):
        statements.append(
            _format_psql_query(
                """
                INSERT INTO user_program_statuses
                  (id, user_id, program_id, status_tier, status_payload, version)
                VALUES (%s, %s, %s, %s, %s, 1)
                """,
                (
                    str(uuid.uuid4()),
                    new_user_id,
                    status["program_id"],
                    status["status_tier"],
                    status.get("status_payload", {}),
                ),
            )
        )

    for goal in seed.get("user_goals", []):
        statements.append(
            _format_psql_query(
                """
                INSERT INTO user_goals
                  (id, user_id, goal_type, description, target_program_id,
                   target_location, target_date, payload)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    str(uuid.uuid4()),
                    new_user_id,
                    goal["goal_type"],
                    goal["description"],
                    goal.get("target_program_id"),
                    goal.get("target_location"),
                    goal.get("target_date"),
                    goal.get("payload", {}),
                ),
            )
        )

    for hold in seed.get("holds", []):
        statements.append(
            _format_psql_query(
                """
                INSERT INTO holds
                  (id, user_id, credit_card_id, opened_date, is_primary)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    str(uuid.uuid4()),
                    new_user_id,
                    hold["credit_card_id"],
                    hold.get("opened_date"),
                    hold.get("is_primary", False),
                ),
            )
        )

    return statements


def do_demo_reset(user_id: str) -> dict[str, Any]:
    """Reset the demo persona to its seed state — scoped to ``user_id`` only.

    Clears the FULL execution trail so a repeated identical transfer creates a
    fresh mutation + replan job instead of replaying an earlier idempotent
    result. plan_steps and state_dependencies are removed via the plans cascade;
    replan_jobs (no cascade), idempotency_records (no plan FK) and agent_runs
    (plan_id ON DELETE SET NULL, so they survive a plans delete and accumulate)
    are deleted explicitly by user_id. Balances are restored to seed at
    version 1. Never touches other users or benchmark state.
    """
    session = do_session(user_id=user_id)
    _psql_exec(
        _format_psql_query(
            """
            DELETE FROM replan_jobs WHERE user_id = %s;
            DELETE FROM idempotency_records WHERE user_id = %s;
            DELETE FROM agent_runs WHERE user_id = %s;
            DELETE FROM graph_mutations WHERE user_id = %s;
            DELETE FROM plans WHERE user_id = %s;
            """,
            (user_id, user_id, user_id, user_id, user_id),
        )
    )
    _reset_seed_balances(user_id)
    return session


def _reset_seed_balances(user_id: str) -> None:
    """Overwrite the user's balance rows with the values from ``demo-seed.json``."""
    seed = json.loads(DEMO_SEED_PATH.read_text(encoding="utf-8"))
    for balance in seed.get("user_balances", []):
        _psql_exec(
            _format_psql_query(
                """
                UPDATE user_balances
                   SET balance_points = %s, version = 1, updated_at = now()
                 WHERE user_id = %s AND program_id = %s
                """,
                (balance["balance_points"], user_id, balance["program_id"]),
            )
        )


def do_create_plan(user_id: str, query: str, card_slugs: list[str] | None = None) -> dict[str, Any]:
    """Run the hero planner and return the projected ``PlanView`` for revision 1.

    Routes to the World of Hyatt direct-redemption path when ``card:world_of_hyatt``
    is in ``card_slugs``; otherwise uses the Chase UR transfer path.
    """
    connection = _PsqlConnection()
    if card_slugs and "card:world_of_hyatt" in card_slugs:
        snapshot = create_direct_plan_from_query(connection, user_id=user_id, query_text=query)
    else:
        snapshot = create_plan_from_query(connection, user_id=user_id, query_text=query)
    plan = project_plan(user_id, snapshot.plan_id)
    if plan is None:
        raise BridgeError("not_found", "plan vanished after create")
    return plan


def do_get_plan(user_id: str, plan_id: str) -> dict[str, Any] | None:
    """Fetch a single plan by id, or ``None`` when the row is missing."""
    return project_plan(user_id, plan_id)


def do_current_plan(user_id: str, lineage_id: str) -> dict[str, Any] | None:
    """Return the current revision in a plan lineage, or ``None`` if none is current."""
    rows = _psql_rows(
        _format_psql_query(
            """
            SELECT id
              FROM plans
             WHERE user_id = %s
               AND plan_lineage_id = %s
               AND status = 'current'
             LIMIT 1
            """,
            (user_id, lineage_id),
        )
    )
    if not rows:
        return None
    return project_plan(user_id, str(rows[0][0]))


def _resolve_balance_transfer(
    user_id: str,
    source_program_id: str,
    dest_program_id: str,
    amount_points: int,
    idempotency_key: str | None,
) -> tuple[Any, HeroPlanSnapshot, BalanceTransferSpec]:
    """Resolve balances, the prior current plan, and a stable transfer spec.

    Shared by the legacy (``balance-transfer``) and orchestrator
    (``balance-transfer-apply``) paths so the canonical mutation is built one
    way. The orchestrator path applies the mutation only; the legacy path also
    runs Python re-plan generation.
    """
    connection = _PsqlConnection()
    source_balance_id, source_version = resolve_balance(user_id, source_program_id)
    dest_balance_id, dest_version = resolve_balance(user_id, dest_program_id)

    prior_plan_id = current_plan_id_for_user(user_id)
    if prior_plan_id is None:
        raise BridgeError("validation", "no current plan to re-plan")
    prior: HeroPlanSnapshot = _plan_snapshot(connection, prior_plan_id)

    transfer_key, request_hash = _resolve_transfer_idempotency(
        user_id=user_id,
        source_program_id=source_program_id,
        dest_program_id=dest_program_id,
        amount_points=amount_points,
        idempotency_key=idempotency_key,
    )

    transfer = BalanceTransferSpec(
        actor="wallet_agent",
        user_id=user_id,
        source_balance_id=source_balance_id,
        dest_balance_id=dest_balance_id,
        amount_points=amount_points,
        source_expected_version=source_version,
        dest_expected_version=dest_version,
        idempotency_key=transfer_key,
        request_hash=request_hash,
    )
    return connection, prior, transfer


def do_balance_transfer(
    user_id: str,
    source_program_id: str,
    dest_program_id: str,
    amount_points: int,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    """Transfer points, stale the prior plan, re-plan (legacy Python), and return.

    This is the LEGACY (``PLAN_ENGINE=python-legacy``) path: it generates the
    revised plan via ``replan_after_balance_transfer``. Orchestrator mode uses
    ``balance-transfer-apply`` + TS orchestrator re-entry instead.
    """
    connection, prior, transfer = _resolve_balance_transfer(
        user_id, source_program_id, dest_program_id, amount_points, idempotency_key
    )

    new_plan = replan_after_balance_transfer(
        connection, prior=prior, transfer=transfer
    )

    current_plan = project_plan(user_id, new_plan.plan_id)
    if current_plan is None:
        raise BridgeError("not_found", "re-planned plan not found")

    return {
        "planLineageId": prior.plan_lineage_id,
        "staledPlanId": prior.plan_id,
        "replanJobId": _replan_job_id(prior.plan_id),
        "currentPlan": current_plan,
    }


def do_balance_transfer_apply(
    user_id: str,
    source_program_id: str,
    dest_program_id: str,
    amount_points: int,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    """Apply the canonical mutation ONLY (orchestrator replan path).

    Runs ``transfer_points``: mutate the two balances, stale the prior current
    plan via dependency invalidation, and enqueue a replan job — then STOP. It
    does NOT generate a revision; the TypeScript orchestrator re-enters to build
    revision 2 with fresh Wallet + Redemption AgentRuns. Returns the prior
    plan's lineage/query/revision so the caller can re-plan in the same lineage.
    """
    connection, prior, transfer = _resolve_balance_transfer(
        user_id, source_program_id, dest_program_id, amount_points, idempotency_key
    )

    service = V31GraphWriteService(connection)
    transfer_result = service.transfer_points(
        TransferPointsRequest(
            actor=transfer.actor,
            user_id=transfer.user_id,
            source_balance_id=transfer.source_balance_id,
            dest_balance_id=transfer.dest_balance_id,
            amount_points=transfer.amount_points,
            source_expected_version=transfer.source_expected_version,
            dest_expected_version=transfer.dest_expected_version,
            idempotency_key=transfer.idempotency_key,
            request_hash=transfer.request_hash,
        )
    )

    idempotency_replayed: bool = bool(transfer_result.get("idempotency_replayed", False))

    # On a replay the balances were NOT changed and no new replan job was created,
    # so there is nothing to promote — the TS service must short-circuit.
    replan_job_id = None if idempotency_replayed else _replan_job_id(prior.plan_id)

    return {
        "planLineageId": prior.plan_lineage_id,
        "staledPlanId": prior.plan_id,
        "replanJobId": replan_job_id,
        "idempotencyReplayed": idempotency_replayed,
        "priorQueryText": prior.query_text,
        "priorRevisionNumber": prior.revision_number,
    }


def do_replan_promote(
    user_id: str,
    plan_lineage_id: str,
    source_plan_id: str,
    result_plan_id: str,
    worker_id: str,
) -> dict[str, Any]:
    """Claim and promote the replan job for an orchestrator-built revision 2.

    One connection, atomic at the SQL function: claim the pending job for the
    staled source plan, then promote — result plan generating→current, source
    plan stale→superseded, result steps proposed→current, job completed. The
    promotion SQL requires the result plan to be 'generating' and to supersede
    the source plan.
    """
    if not all([user_id, plan_lineage_id, source_plan_id, result_plan_id, worker_id]):
        raise BridgeError(
            "validation",
            "user_id, plan_lineage_id, source_plan_id, result_plan_id, worker_id are required",
        )

    connection = _PsqlConnection()
    service = V31GraphWriteService(connection)
    job_id = service.claim_replan_job_for_source(
        user_id=user_id,
        plan_lineage_id=plan_lineage_id,
        source_plan_id=source_plan_id,
        worker_id=worker_id,
    )
    result = service.promote_replan_job_success(
        job_id=job_id,
        worker_id=worker_id,
        result_plan_id=result_plan_id,
    )
    return {
        "jobId": result["job_id"],
        "sourcePlanId": result["source_plan_id"],
        "resultPlanId": result["result_plan_id"],
    }


def do_replan_fail(
    user_id: str,
    plan_lineage_id: str,
    source_plan_id: str,
    worker_id: str,
    error: str,
    result_plan_id: str | None = None,
) -> dict[str, Any]:
    """Mark an orchestrator replan attempt failed, keeping the failure visible.

    Marks any partially-built revision 'failed', then claims and fails the
    replan job. The source plan deliberately stays 'stale' (never silently
    restored to 'current'), so a failed re-plan is observable. Tolerates the
    absence of a claimable job — the failure is already visible via the stale
    source plan and the failed revision.
    """
    if not all([user_id, plan_lineage_id, source_plan_id, worker_id]):
        raise BridgeError(
            "validation",
            "user_id, plan_lineage_id, source_plan_id, worker_id are required",
        )

    if result_plan_id:
        _psql_exec(
            _format_psql_query(
                """
                UPDATE plans
                   SET status = 'failed', updated_at = now()
                 WHERE id = %s AND user_id = %s AND status = 'generating'
                """,
                (result_plan_id, user_id),
            )
        )

    service = V31GraphWriteService(_PsqlConnection())
    try:
        job_id = service.claim_replan_job_for_source(
            user_id=user_id,
            plan_lineage_id=plan_lineage_id,
            source_plan_id=source_plan_id,
            worker_id=worker_id,
        )
        service.fail_replan_job(
            user_id=user_id,
            job_id=job_id,
            worker_id=worker_id,
            error=error or "orchestrator replan failed",
        )
    except (MutationCommitError, MutationValidationError):
        # No claimable job to fail (e.g. nothing was enqueued, or it is already
        # terminal). The failure stays visible via the stale source plan.
        pass

    return {"ok": True}


def _resolve_transfer_idempotency(
    *,
    user_id: str,
    source_program_id: str,
    dest_program_id: str,
    amount_points: int,
    idempotency_key: str | None,
) -> tuple[str, str]:
    """Return a stable idempotency key and request hash for one transfer intent."""
    canonical = {
        "user_id": user_id,
        "source_program_id": source_program_id,
        "dest_program_id": dest_program_id,
        "amount_points": amount_points,
    }
    request_hash = hashlib.sha256(
        json.dumps(canonical, sort_keys=True).encode()
    ).hexdigest()
    if idempotency_key is not None:
        key = idempotency_key.strip()
        if not key:
            raise BridgeError("validation", "idempotencyKey must be non-empty when provided")
        return key, request_hash

    # Same transfer body retries dedupe even when the client omits an explicit key.
    return (
        str(uuid.uuid5(uuid.NAMESPACE_URL, f"balance-transfer:{request_hash}")),
        request_hash,
    )


def _replan_job_id(source_plan_id: str) -> str | None:
    """Look up the most recent ``replan_jobs`` row for a staled source plan."""
    rows = _psql_rows(
        _format_psql_query(
            """
            SELECT id
              FROM replan_jobs
             WHERE source_plan_id = %s
             ORDER BY created_at DESC
             LIMIT 1
            """,
            (source_plan_id,),
        )
    )
    return str(rows[0][0]) if rows else None


# --------------------------------------------------------------------------- #
# Orchestrator write commands (additive — Contract 6, ADR 0010 §4)
#
# These subcommands bridge the TypeScript orchestrator (M3/M4) to
# V31GraphWriteService and agent_runs DDL. Each command:
#   - validates its inputs before touching the DB
#   - returns {ok:true, data:{...}} or {ok:false, error:{code,message}}
#   - is strictly additive; existing commands are untouched
#   - never receives CLERK_SECRET_KEY (allow-listed by the TS caller)
# --------------------------------------------------------------------------- #


def _fetch_plan_record(
    plan_id: str, user_id: str
) -> tuple[str, str, int]:
    """Return (plan_lineage_id, user_id, revision_number) or raise BridgeError."""
    rows = _psql_rows(
        _format_psql_query(
            "SELECT plan_lineage_id, user_id, revision_number FROM plans WHERE id = %s",
            (plan_id,),
        )
    )
    if not rows:
        raise BridgeError("not_found", f"plan not found: {plan_id}")
    lineage_id, plan_user_id, revision_number = rows[0]
    if str(plan_user_id) != user_id:
        raise BridgeError("not_found", f"plan not found: {plan_id}")
    return str(lineage_id), str(plan_user_id), int(revision_number)


def do_orchestrator_create_plan(
    user_id: str,
    plan_lineage_id: str,
    query_text: str,
    revision_number: int = 1,
    supersedes_plan_id: str | None = None,
) -> dict[str, Any]:
    """Create a plan revision via V31GraphWriteService (orchestrator path).

    ``revision_number`` and ``supersedes_plan_id`` let the orchestrator re-enter
    an EXISTING lineage to build revision 2 (the replan path) instead of minting
    a new lineage. The plan is created in 'generating'; promotion to 'current'
    happens later at the transition/promotion boundary, never here.
    """
    if not user_id or not plan_lineage_id or not query_text:
        raise BridgeError("validation", "user_id, plan_lineage_id, and query_text are required")
    if revision_number < 1:
        raise BridgeError("validation", "revision_number must be >= 1")

    connection = _PsqlConnection()
    service = V31GraphWriteService(connection)

    plan_id = service.create_plan(
        CreatePlanRequest(
            actor=user_id,
            user_id=user_id,
            plan_lineage_id=plan_lineage_id,
            revision_number=revision_number,
            query_text=query_text,
            supersedes_plan_id=supersedes_plan_id,
        )
    )
    return {
        "planId": plan_id,
        "planLineageId": plan_lineage_id,
        "revisionNumber": revision_number,
    }


def do_orchestrator_transition_plan(user_id: str, plan_id: str, status: str) -> dict[str, Any]:
    """Transition a plan's status to 'current' or 'failed'.

    Promoting a plan to 'current' also promotes its accepted ('proposed') steps
    to 'current', atomically. This is the single final-promotion boundary
    (`orchestrator.ts` calls it after every specialist completes). Without it,
    committed steps stay 'proposed' and dependency invalidation can never fire:
    both staleness paths — `mark_direct_plan_dependents_stale` and the
    `user_balances` backstop trigger — match only `plan_steps.status = 'current'`.
    A plan transitioning to 'failed' never promotes its steps.
    """
    allowed_statuses = {"current", "failed"}
    if status not in allowed_statuses:
        raise BridgeError("validation", f"status must be one of {sorted(allowed_statuses)}")
    if not plan_id or not user_id:
        raise BridgeError("validation", "plan_id and user_id are required")

    rows = _psql_rows(
        _format_psql_query(
            "SELECT 1 FROM plans WHERE id = %s AND user_id = %s",
            (plan_id, user_id),
        )
    )
    if not rows:
        raise BridgeError("not_found", f"plan not found: {plan_id}")

    statements = [
        _format_psql_query(
            "UPDATE plans SET status = %s, updated_at = now() WHERE id = %s AND user_id = %s",
            (status, plan_id, user_id),
        )
    ]
    if status == "current":
        statements.append(
            _format_psql_query(
                """
                UPDATE plan_steps
                   SET status = 'current', updated_at = now()
                 WHERE plan_id = %s
                   AND status = 'proposed'
                """,
                (plan_id,),
            )
        )
    _psql_tx(statements)
    return {"ok": True}


def do_orchestrator_commit_step(
    user_id: str,
    plan_id: str,
    agent_run_id: str,
    step_order: int,
    step_type: str,
    payload: dict[str, Any],
    idempotency_key: str,
    read_set: dict[str, int],
) -> dict[str, Any]:
    """Create a plan step via V31GraphWriteService.

    plan_lineage_id and revision_number are resolved from the plans table
    so the TS caller only needs to provide plan_id (from AgentCommitBinding).

    Returns {"mutationTxnId": plan_step_id} — the plan_steps.id is used as
    mutationTxnId so the agent can reference the step in RecordStateDependency.
    """
    if not user_id or not plan_id or not agent_run_id or not idempotency_key:
        raise BridgeError("validation", "user_id, plan_id, agent_run_id, and idempotency_key are required")

    plan_lineage_id, _, revision_number = _fetch_plan_record(plan_id, user_id)

    connection = _PsqlConnection()
    service = V31GraphWriteService(connection)

    plan_step_id = service.create_plan_step(
        CreatePlanStepRequest(
            actor=user_id,
            user_id=user_id,
            plan_id=plan_id,
            plan_lineage_id=plan_lineage_id,
            revision_number=revision_number,
            step_order=step_order,
            step_type=step_type,
            payload=payload,
        )
    )
    return {"mutationTxnId": plan_step_id, "idempotencyReplayed": False}


def do_orchestrator_record_dependency(
    user_id: str,
    plan_step_id: str,
    target_node_id: str,
    target_node_type: str,
    target_table: str,
    observed_version: int,
    depended_property: str,
    snapshot_value: dict[str, Any],
    idempotency_key: str,
    read_set: dict[str, int],
) -> dict[str, Any]:
    """Record a state dependency edge via V31GraphWriteService."""
    if not user_id or not plan_step_id or not target_node_id or not idempotency_key:
        raise BridgeError(
            "validation",
            "user_id, plan_step_id, target_node_id, and idempotency_key are required",
        )

    connection = _PsqlConnection()
    service = V31GraphWriteService(connection)

    dependency_id = service.record_state_dependency(
        RecordStateDependencyRequest(
            actor=user_id,
            user_id=user_id,
            plan_step_id=plan_step_id,
            target_node_id=target_node_id,
            target_node_type=target_node_type,
            target_table=target_table,
            observed_version=observed_version,
            snapshot_value=snapshot_value,
            depended_property=depended_property or None,
        )
    )
    return {"mutationTxnId": dependency_id, "idempotencyReplayed": False}


def do_orchestrator_record_mutation(
    user_id: str,
    plan_id: str,
    agent_run_id: str,
    mutation_type: str,
    target_node_id: str,
    target_table: str,
    idempotency_key: str,
    read_set: dict[str, int],
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Write a graph_mutations audit entry for UpdateUserBalance.

    V31GraphWriteService has no balance-update method (balance changes flow
    through transfer_points() SQL function exclusively). This command writes
    the mutation audit record only — it does NOT change the balance.
    """
    if not user_id or not plan_id or not target_node_id or not idempotency_key:
        raise BridgeError("validation", "user_id, plan_id, target_node_id, and idempotency_key are required")

    rows = _psql_rows(
        _format_psql_query(
            "SELECT plan_lineage_id FROM plans WHERE id = %s AND user_id = %s",
            (plan_id, user_id),
        )
    )
    if not rows:
        raise BridgeError("not_found", f"plan not found: {plan_id}")
    plan_lineage_id = str(rows[0][0])

    txn_id = str(uuid.uuid4())
    _psql_exec(
        _format_psql_query(
            """
            INSERT INTO graph_mutations (
              mutation_txn_id, user_id, plan_lineage_id, plan_id,
              mutation_type, target_table, target_node_id, summary,
              before, after
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NULL::jsonb, %s::jsonb)
            """,
            (
                txn_id,
                user_id,
                plan_lineage_id,
                plan_id,
                mutation_type,
                target_table,
                target_node_id,
                f"orchestrator:{mutation_type}:{target_node_id}",
                json.dumps(payload, sort_keys=True),
            ),
        )
    )
    return {"mutationTxnId": txn_id, "idempotencyReplayed": False}


def do_orchestrator_create_agent_run(
    plan_id: str,
    user_id: str,
    agent_type: str,
) -> dict[str, Any]:
    """Insert a new agent_runs row with status='running'."""
    allowed_agent_types = {"orchestrator", "wallet_agent", "earning_agent", "redemption_agent"}
    if agent_type not in allowed_agent_types:
        raise BridgeError("validation", f"agent_type must be one of {sorted(allowed_agent_types)}")
    if not plan_id or not user_id:
        raise BridgeError("validation", "plan_id and user_id are required")

    # Ownership guard: an agent run may only be attached to a plan the caller
    # owns (mirrors transition-plan / finalize-agent-run). Without this a known
    # plan_id could bind a run to another user's plan.
    rows = _psql_rows(
        _format_psql_query(
            "SELECT 1 FROM plans WHERE id = %s AND user_id = %s",
            (plan_id, user_id),
        )
    )
    if not rows:
        raise BridgeError("not_found", f"plan not found: {plan_id}")

    agent_run_id = str(uuid.uuid4())
    _psql_exec(
        _format_psql_query(
            """
            INSERT INTO agent_runs
              (id, agent_type, plan_id, user_id, status, started_at, updated_at)
            VALUES (%s, %s, %s, %s, 'running', now(), now())
            """,
            (agent_run_id, agent_type, plan_id, user_id),
        )
    )
    return {"agentRunId": agent_run_id}


def do_orchestrator_finalize_agent_run(
    agent_run_id: str,
    status: str,
    user_id: str,
    error: str | None = None,
) -> dict[str, Any]:
    """Update an agent_run row with terminal status and completion timestamp."""
    allowed_statuses = {"completed", "failed"}
    if status not in allowed_statuses:
        raise BridgeError("validation", f"status must be one of {sorted(allowed_statuses)}")
    if not agent_run_id or not user_id:
        raise BridgeError("validation", "agent_run_id and user_id are required")

    rows = _psql_rows(
        _format_psql_query(
            "SELECT 1 FROM agent_runs WHERE id = %s AND user_id = %s",
            (agent_run_id, user_id),
        )
    )
    if not rows:
        raise BridgeError("not_found", f"agent_run not found: {agent_run_id}")

    # Guard the terminal transition: only a still-'running' run may be finalized.
    # Scoping by status (plus RETURNING to observe the affected row) prevents a
    # completed run from later being flipped to failed, or vice versa.
    updated = _psql_rows(
        _format_psql_query(
            """
            UPDATE agent_runs
               SET status = %s,
                   completed_at = now(),
                   error = %s,
                   updated_at = now()
             WHERE id = %s AND user_id = %s AND status = 'running'
             RETURNING id
            """,
            (status, error, agent_run_id, user_id),
        )
    )
    if not updated:
        raise BridgeError("conflict", f"agent_run is not running: {agent_run_id}")
    return {"ok": True}


def do_read_plan(user_id: str, plan_id: str) -> dict[str, Any] | None:
    """Project a plan into PlanView for Contract 7 (plan-projection read path).

    Named 'read-plan' to clearly distinguish projection reads from plan-generation
    commands (create-plan, balance-transfer). G5 verification confirms this command
    was invoked rather than any plan-generation command.
    """
    if not user_id or not plan_id:
        raise BridgeError("validation", "user_id and plan_id are required")
    return project_plan(user_id, plan_id)


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #


def build_parser() -> argparse.ArgumentParser:
    """Build the CLI subcommand parser consumed by ``main``."""
    parser = argparse.ArgumentParser(description="Demo API hero bridge")
    sub = parser.add_subparsers(dest="command", required=True)

    def with_user(p: argparse.ArgumentParser) -> argparse.ArgumentParser:
        """Add the required ``--user-id`` flag to a subcommand parser."""
        p.add_argument("--user-id", required=True)
        return p

    # session accepts either an already-resolved user id (dev / existing) or a
    # clerk id that bootstraps a fresh persona on first login.
    session = sub.add_parser("session")
    session.add_argument("--user-id")
    session.add_argument("--clerk-id")
    session.add_argument("--email")

    with_user(sub.add_parser("demo-reset"))

    create = with_user(sub.add_parser("create-plan"))
    create.add_argument("--query", required=True)
    create.add_argument("--card-slugs", default="")

    get_plan = with_user(sub.add_parser("get-plan"))
    get_plan.add_argument("--plan-id", required=True)

    current = with_user(sub.add_parser("current-plan"))
    current.add_argument("--lineage-id", required=True)

    transfer = with_user(sub.add_parser("balance-transfer"))
    transfer.add_argument("--source-program-id", required=True)
    transfer.add_argument("--dest-program-id", required=True)
    transfer.add_argument("--amount", required=True, type=int)
    transfer.add_argument("--idempotency-key")

    # Orchestrator replan path: apply the canonical mutation only (no generation).
    transfer_apply = with_user(sub.add_parser("balance-transfer-apply"))
    transfer_apply.add_argument("--source-program-id", required=True)
    transfer_apply.add_argument("--dest-program-id", required=True)
    transfer_apply.add_argument("--amount", required=True, type=int)
    transfer_apply.add_argument("--idempotency-key")

    # ── Orchestrator write commands (additive) ────────────────────────────── #

    ocp = with_user(sub.add_parser("orchestrator-create-plan"))
    ocp.add_argument("--plan-lineage-id", required=True)
    ocp.add_argument("--query-text", required=True)
    ocp.add_argument("--revision-number", type=int, default=1)
    ocp.add_argument("--supersedes-plan-id")

    # Replan-job lifecycle for orchestrator-built revisions (claim+promote / fail).
    rpromote = with_user(sub.add_parser("replan-promote"))
    rpromote.add_argument("--plan-lineage-id", required=True)
    rpromote.add_argument("--source-plan-id", required=True)
    rpromote.add_argument("--result-plan-id", required=True)
    rpromote.add_argument("--worker-id", required=True)

    rfail = with_user(sub.add_parser("replan-fail"))
    rfail.add_argument("--plan-lineage-id", required=True)
    rfail.add_argument("--source-plan-id", required=True)
    rfail.add_argument("--worker-id", required=True)
    rfail.add_argument("--error", default="")
    rfail.add_argument("--result-plan-id")

    otp = with_user(sub.add_parser("orchestrator-transition-plan"))
    otp.add_argument("--plan-id", required=True)
    otp.add_argument("--status", required=True)

    ocs = with_user(sub.add_parser("orchestrator-commit-step"))
    ocs.add_argument("--plan-id", required=True)
    ocs.add_argument("--agent-run-id", required=True)
    ocs.add_argument("--step-order", required=True, type=int)
    ocs.add_argument("--step-type", required=True)
    ocs.add_argument("--payload", required=True)
    ocs.add_argument("--idempotency-key", required=True)
    ocs.add_argument("--read-set", required=True)

    ord_ = with_user(sub.add_parser("orchestrator-record-dependency"))
    ord_.add_argument("--plan-step-id", required=True)
    ord_.add_argument("--target-node-id", required=True)
    ord_.add_argument("--target-node-type", required=True)
    ord_.add_argument("--target-table", required=True)
    ord_.add_argument("--observed-version", required=True, type=int)
    ord_.add_argument("--depended-property", default="")
    ord_.add_argument("--snapshot-value", required=True)
    ord_.add_argument("--idempotency-key", required=True)
    ord_.add_argument("--read-set", required=True)

    orm = with_user(sub.add_parser("orchestrator-record-mutation"))
    orm.add_argument("--plan-id", required=True)
    orm.add_argument("--agent-run-id", required=True)
    orm.add_argument("--mutation-type", required=True)
    orm.add_argument("--target-node-id", required=True)
    orm.add_argument("--target-table", required=True)
    orm.add_argument("--idempotency-key", required=True)
    orm.add_argument("--read-set", required=True)
    orm.add_argument("--payload", required=True)

    ocar = with_user(sub.add_parser("orchestrator-create-agent-run"))
    ocar.add_argument("--plan-id", required=True)
    ocar.add_argument("--agent-type", required=True)

    ofar = with_user(sub.add_parser("orchestrator-finalize-agent-run"))
    ofar.add_argument("--agent-run-id", required=True)
    ofar.add_argument("--status", required=True)
    ofar.add_argument("--error")

    rp = with_user(sub.add_parser("read-plan"))
    rp.add_argument("--plan-id", required=True)

    return parser


def dispatch(args: argparse.Namespace) -> Any:
    """Route a parsed CLI subcommand to the matching ``do_*`` handler."""
    if args.command == "session":
        if not args.user_id and not args.clerk_id:
            raise BridgeError("validation", "session requires --user-id or --clerk-id")
        return do_session(
            user_id=args.user_id,
            clerk_id=args.clerk_id,
            email=args.email,
        )
    if args.command == "demo-reset":
        return do_demo_reset(args.user_id)
    if args.command == "create-plan":
        card_slugs = [s for s in args.card_slugs.split(",") if s] if args.card_slugs else []
        return do_create_plan(args.user_id, args.query, card_slugs)
    if args.command == "get-plan":
        return do_get_plan(args.user_id, args.plan_id)
    if args.command == "current-plan":
        return do_current_plan(args.user_id, args.lineage_id)
    if args.command == "balance-transfer":
        return do_balance_transfer(
            args.user_id,
            args.source_program_id,
            args.dest_program_id,
            args.amount,
            idempotency_key=args.idempotency_key,
        )
    if args.command == "balance-transfer-apply":
        return do_balance_transfer_apply(
            args.user_id,
            args.source_program_id,
            args.dest_program_id,
            args.amount,
            idempotency_key=args.idempotency_key,
        )
    if args.command == "replan-promote":
        return do_replan_promote(
            user_id=args.user_id,
            plan_lineage_id=args.plan_lineage_id,
            source_plan_id=args.source_plan_id,
            result_plan_id=args.result_plan_id,
            worker_id=args.worker_id,
        )
    if args.command == "replan-fail":
        return do_replan_fail(
            user_id=args.user_id,
            plan_lineage_id=args.plan_lineage_id,
            source_plan_id=args.source_plan_id,
            worker_id=args.worker_id,
            error=args.error,
            result_plan_id=args.result_plan_id,
        )

    # ── Orchestrator write commands ────────────────────────────────────────── #

    if args.command == "orchestrator-create-plan":
        return do_orchestrator_create_plan(
            args.user_id,
            args.plan_lineage_id,
            args.query_text,
            revision_number=args.revision_number,
            supersedes_plan_id=args.supersedes_plan_id,
        )
    if args.command == "orchestrator-transition-plan":
        return do_orchestrator_transition_plan(args.user_id, args.plan_id, args.status)
    if args.command == "orchestrator-commit-step":
        return do_orchestrator_commit_step(
            user_id=args.user_id,
            plan_id=args.plan_id,
            agent_run_id=args.agent_run_id,
            step_order=args.step_order,
            step_type=args.step_type,
            payload=json.loads(args.payload),
            idempotency_key=args.idempotency_key,
            read_set=json.loads(args.read_set),
        )
    if args.command == "orchestrator-record-dependency":
        return do_orchestrator_record_dependency(
            user_id=args.user_id,
            plan_step_id=args.plan_step_id,
            target_node_id=args.target_node_id,
            target_node_type=args.target_node_type,
            target_table=args.target_table,
            observed_version=args.observed_version,
            depended_property=args.depended_property,
            snapshot_value=json.loads(args.snapshot_value),
            idempotency_key=args.idempotency_key,
            read_set=json.loads(args.read_set),
        )
    if args.command == "orchestrator-record-mutation":
        return do_orchestrator_record_mutation(
            user_id=args.user_id,
            plan_id=args.plan_id,
            agent_run_id=args.agent_run_id,
            mutation_type=args.mutation_type,
            target_node_id=args.target_node_id,
            target_table=args.target_table,
            idempotency_key=args.idempotency_key,
            read_set=json.loads(args.read_set),
            payload=json.loads(args.payload),
        )
    if args.command == "orchestrator-create-agent-run":
        return do_orchestrator_create_agent_run(
            plan_id=args.plan_id,
            user_id=args.user_id,
            agent_type=args.agent_type,
        )
    if args.command == "orchestrator-finalize-agent-run":
        return do_orchestrator_finalize_agent_run(
            agent_run_id=args.agent_run_id,
            status=args.status,
            user_id=args.user_id,
            error=args.error,
        )
    if args.command == "read-plan":
        return do_read_plan(args.user_id, args.plan_id)

    raise BridgeError("validation", f"unknown command: {args.command}")


def main() -> int:
    """CLI entry: parse args, dispatch, and print one JSON envelope to stdout."""
    args = build_parser().parse_args()
    try:
        data = dispatch(args)
        print(json.dumps({"ok": True, "data": data}))
        return 0
    except BridgeError as exc:
        print(json.dumps({"ok": False, "error": {"code": exc.code, "message": str(exc)}}))
        return 0
    except ConcurrencyConflictError as exc:
        print(json.dumps({"ok": False, "error": {"code": "conflict", "message": str(exc)}}))
        return 0
    except MutationValidationError as exc:
        print(json.dumps({"ok": False, "error": {"code": "validation", "message": str(exc)}}))
        return 0
    except Exception as exc:  # noqa: BLE001 — surface as a structured 500 to TS
        print(json.dumps({"ok": False, "error": {"code": "internal", "message": str(exc)}}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
