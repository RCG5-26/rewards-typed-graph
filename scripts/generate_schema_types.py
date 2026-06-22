#!/usr/bin/env python3
"""Generate Python and TypeScript schema contract artifacts."""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from typing import Any, Dict, Iterable, Mapping


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTRACT_PATH = REPO_ROOT / "schema" / "contracts" / "graph.schema.json"
GENERATED_DIR = REPO_ROOT / "schema" / "generated"
PYTHON_TYPES_PATH = GENERATED_DIR / "types.py"
TYPESCRIPT_TYPES_PATH = GENERATED_DIR / "types.ts"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail if committed generated files are out of date",
    )
    args = parser.parse_args()

    contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    expected = {
        PYTHON_TYPES_PATH: render_python_types(contract),
        TYPESCRIPT_TYPES_PATH: render_typescript_types(contract),
    }

    if args.check:
        stale = []
        for path, content in expected.items():
            if not path.exists() or path.read_text(encoding="utf-8") != content:
                stale.append(path.relative_to(REPO_ROOT).as_posix())
        if stale:
            print("Generated schema artifacts are stale:", file=sys.stderr)
            for path in stale:
                print(f"  {path}", file=sys.stderr)
            print("Run: python3 scripts/generate_schema_types.py", file=sys.stderr)
            return 1
        return 0

    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    for path, content in expected.items():
        path.write_text(content, encoding="utf-8")
    return 0


def render_python_types(contract: Mapping[str, Any]) -> str:
    graph = contract["x-graph"]
    node_types = tuple(contract["$defs"]["nodeTypes"]["enum"])
    edge_types = tuple(contract["$defs"]["edgeTypes"]["enum"])
    graph_tiers = tuple(contract["$defs"]["graphTiers"]["enum"])

    lines = [
        '"""Generated from schema/contracts/graph.schema.json. Do not edit by hand."""',
        "",
        "from __future__ import annotations",
        "",
        "from typing import Mapping, Optional, Tuple",
        "",
        f"NODE_TYPES: Tuple[str, ...] = {_tuple_repr(node_types)}",
        f"EDGE_TYPES: Tuple[str, ...] = {_tuple_repr(edge_types)}",
        f"GRAPH_TIERS: Tuple[str, ...] = {_tuple_repr(graph_tiers)}",
        f"PROGRAM_KINDS: Tuple[str, ...] = {_tuple_repr(graph['programKinds'])}",
        f"PLAN_STATUSES: Tuple[str, ...] = {_tuple_repr(graph['planStatuses'])}",
        f"PLAN_QUERY_STATUSES: Tuple[str, ...] = {_tuple_repr(graph['planQueryStatuses'])}",
        f"MUTATION_ACTIONS: Tuple[str, ...] = {_tuple_repr(graph['mutationActions'])}",
        f"EARN_TYPES: Tuple[str, ...] = {_tuple_repr(graph['earnTypes'])}",
        "",
        _python_mapping("NODE_REQUIRED_ATTRIBUTES", graph["nodeRequiredAttributes"], "Tuple[str, ...]"),
        _python_mapping("NODE_ATTRIBUTE_TYPES", graph["nodeAttributeTypes"], "Mapping[str, str]"),
        _python_mapping("NODE_TIERS", graph["nodeTiers"], "str"),
        _python_edge_rules(graph["edgeTypeRules"]),
        _python_mapping("EDGE_REQUIRED_ATTRIBUTES", graph["edgeRequiredAttributes"], "Tuple[str, ...]"),
        _python_mapping("EDGE_ATTRIBUTE_TYPES", graph["edgeAttributeTypes"], "Mapping[str, str]"),
        "",
    ]
    return "\n".join(lines)


