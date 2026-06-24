"""Hero flow API — integration seam for Jun 25 gate.

Implement these functions to turn the hero integration test green:

- ``create_plan_from_query`` — Raq (RCG-15/28) + Michael (RCG-21)
- ``replan_after_balance_transfer`` — Raq + Michael (RCG-29)

Until implemented, ``test_hero_end_to_end`` fails with ``NotImplementedError``.
"""

from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass
from typing import Any, Protocol

from schema.mutations import (
    CreatePlanRequest,
    CreatePlanStepRequest,
    PromotePlanRevisionRequest,
    RecordStateDependencyRequest,
    TransferPointsRequest,
    V31GraphWriteService,
)

# Stable demo IDs — mirror tests/integration/test_hero_moment.py and the seed.
CHASE_BALANCE_ID = "00000000-0000-0000-0000-00000000d001"


@dataclass(frozen=True)
class HeroPlanSnapshot:
    """Minimal plan state the integration test asserts on."""

    plan_id: str
    plan_lineage_id: str
    revision_number: int
    status: str
    step_count: int
    dependency_count: int


@dataclass(frozen=True)
class BalanceTransferSpec:
    """Simulates Hero Moment 1: user transferred points between programs."""

    actor: str
    user_id: str
    source_balance_id: str
    dest_balance_id: str
    amount_points: int
    source_expected_version: int
    dest_expected_version: int
    idempotency_key: str
    request_hash: str


class GraphConnection(Protocol):
    def cursor(self) -> Any: ...


def create_plan_from_query(
    connection: GraphConnection,
    *,
    user_id: str,
    query_text: str,
) -> HeroPlanSnapshot:
    """Beat 1: NL query → current plan revision with steps + state_dependencies.

    Expected wiring (MVP):
    1. Orchestrator creates plan (status ``generating`` → ``current``).
    2. Redemption agent reads graph/seed, writes ``plan_steps`` + ``state_dependencies``
       via ``V31GraphWriteService`` only.
    3. Returns snapshot for assertions.

    Cut scope OK for Jun 25: hardcoded Tokyo path, deterministic reasoning, no LLM.
    """
    service = V31GraphWriteService(connection)
    plan_lineage_id = str(uuid.uuid4())

    plan_id = service.create_plan(
        CreatePlanRequest(
            actor="orchestrator",
            user_id=user_id,
            plan_lineage_id=plan_lineage_id,
            revision_number=1,
            query_text=query_text,
            status="current",
        )
    )

    redemption_step_id = service.create_plan_step(
        CreatePlanStepRequest(
            actor="redemption_agent",
            user_id=user_id,
            plan_id=plan_id,
            plan_lineage_id=plan_lineage_id,
            revision_number=1,
            step_order=1,
            step_type="redemption_recommendation",
            payload={
                "reasoning": "World of Hyatt Cat 4 covers a 3-night Tokyo stay at 60k points.",
                "program": "world-of-hyatt",
                "nights": 3,
                "points_required": 60000,
            },
            status="current",
        )
    )

    service.create_plan_step(
        CreatePlanStepRequest(
            actor="redemption_agent",
            user_id=user_id,
            plan_id=plan_id,
            plan_lineage_id=plan_lineage_id,
            revision_number=1,
            step_order=2,
            step_type="transfer_recommendation",
            payload={
                "reasoning": "Transfer 60k Chase UR to Hyatt (1:1) to fund the award.",
                "action": "transfer_points",
                "amount_points": 60000,
            },
            status="current",
        )
    )

    service.record_state_dependency(
        RecordStateDependencyRequest(
            actor="redemption_agent",
            user_id=user_id,
            plan_step_id=redemption_step_id,
            target_node_id=CHASE_BALANCE_ID,
            target_node_type="UserBalance",
            target_table="user_balances",
            observed_version=1,
            snapshot_value={"balance_points": 240000},
            depended_property="balance_points",
        )
    )

    return HeroPlanSnapshot(
        plan_id=plan_id,
        plan_lineage_id=plan_lineage_id,
        revision_number=1,
        status="current",
        step_count=2,
        dependency_count=1,
    )


def replan_after_balance_transfer(
    connection: GraphConnection,
    *,
    prior: HeroPlanSnapshot,
    transfer: BalanceTransferSpec,
) -> HeroPlanSnapshot:
    """Beat 2 + 3: transfer → stale detection → new current revision.

    Expected wiring (MVP):
    1. Call ``V31GraphWriteService.transfer_points`` (wallet agent optional).
    2. Assert prior plan/step statuses become ``stale`` (or read ``stale_plan_steps``).
    3. Invoke redemption again for same ``plan_lineage_id`` with ``revision_number + 1``;
       mark prior plan ``superseded``, new plan ``current``.
    4. ``replan_jobs`` worker optional — synchronous re-plan is fine for Jun 25.

    Returns the new current plan snapshot.
    """
    service = V31GraphWriteService(connection)

    # Beat 2: mutate the balance. The DB cascade marks the dependent plan +
    # steps stale and enqueues a replan_jobs row — we never message the plan.
    service.transfer_points(TransferPointsRequest(**asdict(transfer)))

    # Re-plan reuses the original NL query; the snapshot doesn't carry it.
    query_text = _fetch_plan_query_text(connection, prior.plan_id)

    next_revision = prior.revision_number + 1
    plan_v2_id = service.create_plan(
        CreatePlanRequest(
            actor="orchestrator",
            user_id=transfer.user_id,
            plan_lineage_id=prior.plan_lineage_id,
            revision_number=next_revision,
            query_text=query_text,
            status="current",
            supersedes_plan_id=prior.plan_id,
        )
    )

    service.create_plan_step(
        CreatePlanStepRequest(
            actor="redemption_agent",
            user_id=transfer.user_id,
            plan_id=plan_v2_id,
            plan_lineage_id=prior.plan_lineage_id,
            revision_number=next_revision,
            step_order=1,
            step_type="redemption_recommendation",
            payload={
                "reasoning": "Balance already moved; book the Hyatt Tokyo award directly.",
                "program": "world-of-hyatt",
                "nights": 3,
                "points_required": 60000,
            },
            status="current",
        )
    )

    # Beat 3: source revision stale -> superseded, close the replan job.
    service.promote_plan_revision(
        PromotePlanRevisionRequest(
            actor="orchestrator",
            user_id=transfer.user_id,
            source_plan_id=prior.plan_id,
            new_plan_id=plan_v2_id,
            plan_lineage_id=prior.plan_lineage_id,
        )
    )

    return HeroPlanSnapshot(
        plan_id=plan_v2_id,
        plan_lineage_id=prior.plan_lineage_id,
        revision_number=next_revision,
        status="current",
        step_count=1,
        dependency_count=0,
    )


def _fetch_plan_query_text(connection: GraphConnection, plan_id: str) -> str:
    with connection.cursor() as cursor:
        cursor.execute("SELECT query_text FROM plans WHERE id = %s", (plan_id,))
        row = cursor.fetchone()
    if not row:
        raise ValueError(f"plan {plan_id} not found while re-planning")
    return row[0]
