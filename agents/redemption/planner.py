"""Deterministic redemption planning over the Person C seeded fixture.

This is not the graph-write implementation. It is the executable RCG-20
planning slice: read seeded facts, choose a valid redemption, and emit a plan
draft with dependency records that can be mapped to `state_dependencies` once
the write path and mutation contracts are ready.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

BASIS_POINTS_ONE = 10_000


class RedemptionPlanningError(ValueError):
    """Raised when the seeded fixture cannot support a requested plan."""


def load_fixture(path: str | Path) -> dict[str, Any]:
    with Path(path).open("r", encoding="utf-8") as fixture_file:
        return json.load(fixture_file)


def value_basis_points(cash_total_cents: int, points_total: int) -> int:
    """Return cents-per-point value in basis points using integer math."""

    if points_total <= 0:
        raise RedemptionPlanningError("points_total must be positive")
    return (cash_total_cents * BASIS_POINTS_ONE + points_total // 2) // points_total


def format_cpp(value_bp: int) -> str:
    return f"{value_bp / BASIS_POINTS_ONE:.2f}"


def plan_redemption(
    fixture: dict[str, Any],
    *,
    balance_points: int | None = None,
    query_text: str | None = None,
    overrides: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build a plan draft from seeded graph facts.

    The function intentionally returns a serializable dictionary so the same
    result can feed benchmark tests, baseline prompts, and future MutationBatch
    mapping code without sharing hidden state.
    """

    working_fixture = _fixture_with_overrides(fixture, overrides or {})
    request = working_fixture["trip_request"]
    query = query_text or request["query_text"]

    unsupported_reason = _unsupported_query_reason(query, working_fixture)
    balance = _balance_for_request(working_fixture, balance_points)
    dependency = _balance_dependency(balance)

    if unsupported_reason is not None:
        return _unsupported_plan(query, balance, dependency, unsupported_reason)

    transfer_path = _active_transfer_path(working_fixture)
    candidates = _candidate_awards(working_fixture, transfer_path, balance["balance_points"])

    if not candidates:
        rejected_options = [
            _rejection_summary(award, transfer_path, balance["balance_points"])
            for award in _query_scoped_awards(working_fixture)
        ]
        return _cash_fallback_plan(query, balance, dependency, rejected_options)

    ranked = sorted(
        candidates,
        key=lambda candidate: (
            -candidate["value_basis_points"],
            candidate["required_source_points"],
            candidate["cash_total_cents"],
            candidate["award_slug"],
        ),
    )
    winner = ranked[0]
    backup = ranked[1] if len(ranked) > 1 else None

    steps = [
        _step(
            order=1,
            step_type="transfer_recommendation",
            action=f"Transfer {winner['required_source_points']:,} Chase Ultimate Rewards points to World of Hyatt.",
            reasoning=(
                "The seeded Chase to Hyatt transfer path is 1:1, so the Hyatt "
                f"award needs {winner['required_source_points']:,} Chase points."
            ),
            payload={
                "source_program_slug": transfer_path["source_program_slug"],
                "dest_program_slug": transfer_path["dest_program_slug"],
                "transfer_ratio_basis_points": transfer_path["transfer_ratio_basis_points"],
                "required_source_points": winner["required_source_points"],
            },
            dependency=dependency,
        ),
        _step(
            order=2,
            step_type="redemption_recommendation",
            action=f"Book {winner['hotel_name']} for {winner['points_total']:,} Hyatt points.",
            reasoning=(
                f"{winner['hotel_name']} gives {format_cpp(winner['value_basis_points'])} "
                f"cents per point against the ${winner['cash_total_cents'] / 100:,.0f} seeded cash price, "
                "which is the highest affordable seeded option."
            ),
            payload={
                "award_slug": winner["award_slug"],
                "hotel_slug": winner["hotel_slug"],
                "hotel_name": winner["hotel_name"],
                "points_total": winner["points_total"],
                "cash_total_cents": winner["cash_total_cents"],
                "value_basis_points": winner["value_basis_points"],
                "candidate_fact_slugs": winner["candidate_fact_slugs"],
            },
            dependency=dependency,
        ),
    ]

    if backup is not None:
        steps.append(
            _step(
                order=3,
                step_type="redemption_recommendation",
                action=f"Keep {backup['hotel_name']} as the backup at {backup['points_total']:,} Hyatt points.",
                reasoning=(
                    f"It is still affordable and returns {format_cpp(backup['value_basis_points'])} "
                    "cents per point, but it trails the top seeded option."
                ),
                payload={
                    "award_slug": backup["award_slug"],
                    "hotel_slug": backup["hotel_slug"],
                    "hotel_name": backup["hotel_name"],
                    "points_total": backup["points_total"],
                    "cash_total_cents": backup["cash_total_cents"],
                    "value_basis_points": backup["value_basis_points"],
                    "candidate_fact_slugs": backup["candidate_fact_slugs"],
                },
                dependency=dependency,
            )
        )
    else:
        steps.append(
            _step(
                order=3,
                step_type="redemption_recommendation",
                action="No backup award is affordable in the seeded fixture.",
                reasoning="The plan should fall back to cash if the winning award becomes unaffordable or unavailable.",
                payload={"fallback": "cash_if_winner_invalidates"},
                dependency=dependency,
            )
        )

    return {
        "plan_kind": "person_c_redemption_draft",
        "status": "current",
        "query_text": query,
        "balance_points": balance["balance_points"],
        "chosen_award_slug": winner["award_slug"],
        "backup_award_slug": backup["award_slug"] if backup else None,
        "fallback": None,
        "ranked_awards": ranked,
        "steps": steps,
    }


