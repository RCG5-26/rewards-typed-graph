"""Shared Python schema contract for the rewards typed graph MVP.

The Markdown architecture doc explains the model. This module is the importable
artifact agents and scripts can use to avoid hand-copying enum values and
attribute requirements.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Mapping, Optional, Sequence, Tuple


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

    return errors

