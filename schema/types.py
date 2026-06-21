"""Python validators for the generated rewards typed graph MVP contract.

The canonical schema contract lives in schema/contracts/graph.schema.json.
Generated constants are imported from schema.generated.types; this module keeps
the hand-written validation behavior layered on top of that shared contract.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Mapping, Optional, Sequence

from schema.generated.types import (
    EARN_TYPES,
    EDGE_ATTRIBUTE_TYPES,
    EDGE_REQUIRED_ATTRIBUTES,
    EDGE_TYPE_RULES,
    EDGE_TYPES,
    GRAPH_TIERS,
    MUTATION_ACTIONS,
    NODE_ATTRIBUTE_TYPES,
    NODE_REQUIRED_ATTRIBUTES,
    NODE_TIERS,
    NODE_TYPES,
    PLAN_QUERY_STATUSES,
    PLAN_STATUSES,
    PROGRAM_KINDS,
)


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

    if node.type == "PlanQuery":
        status = node.attributes.get("status")
        if status is not None and status not in PLAN_QUERY_STATUSES:
            errors.append(
                f"PlanQuery.attributes.status must be one of {PLAN_QUERY_STATUSES}"
            )

    if node.type == "PlanStep":
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