def plan_direct_redemption(
    fixture: dict[str, Any],
    *,
    balance_points: int | None = None,
    query_text: str | None = None,
) -> dict[str, Any]:
    """Build a direct-redemption plan where the user already holds the target program's points.

    Used for Scenario 2 (World of Hyatt Credit Card): no transfer step is emitted
    because the balance is already in the hotel program.
    """
    request = fixture["trip_request"]
    query = query_text or request["query_text"]

    balance = _balance_for_request(fixture, balance_points)
    dependency = _balance_dependency(balance)
    candidates = _candidate_awards_direct(fixture, balance["balance_points"])

    if not candidates:
        rejected_options = [
            _rejection_summary_direct(award, balance["balance_points"])
            for award in _query_scoped_awards(fixture)
        ]
        return _cash_fallback_plan(query, balance, dependency, rejected_options)

    ranked = sorted(
        candidates,
        key=lambda c: (-c["value_basis_points"], c["required_source_points"], c["cash_total_cents"], c["award_slug"]),
    )
    winner = ranked[0]

    step = _step(
        order=1,
        step_type="redemption_recommendation",
        action=f"Book {winner['hotel_name']} for {winner['points_total']:,} Hyatt points.",
        reasoning=(
            f"{winner['hotel_name']} gives {format_cpp(winner['value_basis_points'])} "
            f"cents per point against the ${winner['cash_total_cents'] / 100:,.0f} cash price."
        ),
        payload={
            "award_slug": winner["award_slug"],
            "hotel_slug": winner["hotel_slug"],
            "hotel_name": winner["hotel_name"],
            "points_total": winner["points_total"],
            "cash_total_cents": winner["cash_total_cents"],
            "value_basis_points": winner["value_basis_points"],
        },
        dependency=dependency,
    )

    return {
        "plan_kind": "person_c_redemption_draft",
        "status": "current",
        "query_text": query,
        "balance_points": balance["balance_points"],
        "chosen_award_slug": winner["award_slug"],
        "backup_award_slug": ranked[1]["award_slug"] if len(ranked) > 1 else None,
        "fallback": None,
        "ranked_awards": ranked,
        "steps": [step],
    }


def _candidate_awards_direct(fixture: dict[str, Any], balance_points: int) -> list[dict[str, Any]]:
    """Candidates affordable directly in the target program — no transfer calculation."""
    hotel_by_slug = {hotel["slug"]: hotel for hotel in fixture["hotels"]}
    candidates: list[dict[str, Any]] = []

    for award in _query_scoped_awards(fixture):
        if not award["available"]:
            continue
        if award["points_total"] > balance_points:
            continue

        hotel = hotel_by_slug[award["hotel_slug"]]
        calculated_value = value_basis_points(award["cash_total_cents"], award["points_total"])
        if calculated_value != award["value_basis_points"]:
            raise RedemptionPlanningError(f"award value_basis_points mismatch: {award['slug']}")

        candidates.append({
            "award_slug": award["slug"],
            "hotel_slug": award["hotel_slug"],
            "hotel_name": hotel["display_name"],
            "points_total": award["points_total"],
            "required_source_points": award["points_total"],
            "cash_total_cents": award["cash_total_cents"],
            "value_basis_points": award["value_basis_points"],
        })

    return candidates


