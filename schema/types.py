"""Shared Python schema contract for the rewards typed graph MVP.

The Markdown architecture doc explains the model. This module is the importable
artifact agents and scripts can use to avoid hand-copying enum values and
attribute requirements.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Mapping, Optional, Sequence, Tuple


NODE_TYPES: Tuple[str, ...] = (
    "User",
    "Card",
    "Program",
    "MerchantCategory",
    "Balance",
    "Goal",
    "PlanQuery",
    "PlanStep",
)

EDGE_TYPES: Tuple[str, ...] = (
    "HOLDS",
    "ASSOCIATED_WITH",
    "EARNS",
    "HAS_BALANCE",
    "BALANCE_FOR",
    "HAS_GOAL",
    "FOR_USER",
    "TRANSFERS_TO",
    "TARGETS",
    "STEP_OF",
    "DEPENDS_ON",
)

GRAPH_TIERS: Tuple[str, ...] = ("world", "personal", "plan")

PROGRAM_KINDS: Tuple[str, ...] = (
    "transferable",
    "airline",
    "hotel",
    "cashback",
)

PLAN_STATUSES: Tuple[str, ...] = (
    "active",
    "stale",
    "superseded",
    "completed",
    "failed",
)

MUTATION_ACTIONS: Tuple[str, ...] = (
    "create_node",
    "update_node",
    "create_edge",
    "update_edge",
    "mark_stale",
    "supersede_plan_step",
)

NODE_REQUIRED_ATTRIBUTES: Mapping[str, Tuple[str, ...]] = {
    "User": ("name", "optimization_goal"),
    "Card": ("name", "issuer", "network", "annual_fee_cents"),
    "Program": ("name", "kind", "currency_name"),
    "MerchantCategory": ("name",),
    "Balance": ("program_id", "amount_points", "as_of", "source"),
    "Goal": ("goal_type", "description"),
    "PlanQuery": ("query_text", "status"),
    "PlanStep": ("step_order", "agent", "claim", "inputs", "output", "status"),
}

NODE_ATTRIBUTE_TYPES: Mapping[str, Mapping[str, str]] = {
    "User": {
        "name": "str",
        "optimization_goal": "str",
    },
    "Card": {
        "name": "str",
        "issuer": "str",
        "network": "str",
        "annual_fee_cents": "int",
        "signup_bonus_points": "int",
        "signup_bonus_spend_cents": "int",
    },
    "Program": {
        "name": "str",
        "kind": "str",
        "currency_name": "str",
    },
    "MerchantCategory": {
        "name": "str",
        "mcc_codes": "list[int]",
    },
    "Balance": {
        "program_id": "str",
        "amount_points": "int",
        "as_of": "str",
        "source": "str",
    },
    "Goal": {
        "goal_type": "str",
        "description": "str",
        "target_program_id": "str",
        "target_location": "str",
        "target_date": "str",
    },
    "PlanQuery": {
        "query_text": "str",
        "status": "str",
        "summary": "str|null",
    },
    "PlanStep": {
        "step_order": "int",
        "agent": "str",
        "claim": "str",
        "inputs": "object",
        "output": "object",
        "status": "str",
        "stale_reason": "str|null",
    },
}

NODE_TIERS: Mapping[str, str] = {
    "User": "personal",
    "Card": "world",
    "Program": "world",
    "MerchantCategory": "world",
    "Balance": "personal",
    "Goal": "personal",
    "PlanQuery": "plan",
    "PlanStep": "plan",
}

# A target type of None means any node type is allowed.
EDGE_TYPE_RULES: Mapping[str, Tuple[str, Optional[str]]] = {
    "HOLDS": ("User", "Card"),
    "ASSOCIATED_WITH": ("Card", "Program"),
    "EARNS": ("Card", "MerchantCategory"),
    "HAS_BALANCE": ("User", "Balance"),
    "BALANCE_FOR": ("Balance", "Program"),
    "HAS_GOAL": ("User", "Goal"),
    "FOR_USER": ("PlanQuery", "User"),
    "TRANSFERS_TO": ("Program", "Program"),
    "TARGETS": ("PlanQuery", "Goal"),
    "STEP_OF": ("PlanStep", "PlanQuery"),
    "DEPENDS_ON": ("PlanStep", None),
}

EDGE_REQUIRED_ATTRIBUTES: Mapping[str, Tuple[str, ...]] = {
    "HOLDS": (),
    "ASSOCIATED_WITH": (),
    "EARNS": ("earn_rate_basis_points", "earn_type"),
    "HAS_BALANCE": (),
    "BALANCE_FOR": (),
    "HAS_GOAL": (),
    "FOR_USER": (),
    "TRANSFERS_TO": ("ratio_num", "ratio_den", "transfer_time_days", "is_active"),
    "TARGETS": (),
    "STEP_OF": (),
    "DEPENDS_ON": ("observed_version", "observed_value"),
}

EDGE_ATTRIBUTE_TYPES: Mapping[str, Mapping[str, str]] = {
    "HOLDS": {
        "opened_date": "str",
        "is_primary": "bool",
    },
    "ASSOCIATED_WITH": {},
    "EARNS": {
        "earn_rate_basis_points": "int",
        "earn_type": "str",
        "cap_amount_cents": "int|null",
    },
    "HAS_BALANCE": {},
    "BALANCE_FOR": {},
    "HAS_GOAL": {},
    "FOR_USER": {},
    "TRANSFERS_TO": {
        "ratio_num": "int",
        "ratio_den": "int",
        "transfer_time_days": "int",
        "is_active": "bool",
    },
    "TARGETS": {},
    "STEP_OF": {},
    "DEPENDS_ON": {
        "observed_version": "int",
        "observed_property": "str|null",
        "observed_value": "any",
    },
}

EARN_TYPES: Tuple[str, ...] = ("points", "miles", "cashback_pct")


@dataclass(frozen=True)
class GraphNode:
    """Minimal node payload accepted by the MVP graph write path."""

    type: str
    tier: str
    attributes: Dict[str, Any] = field(default_factory=dict)
    user_id: Optional[str] = None
    slug: Optional[str] = None
    version: int = 0


@dataclass(frozen=True)
class GraphEdge:
    """Minimal edge payload accepted by the MVP graph write path."""

    type: str
    source_type: str
    target_type: str
    attributes: Dict[str, Any] = field(default_factory=dict)
    version: int = 0


def validate_node(node: GraphNode) -> Sequence[str]:
    """Return validation errors for a node payload.

    The validator intentionally stays structural and deterministic. Deeper
    domain checks, such as UUID shape or timestamp parsing, belong in the graph
    write service once the application stack exists.
    """

    errors = []

    if node.type not in NODE_TYPES:
        return [f"unknown node type: {node.type}"]

    if node.tier not in GRAPH_TIERS:
        errors.append(f"{node.type}.tier must be one of {GRAPH_TIERS}, got {node.tier}")

    expected_tier = NODE_TIERS[node.type]
    if node.tier != expected_tier:
        errors.append(f"{node.type}.tier must be {expected_tier}, got {node.tier}")

    if node.version < 0:
        errors.append(f"{node.type}.version must be nonnegative")

    for field_name in NODE_REQUIRED_ATTRIBUTES[node.type]:
        if field_name not in node.attributes:
            errors.append(f"{node.type}.attributes missing required field: {field_name}")

    errors.extend(_validate_attributes(node.type, node.attributes, NODE_ATTRIBUTE_TYPES))

    if node.type == "Program":
        kind = node.attributes.get("kind")
        if kind is not None and kind not in PROGRAM_KINDS:
            errors.append(f"Program.attributes.kind must be one of {PROGRAM_KINDS}")

    if node.type in ("PlanQuery", "PlanStep"):
        status = node.attributes.get("status")
        if status is not None and status not in PLAN_STATUSES:
            errors.append(f"{node.type}.attributes.status must be one of {PLAN_STATUSES}")

    return errors


def validate_edge(edge: GraphEdge) -> Sequence[str]:
    """Return validation errors for an edge payload."""

    errors = []

    if edge.type not in EDGE_TYPES:
        return [f"unknown edge type: {edge.type}"]

    if edge.version < 0:
        errors.append(f"{edge.type}.version must be nonnegative")

    expected_source, expected_target = EDGE_TYPE_RULES[edge.type]
    if edge.source_type != expected_source:
        errors.append(
            f"{edge.type} edge source must be {expected_source}, got {edge.source_type}"
        )

    if expected_target is not None and edge.target_type != expected_target:
        errors.append(
            f"{edge.type} edge target must be {expected_target}, got {edge.target_type}"
        )

    for field_name in EDGE_REQUIRED_ATTRIBUTES[edge.type]:
        if field_name not in edge.attributes:
            errors.append(f"{edge.type}.attributes missing required field: {field_name}")

    errors.extend(_validate_attributes(edge.type, edge.attributes, EDGE_ATTRIBUTE_TYPES))

    if edge.type == "EARNS":
        earn_type = edge.attributes.get("earn_type")
        if earn_type is not None and earn_type not in EARN_TYPES:
            errors.append(f"EARNS.attributes.earn_type must be one of {EARN_TYPES}")

    return errors


def _validate_attributes(
    owner: str,
    attributes: Mapping[str, Any],
    schemas: Mapping[str, Mapping[str, str]],
) -> Sequence[str]:
    errors = []

    for field_name, expected_type in schemas[owner].items():
        if field_name not in attributes:
            continue

        value = attributes[field_name]
        if not _matches_schema_type(value, expected_type):
            errors.append(
                f"{owner}.attributes.{field_name} must be {_type_error_label(expected_type)}"
            )

    return errors


def _matches_schema_type(value: Any, expected_type: str) -> bool:
    validators: Mapping[str, Callable[[Any], bool]] = {
        "any": lambda _: True,
        "bool": lambda candidate: isinstance(candidate, bool),
        "int": lambda candidate: isinstance(candidate, int)
        and not isinstance(candidate, bool),
        "int|null": lambda candidate: candidate is None
        or (isinstance(candidate, int) and not isinstance(candidate, bool)),
        "list[int]": lambda candidate: isinstance(candidate, list)
        and all(isinstance(item, int) and not isinstance(item, bool) for item in candidate),
        "object": lambda candidate: isinstance(candidate, dict),
        "str": lambda candidate: isinstance(candidate, str),
        "str|null": lambda candidate: candidate is None or isinstance(candidate, str),
    }

    return validators[expected_type](value)


def _type_error_label(expected_type: str) -> str:
    return {
        "int|null": "int or null",
        "str|null": "str or null",
    }.get(expected_type, expected_type)
