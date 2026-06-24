"""HTTP-to-graph bridge for the demo API service (spec 07).

The TypeScript Hono server spawns this script once per plan/session request. It
reuses the *verified* hero seam (``tests/integration/hero_flow.py``) over the
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
    MutationValidationError,
)
from tests.integration.hero_flow import (  # noqa: E402
    BalanceTransferSpec,
    HeroPlanSnapshot,
    _plan_snapshot,
    create_plan_from_query,
    replan_after_balance_transfer,
)

DEMO_SEED_PATH = REPO_ROOT / "fixtures" / "demo-seed.json"


class BridgeError(Exception):
    """Domain error mapped to an HTTP status by the TS caller."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


# --------------------------------------------------------------------------- #
# psql connection adapter (mirrors tests/integration/test_hero_moment.py)
# --------------------------------------------------------------------------- #


class _PsqlConnection:
    def cursor(self) -> "_PsqlCursor":
        return _PsqlCursor()


class _PsqlCursor:
    def __init__(self) -> None:
        self.result: list[tuple[Any, ...]] | None = None

    def __enter__(self) -> "_PsqlCursor":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def execute(self, sql: str, params: tuple[Any, ...] | None = None) -> None:
        self.result = _psql_rows(_format_psql_query(sql, params or ()))

    def fetchone(self) -> tuple[Any, ...] | None:
        if not self.result:
            return None
        return self.result[0]


def _psql_command(*extra: str) -> list[str]:
    command = ["psql", "--set", "ON_ERROR_STOP=1", "--quiet", *extra]
    database_url = os.environ.get("DATABASE_URL")
    if database_url:
        command.append(database_url)
    return command


def _psql_exec(sql: str) -> None:
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