def _rejection_summary_direct(award: dict[str, Any], balance_points: int) -> dict[str, Any]:
    """Explain why a direct-redemption award was skipped (unavailable or unaffordable)."""
    reasons: list[str] = []
    if not award["available"]:
        reasons.append("unavailable")
    if award["points_total"] > balance_points:
        reasons.append("unaffordable")
    return {
        "award_slug": award["slug"],
        "required_source_points": award["points_total"],
        "available": award["available"],
        "reasons": reasons,
    }


def apply_balance_delta(fixture: dict[str, Any], balance_slug: str, delta_points: int) -> dict[str, Any]:
    """Return a copied fixture with one balance updated and version incremented."""

    updated = copy.deepcopy(fixture)
    for balance in updated["balances"]:
        if balance["slug"] == balance_slug:
            next_balance = balance["balance_points"] + delta_points
            if next_balance < 0:
                raise RedemptionPlanningError("balance mutation would make points negative")
            balance["balance_points"] = next_balance
            balance["version"] += 1
            return updated
    raise RedemptionPlanningError(f"unknown balance slug: {balance_slug}")


def find_stale_steps_for_balance(plan: dict[str, Any], balance: dict[str, Any]) -> list[dict[str, Any]]:
    """Return plan steps whose balance dependency no longer matches the balance."""

    stale_steps: list[dict[str, Any]] = []
    for step in plan["steps"]:
        for dependency in step["state_dependencies"]:
            if dependency["target_slug"] != balance["slug"]:
                continue
            observed_balance = dependency["snapshot_value"]["balance_points"]
            observed_version = dependency["observed_version"]
            if observed_balance != balance["balance_points"] or observed_version != balance["version"]:
                stale_steps.append(
                    {
                        "step_order": step["step_order"],
                        "step_type": step["step_type"],
                        "target_slug": balance["slug"],
                        "stale_reason": (
                            f"user_balances:{balance['slug']} balance_points "
                            f"{observed_balance} -> {balance['balance_points']}"
                        ),
                    }
                )
    return stale_steps


def _fixture_with_overrides(fixture: dict[str, Any], overrides: dict[str, dict[str, Any]]) -> dict[str, Any]:
    copied = copy.deepcopy(fixture)
    award_by_slug = {award["slug"]: award for award in copied["award_options"]}
    for award_slug, changes in overrides.items():
        if award_slug not in award_by_slug:
            raise RedemptionPlanningError(f"override references unknown award: {award_slug}")
        award_by_slug[award_slug].update(changes)
    return copied


def _unsupported_query_reason(query_text: str, fixture: dict[str, Any]) -> str | None:
    normalized = query_text.lower()
    seeded_program_names = {program["display_name"].lower() for program in fixture["programs"]}

    if "marriott" in normalized and not any("marriott" in program for program in seeded_program_names):
        return "unsupported_by_seed_fixture"
    return None


def _balance_for_request(fixture: dict[str, Any], balance_points: int | None) -> dict[str, Any]:
    request = fixture["trip_request"]
    balances = [
        balance
        for balance in fixture["balances"]
        if balance["user_slug"] == request["user_slug"]
        and balance["program_slug"] == fixture["scope"]["source_program_slug"]
    ]
    if len(balances) != 1:
        raise RedemptionPlanningError("expected exactly one source balance for request")

    balance = copy.deepcopy(balances[0])
    if balance_points is not None:
        balance["balance_points"] = balance_points
    return balance


def _active_transfer_path(fixture: dict[str, Any]) -> dict[str, Any]:
    source_program_slug = fixture["scope"]["source_program_slug"]
    target_program_slug = fixture["scope"]["target_program_slug"]
    paths = [
        transfer_path
        for transfer_path in fixture["transfer_paths"]
        if transfer_path["source_program_slug"] == source_program_slug
        and transfer_path["dest_program_slug"] == target_program_slug
        and transfer_path["transfer_ratio_basis_points"] > 0
    ]
    if len(paths) != 1:
        raise RedemptionPlanningError("expected exactly one active transfer path")
    return paths[0]


