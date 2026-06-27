"""Hero flow orchestration: create/replan seam over the graph-write service.

Keeps the orchestration surface tiny: create a plan from the deterministic
redemption writer, then perform the synchronous re-plan path used by the hero
gate. Lives outside ``tests/`` so the runtime bridge does not import test code.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from schema.mutations import (
    CreatePlanRequest,
    TransferPointsRequest,
    V31GraphWriteService,
)
from agents.redemption.planner import load_fixture, plan_direct_redemption
from plan_flows.redemption_graph_writer import write_redemption_steps

HYATT_DIRECT_FIXTURE_PATH = (
    Path(__file__).resolve().parents[1] / "fixtures" / "person-c-hyatt-direct-seed.json"
)


@dataclass(frozen=True)
class HeroPlanSnapshot:
    """Minimal plan state the integration test asserts on."""

    plan_id: str
    plan_lineage_id: str
    revision_number: int
    status: str
    step_count: int
    dependency_count: int
    query_text: str


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
    """Beat 1: NL query to current plan revision with dependencies."""

    service = V31GraphWriteService(connection)
    plan_lineage_id = str(uuid.uuid4())
    plan_id = service.create_plan(
        CreatePlanRequest(
            actor="orchestrator",
            user_id=user_id,
            plan_lineage_id=plan_lineage_id,
            revision_number=1,
            query_text=query_text,
            status="generating",
        )
    )
    try:
        write_redemption_steps(
            connection,
            user_id=user_id,
            plan_id=plan_id,
            query_text=query_text,
            plan_lineage_id=plan_lineage_id,
            revision_number=1,
        )
        _promote_generating_plan_to_current(connection, plan_id)
    except Exception:
        _mark_generating_plan_failed(connection, plan_id)
        raise
    return _plan_snapshot(connection, plan_id)


def create_direct_plan_from_query(
    connection: GraphConnection,
    *,
    user_id: str,
    query_text: str,
) -> HeroPlanSnapshot:
    """Scenario 2: World of Hyatt direct redemption — no transfer step."""

    service = V31GraphWriteService(connection)
    plan_lineage_id = str(uuid.uuid4())
    plan_id = service.create_plan(
        CreatePlanRequest(
            actor="orchestrator",
            user_id=user_id,
            plan_lineage_id=plan_lineage_id,
            revision_number=1,
            query_text=query_text,
            status="generating",
        )
    )
    try:
        write_redemption_steps(
            connection,
            user_id=user_id,
            plan_id=plan_id,
            query_text=query_text,
            plan_lineage_id=plan_lineage_id,
            revision_number=1,
            source_program_slug="program:hyatt",
            fixture=load_fixture(HYATT_DIRECT_FIXTURE_PATH),
            planner_fn=plan_direct_redemption,
        )
        _promote_generating_plan_to_current(connection, plan_id)
    except Exception:
        _mark_generating_plan_failed(connection, plan_id)
        raise
    return _plan_snapshot(connection, plan_id)


def replan_after_balance_transfer(
    connection: GraphConnection,
    *,
    prior: HeroPlanSnapshot,
    transfer: BalanceTransferSpec,
) -> HeroPlanSnapshot:
    """Beat 2 and 3: transfer, stale prior revision, then promote revision 2."""

    service = V31GraphWriteService(connection)
    service.transfer_points(
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

    worker_id = "hero-flow-sync-worker"
    job_id = service.claim_replan_job_for_source(
        user_id=transfer.user_id,
        plan_lineage_id=prior.plan_lineage_id,
        source_plan_id=prior.plan_id,
        worker_id=worker_id,
    )
    result_plan_id: str | None = None
    try:
        result_plan_id = service.create_plan(
            CreatePlanRequest(
                actor="orchestrator",
                user_id=transfer.user_id,
                plan_lineage_id=prior.plan_lineage_id,
                revision_number=prior.revision_number + 1,
                supersedes_plan_id=prior.plan_id,
                query_text=prior.query_text,
                status="generating",
            )
        )
        write_redemption_steps(
            connection,
            user_id=transfer.user_id,
            plan_id=result_plan_id,
            query_text=prior.query_text,
            plan_lineage_id=prior.plan_lineage_id,
            revision_number=prior.revision_number + 1,
            step_status="proposed",
        )
        service.promote_replan_job_success(
            job_id=job_id,
            worker_id=worker_id,
            result_plan_id=result_plan_id,
        )
    except Exception as exc:
        service.fail_replan_job(
            user_id=transfer.user_id,
            job_id=job_id,
            worker_id=worker_id,
            error=str(exc),
        )
        if result_plan_id is not None:
            _mark_generating_plan_failed(connection, result_plan_id)
        raise
    return _plan_snapshot(connection, result_plan_id)


def _mark_generating_plan_failed(connection: GraphConnection, plan_id: str) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE plans
               SET status = 'failed',
                   updated_at = now()
             WHERE id = %s
               AND status = 'generating'
            """,
            (plan_id,),
        )


def _promote_generating_plan_to_current(connection: GraphConnection, plan_id: str) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE plans
               SET status = 'current',
                   version = version + 1,
                   updated_at = now()
             WHERE id = %s
               AND status = 'generating'
            RETURNING id
            """,
            (plan_id,),
        )
        if cursor.fetchone() is None:
            raise RuntimeError(f"plan not in generating state before promotion: {plan_id}")


def _plan_snapshot(connection: GraphConnection, plan_id: str) -> HeroPlanSnapshot:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT
              p.id,
              p.plan_lineage_id,
              p.revision_number,
              p.status,
              p.query_text,
              count(DISTINCT ps.id),
              count(sd.id)
            FROM plans p
            LEFT JOIN plan_steps ps ON ps.plan_id = p.id
            LEFT JOIN state_dependencies sd ON sd.plan_step_id = ps.id
            WHERE p.id = %s
            GROUP BY p.id, p.plan_lineage_id, p.revision_number, p.status, p.query_text
            """,
            (plan_id,),
        )
        row = cursor.fetchone()

    if row is None:
        raise RuntimeError(f"plan not found after write: {plan_id}")

    (
        found_plan_id,
        plan_lineage_id,
        revision_number,
        status,
        query_text,
        step_count,
        dependency_count,
    ) = row
    return HeroPlanSnapshot(
        plan_id=str(found_plan_id),
        plan_lineage_id=str(plan_lineage_id),
        revision_number=int(revision_number),
        status=str(status),
        step_count=int(step_count),
        dependency_count=int(dependency_count),
        query_text=str(query_text),
    )
