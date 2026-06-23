"""Hero flow API — integration seam for Jun 25 gate.

Implement these functions to turn the hero integration test green:

- ``create_plan_from_query`` — Raq (RCG-15/28) + Michael (RCG-21)
- ``replan_after_balance_transfer`` — Raq + Michael (RCG-29)

Until implemented, ``test_hero_end_to_end`` fails with ``NotImplementedError``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


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
    raise NotImplementedError(
        "Raq + Michael: wire orchestrator → redemption graph writer. "
        "See tests/integration/test_hero_moment.py and context/feature-specs/05-orchestrator-harness.md"
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
    raise NotImplementedError(
        "Raq + Michael: implement synchronous re-plan after TransferPoints staleness. "
        "See context/feature-specs/04-redemption-traversal.md Flow 2"
    )