def _candidate_awards(
    fixture: dict[str, Any],
    transfer_path: dict[str, Any],
    balance_points: int,
) -> list[dict[str, Any]]:
    hotel_by_slug = {hotel["slug"]: hotel for hotel in fixture["hotels"]}
    candidates: list[dict[str, Any]] = []

    for award in _query_scoped_awards(fixture):
        if not award["available"]:
            continue

        required_source_points = _source_points_required(
            award["points_total"], transfer_path["transfer_ratio_basis_points"]
        )
        if required_source_points > balance_points:
            continue

        hotel = hotel_by_slug[award["hotel_slug"]]
        calculated_value = value_basis_points(award["cash_total_cents"], award["points_total"])
        if calculated_value != award["value_basis_points"]:
            raise RedemptionPlanningError(f"award value_basis_points mismatch: {award['slug']}")

        candidates.append(
            {
                "award_slug": award["slug"],
                "hotel_slug": award["hotel_slug"],
                "hotel_name": hotel["display_name"],
                "points_total": award["points_total"],
                "required_source_points": required_source_points,
                "cash_total_cents": award["cash_total_cents"],
                "value_basis_points": award["value_basis_points"],
                "candidate_fact_slugs": [
                    transfer_path["slug"],
                    award["slug"],
                    award["hotel_slug"],
                    award["cash_quote_slug"],
                ],
            }
        )

    return candidates


def _query_scoped_awards(fixture: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        award
        for award in fixture["award_options"]
        if award["program_slug"] == fixture["scope"]["target_program_slug"]
        and award["city"] == fixture["scope"]["destination_city"]
        and award["nights"] == fixture["scope"]["nights"]
    ]


def _source_points_required(dest_points: int, transfer_ratio_basis_points: int) -> int:
    return (dest_points * BASIS_POINTS_ONE + transfer_ratio_basis_points - 1) // transfer_ratio_basis_points


def _balance_dependency(balance: dict[str, Any]) -> dict[str, Any]:
    return {
        "target_slug": balance["slug"],
        "target_table": "user_balances",
        "target_node_type": "UserBalance",
        "depended_property": "balance_points",
        "observed_version": balance["version"],
        "snapshot_value": {
            "balance_points": balance["balance_points"],
            "program_slug": balance["program_slug"],
        },
    }


def _step(
    *,
    order: int,
    step_type: str,
    action: str,
    reasoning: str,
    payload: dict[str, Any],
    dependency: dict[str, Any],
) -> dict[str, Any]:
    return {
        "step_order": order,
        "step_type": step_type,
        "status": "current",
        "action": action,
        "reasoning": reasoning,
        "payload": payload,
        "state_dependencies": [copy.deepcopy(dependency)],
    }


def _cash_fallback_plan(
    query: str,
    balance: dict[str, Any],
    dependency: dict[str, Any],
    rejected_options: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "plan_kind": "person_c_redemption_draft",
        "status": "current",
        "query_text": query,
        "balance_points": balance["balance_points"],
        "chosen_award_slug": None,
        "backup_award_slug": None,
        "fallback": "cash",
        "ranked_awards": [],
        "rejected_options": rejected_options,
        "steps": [
            _step(
                order=1,
                step_type="redemption_recommendation",
                action="Use cash or wait for a better seeded award.",
                reasoning="No available seeded award is affordable with the current Chase balance.",
                payload={"fallback": "cash", "rejected_options": rejected_options},
                dependency=dependency,
            )
        ],
    }


def _unsupported_plan(
    query: str,
    balance: dict[str, Any],
    dependency: dict[str, Any],
    reason: str,
) -> dict[str, Any]:
    return {
        "plan_kind": "person_c_redemption_draft",
        "status": "unsupported",
        "query_text": query,
        "balance_points": balance["balance_points"],
        "chosen_award_slug": None,
        "backup_award_slug": None,
        "fallback": None,
        "unsupported_reason": reason,
        "ranked_awards": [],
        "steps": [
            _step(
                order=1,
                step_type="redemption_recommendation",
                action="No recommendation from the seeded fixture.",
                reasoning="The request asks for a program or option that is not present in the Person C seed data.",
                payload={"unsupported_reason": reason},
                dependency=dependency,
            )
        ],
    }


def _rejection_summary(
    award: dict[str, Any],
    transfer_path: dict[str, Any],
    balance_points: int,
) -> dict[str, Any]:
    required_source_points = _source_points_required(
        award["points_total"], transfer_path["transfer_ratio_basis_points"]
    )
    reasons: list[str] = []
    if not award["available"]:
        reasons.append("unavailable")
    if required_source_points > balance_points:
        reasons.append("unaffordable")
    return {
        "award_slug": award["slug"],
        "required_source_points": required_source_points,
        "available": award["available"],
        "reasons": reasons,
    }
