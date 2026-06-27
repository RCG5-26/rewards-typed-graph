"""Bridge from seeded redemption planning to graph-write rows.

The production boundary keeps Python agents reasoning-only. This seam is
DB-aware because the Jun 25 hero gate runs against the pre-API Python
`V31GraphWriteService`.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from agents.redemption.planner import load_fixture, plan_direct_redemption, plan_redemption
from schema.mutations import (
    CreatePlanStepRequest,
    RecordStateDependencyRequest,
    V31GraphWriteService,
)

# Planner input uses Person C's award/trip fixture shape (`trip_request`,
# `award_options`, etc.). Postgres hero setup loads `fixtures/demo-seed.json`
# separately via load_seed.py; balances come from the live DB snapshot.
DEFAULT_FIXTURE_PATH = (
    Path(__file__).resolve().parents[1] / "fixtures" / "person-c-mvp-seed.json"
)
DEFAULT_SOURCE_PROGRAM_SLUG = "program:chase_ur"


@dataclass(frozen=True)
class BalanceSnapshot:
    id: str
    program_slug: str
    balance_points: int
    version: int


@dataclass(frozen=True)
class RedemptionStepWriteResult:
    plan_id: str
    step_ids: tuple[str, ...]
    dependency_ids: tuple[str, ...]
    plan_draft: dict[str, Any]

    @property
    def step_count(self) -> int:
        return len(self.step_ids)

    @property
    def dependency_count(self) -> int:
        return len(self.dependency_ids)


def write_redemption_steps(
    connection: Any,
    *,
    user_id: str,
    plan_id: str,
    plan_lineage_id: str,
    revision_number: int,
    query_text: str,
    step_status: str = "current",
    source_program_slug: str = DEFAULT_SOURCE_PROGRAM_SLUG,
    fixture: dict[str, Any] | None = None,
    planner_fn: Any | None = None,
    graph_write_service: Any | None = None,
) -> RedemptionStepWriteResult:
    """Plan a seeded redemption and write only steps/dependencies.

    ``planner_fn`` defaults to ``plan_redemption``; pass ``plan_direct_redemption``
    for the World of Hyatt direct-redemption scenario (no transfer step).
    """

    if not user_id:
        raise ValueError("user_id is required")
    if not plan_id:
        raise ValueError("plan_id is required")
    if not plan_lineage_id:
        raise ValueError("plan_lineage_id is required")
    if revision_number <= 0:
        raise ValueError("revision_number must be greater than 0")
    if not query_text:
        raise ValueError("query_text is required")

    balance = fetch_balance_snapshot(
        connection,
        user_id=user_id,
        program_slug=source_program_slug,
    )
    fixture_data = fixture if fixture is not None else load_fixture(DEFAULT_FIXTURE_PATH)
    actual_planner = planner_fn if planner_fn is not None else plan_redemption
    draft = actual_planner(
        fixture_data,
        balance_points=balance.balance_points,
        query_text=query_text,
    )

    service = graph_write_service or V31GraphWriteService(connection)
    step_ids: list[str] = []
    dependency_ids: list[str] = []
    for step in draft["steps"]:
        step_id = service.create_plan_step(
            CreatePlanStepRequest(
                actor="redemption_agent",
                user_id=user_id,
                plan_id=plan_id,
                plan_lineage_id=plan_lineage_id,
                revision_number=revision_number,
                step_order=step["step_order"],
                step_type=step["step_type"],
                payload=_payload_from_step(step, draft),
                status=step_status,
            )
        )
        step_ids.append(step_id)

        for dependency in step["state_dependencies"]:
            dependency_ids.append(
                service.record_state_dependency(
                    _dependency_request_from_planner(
                        dependency,
                        balance=balance,
                        step_id=step_id,
                        user_id=user_id,
                    )
                )
            )

    return RedemptionStepWriteResult(
        plan_id=plan_id,
        step_ids=tuple(step_ids),
        dependency_ids=tuple(dependency_ids),
        plan_draft=draft,
    )


def fetch_balance_snapshot(
    connection: Any,
    *,
    user_id: str,
    program_slug: str,
) -> BalanceSnapshot:
    """Return the current user balance row for the source reward program."""

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT ub.id, rp.slug, ub.balance_points, ub.version
              FROM user_balances ub
              JOIN reward_programs rp ON rp.id = ub.program_id
             WHERE ub.user_id = %s
               AND rp.slug = %s
            """,
            (user_id, program_slug),
        )
        row = cursor.fetchone()

    if row is None:
        raise ValueError(
            "source balance does not exist or is not visible to user "
            f"{user_id}: {program_slug}"
        )

    balance_id, row_program_slug, balance_points, version = row
    return BalanceSnapshot(
        id=str(balance_id),
        program_slug=str(row_program_slug),
        balance_points=int(balance_points),
        version=int(version),
    )


def _dependency_request_from_planner(
    dependency: dict[str, Any],
    *,
    balance: BalanceSnapshot,
    step_id: str,
    user_id: str,
) -> RecordStateDependencyRequest:
    if dependency["target_table"] != "user_balances":
        raise ValueError(f"unsupported planner dependency: {dependency['target_table']}")

    return RecordStateDependencyRequest(
        actor="redemption_agent",
        user_id=user_id,
        plan_step_id=step_id,
        target_node_id=balance.id,
        target_node_type="UserBalance",
        target_table="user_balances",
        observed_version=balance.version,
        snapshot_value={
            "balance_points": balance.balance_points,
            "program_slug": balance.program_slug,
        },
        depended_property=dependency.get("depended_property"),
    )


def _payload_from_step(step: dict[str, Any], draft: dict[str, Any]) -> dict[str, Any]:
    return {
        "action": step["action"],
        "reasoning": step["reasoning"],
        "tradeoff": _tradeoff_from_step(step),
        "planner_payload": step["payload"],
        "chosen_award_slug": draft.get("chosen_award_slug"),
        "backup_award_slug": draft.get("backup_award_slug"),
        "fallback": draft.get("fallback"),
    }


def _tradeoff_from_step(step: dict[str, Any]) -> dict[str, Any]:
    payload = step["payload"]
    tradeoff: dict[str, Any] = {}

    for key in (
        "transfer_ratio_basis_points",
        "required_source_points",
        "points_total",
        "cash_total_cents",
        "value_basis_points",
        "candidate_fact_slugs",
    ):
        if key in payload:
            tradeoff[key] = payload[key]

    return tradeoff