def render_typescript_types(contract: Mapping[str, Any]) -> str:
    graph = contract["x-graph"]
    node_types = contract["$defs"]["nodeTypes"]["enum"]
    edge_types = contract["$defs"]["edgeTypes"]["enum"]
    graph_tiers = contract["$defs"]["graphTiers"]["enum"]

    return "\n".join(
        [
            "// Generated from schema/contracts/graph.schema.json. Do not edit by hand.",
            "",
            f"export const NODE_TYPES = {json.dumps(node_types, indent=2)} as const;",
            "export type NodeType = typeof NODE_TYPES[number];",
            "",
            f"export const EDGE_TYPES = {json.dumps(edge_types, indent=2)} as const;",
            "export type EdgeType = typeof EDGE_TYPES[number];",
            "",
            f"export const GRAPH_TIERS = {json.dumps(graph_tiers, indent=2)} as const;",
            "export type GraphTier = typeof GRAPH_TIERS[number];",
            "",
            f"export const PROGRAM_KINDS = {json.dumps(graph['programKinds'], indent=2)} as const;",
            "export type ProgramKind = typeof PROGRAM_KINDS[number];",
            "",
            f"export const PLAN_STATUSES = {json.dumps(graph['planStatuses'], indent=2)} as const;",
            "export type PlanStatus = typeof PLAN_STATUSES[number];",
            "",
            f"export const PLAN_QUERY_STATUSES = {json.dumps(graph['planQueryStatuses'], indent=2)} as const;",
            "export type PlanQueryStatus = typeof PLAN_QUERY_STATUSES[number];",
            "",
            f"export const MUTATION_ACTIONS = {json.dumps(graph['mutationActions'], indent=2)} as const;",
            "export type MutationAction = typeof MUTATION_ACTIONS[number];",
            "",
            f"export const EARN_TYPES = {json.dumps(graph['earnTypes'], indent=2)} as const;",
            "export type EarnType = typeof EARN_TYPES[number];",
            "",
            "export interface GraphNode {",
            "  type: NodeType;",
            "  tier: GraphTier;",
            "  attributes: Record<string, unknown>;",
            "  user_id?: string | null;",
            "  slug?: string | null;",
            "  version?: number;",
            "}",
            "",
            "export interface GraphEdge {",
            "  type: EdgeType;",
            "  source_type: NodeType;",
            "  target_type: NodeType;",
            "  attributes: Record<string, unknown>;",
            "  version?: number;",
            "}",
            "",
            _typescript_const("NODE_REQUIRED_ATTRIBUTES", graph["nodeRequiredAttributes"]),
            _typescript_const("NODE_ATTRIBUTE_TYPES", graph["nodeAttributeTypes"]),
            _typescript_const("NODE_TIERS", graph["nodeTiers"]),
            _typescript_const("EDGE_TYPE_RULES", graph["edgeTypeRules"]),
            _typescript_const("EDGE_REQUIRED_ATTRIBUTES", graph["edgeRequiredAttributes"]),
            _typescript_const("EDGE_ATTRIBUTE_TYPES", graph["edgeAttributeTypes"]),
            "",
        ]
    )


def _tuple_repr(values: Iterable[str]) -> str:
    return repr(tuple(values))


def _python_mapping(name: str, value: Mapping[str, Any], inner_type: str) -> str:
    rendered = _to_python_literal(value)
    return f"{name}: Mapping[str, {inner_type}] = {rendered}"


def _python_edge_rules(value: Mapping[str, Mapping[str, Any]]) -> str:
    compact = {
        edge_type: (rule["source"], rule["target"])
        for edge_type, rule in value.items()
    }
    return f"EDGE_TYPE_RULES: Mapping[str, Tuple[str, Optional[str]]] = {_to_python_literal(compact)}"


def _to_python_literal(value: Any) -> str:
    if isinstance(value, dict):
        items = ", ".join(
            f"{key!r}: {_to_python_literal(item)}" for key, item in value.items()
        )
        return "{" + items + "}"
    if isinstance(value, list):
        return repr(tuple(value))
    return repr(value)


def _typescript_const(name: str, value: Any) -> str:
    return f"export const {name} = {json.dumps(value, indent=2)} as const;"


if __name__ == "__main__":
    raise SystemExit(main())