def _psql_rows(sql: str) -> list[tuple[Any, ...]]:
    result = subprocess.run(
        _psql_command(
            "--no-align",
            "--tuples-only",
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
    output = result.stdout.strip("\n\x1e")
    if not output:
        return []
    return [
        tuple(_parse_psql_value(value) for value in row.split("\x1f"))
        for row in output.split("\x1e")
        if row
    ]


def _format_psql_query(sql: str, params: tuple[Any, ...]) -> str:
    formatted = sql
    for param in params:
        formatted = formatted.replace("%s", _psql_literal(param), 1)
    return formatted


def _psql_literal(value: Any) -> str:
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
    if value == "":
        return None
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
                   payload->>'action', payload->>'reasoning'
              FROM plan_steps
             WHERE plan_id = %s
             ORDER BY step_order
            """,
            (plan_id,),
        )
    )

    depends_by_step = _depends_on_by_step(plan_id)
    steps = [
        {
            "order": int(step_order),
            "type": step_type,
            "summary": action or "",
            "reasoning": reasoning or "",
            "status": status_value,
            "dependsOn": depends_by_step.get(str(step_id), []),
        }
        for (step_id, step_order, step_type, status_value, action, reasoning) in step_rows
    ]

    return {
        "planId": str(plan_id),
        "planLineageId": str(plan_lineage_id),
        "revisionNumber": int(revision_number),
        "status": status,
        "query": query_text,
        "summary": summary,
        "steps": steps,
    }


def _depends_on_by_step(plan_id: str) -> dict[str, list[str]]:
    rows = _psql_rows(
        _format_psql_query(
            """
            SELECT sd.plan_step_id, sd.target_node_id
              FROM state_dependencies sd
              JOIN plan_steps ps ON ps.id = sd.plan_step_id
             WHERE ps.plan_id = %s
             ORDER BY sd.plan_step_id
            """,
            (plan_id,),
        )
    )
    grouped: dict[str, list[str]] = {}
    for plan_step_id, target_node_id in rows:
        if target_node_id is None:
            continue
        grouped.setdefault(str(plan_step_id), []).append(str(target_node_id))
    return grouped


def resolve_balance(user_id: str, program_id: str) -> tuple[str, int]:
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


def do_session(user_id: str) -> dict[str, Any]:
    rows = _psql_rows(
        _format_psql_query(
            "SELECT clerk_id FROM users WHERE id = %s",
            (user_id,),
        )
    )
    if not rows:
        raise BridgeError("not_found", f"user not found: {user_id}")
    return {"userId": user_id, "clerkId": rows[0][0], "seeded": True}


def do_demo_reset(user_id: str) -> dict[str, Any]:
    session = do_session(user_id)
    # Order matters: replan_jobs.result_plan_id has no cascade, so it must be
    # cleared before the plans it points at can be deleted.
    _psql_exec(
        _format_psql_query(
            """
            DELETE FROM replan_jobs WHERE user_id = %s;
            DELETE FROM graph_mutations WHERE user_id = %s;
            DELETE FROM plans WHERE user_id = %s;
            """,
            (user_id, user_id, user_id),
        )
    )
    _reset_seed_balances(user_id)
    return session


def _reset_seed_balances(user_id: str) -> None:
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


def do_create_plan(user_id: str, query: str) -> dict[str, Any]:
    connection = _PsqlConnection()
    snapshot = create_plan_from_query(
        connection, user_id=user_id, query_text=query
    )
    plan = project_plan(user_id, snapshot.plan_id)
    if plan is None:
        raise BridgeError("not_found", "plan vanished after create")
    return plan


def do_get_plan(user_id: str, plan_id: str) -> dict[str, Any] | None:
    return project_plan(user_id, plan_id)


def do_current_plan(user_id: str, lineage_id: str) -> dict[str, Any] | None:
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


def do_balance_transfer(
    user_id: str,
    source_program_id: str,
    dest_program_id: str,
    amount_points: int,
) -> dict[str, Any]:
    connection = _PsqlConnection()
    source_balance_id, source_version = resolve_balance(user_id, source_program_id)
    dest_balance_id, dest_version = resolve_balance(user_id, dest_program_id)

    prior_plan_id = current_plan_id_for_user(user_id)
    if prior_plan_id is None:
        raise BridgeError("validation", "no current plan to re-plan")
    prior: HeroPlanSnapshot = _plan_snapshot(connection, prior_plan_id)

    transfer = BalanceTransferSpec(
        actor="wallet_agent",
        user_id=user_id,
        source_balance_id=source_balance_id,
        dest_balance_id=dest_balance_id,
        amount_points=amount_points,
        source_expected_version=source_version,
        dest_expected_version=dest_version,
        idempotency_key=str(uuid.uuid4()),
        request_hash=uuid.uuid4().hex,
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


def _replan_job_id(source_plan_id: str) -> str | None:
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
# CLI
# --------------------------------------------------------------------------- #


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Demo API hero bridge")
    sub = parser.add_subparsers(dest="command", required=True)

    def with_user(p: argparse.ArgumentParser) -> argparse.ArgumentParser:
        p.add_argument("--user-id", required=True)
        return p

    with_user(sub.add_parser("session"))
    with_user(sub.add_parser("demo-reset"))

    create = with_user(sub.add_parser("create-plan"))
    create.add_argument("--query", required=True)

    get_plan = with_user(sub.add_parser("get-plan"))
    get_plan.add_argument("--plan-id", required=True)

    current = with_user(sub.add_parser("current-plan"))
    current.add_argument("--lineage-id", required=True)

    transfer = with_user(sub.add_parser("balance-transfer"))
    transfer.add_argument("--source-program-id", required=True)
    transfer.add_argument("--dest-program-id", required=True)
    transfer.add_argument("--amount", required=True, type=int)
    return parser


def dispatch(args: argparse.Namespace) -> Any:
    if args.command == "session":
        return do_session(args.user_id)
    if args.command == "demo-reset":
        return do_demo_reset(args.user_id)
    if args.command == "create-plan":
        return do_create_plan(args.user_id, args.query)
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
        )
    raise BridgeError("validation", f"unknown command: {args.command}")


def main() -> int:
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
