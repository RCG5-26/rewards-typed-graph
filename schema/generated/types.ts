// Generated from schema/contracts/graph.schema.json. Do not edit by hand.

export const NODE_TYPES = [
  "User",
  "Card",
  "Program",
  "MerchantCategory",
  "Balance",
  "Goal",
  "PlanQuery",
  "PlanStep"
] as const;
export type NodeType = typeof NODE_TYPES[number];

export const EDGE_TYPES = [
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
  "DEPENDS_ON"
] as const;
export type EdgeType = typeof EDGE_TYPES[number];

export const GRAPH_TIERS = [
  "world",
  "personal",
  "plan"
] as const;
export type GraphTier = typeof GRAPH_TIERS[number];

export const PROGRAM_KINDS = [
  "transferable",
  "airline",
  "hotel",
  "cashback"
] as const;
export type ProgramKind = typeof PROGRAM_KINDS[number];

export const PLAN_STATUSES = [
  "active",
  "stale",
  "superseded",
  "completed",
  "failed"
] as const;
export type PlanStatus = typeof PLAN_STATUSES[number];

export const PLAN_QUERY_STATUSES = [
  "active",
  "completed",
  "failed"
] as const;
export type PlanQueryStatus = typeof PLAN_QUERY_STATUSES[number];

export const MUTATION_ACTIONS = [
  "create_node",
  "update_node",
  "create_edge",
  "update_edge",
  "mark_stale",
  "supersede_plan_step"
] as const;
export type MutationAction = typeof MUTATION_ACTIONS[number];

export const EARN_TYPES = [
  "points",
  "miles",
  "cashback_pct"
] as const;
export type EarnType = typeof EARN_TYPES[number];

export interface GraphNode {
  type: NodeType;
  tier: GraphTier;
  attributes: Record<string, unknown>;
  user_id?: string | null;
  slug?: string | null;
  version?: number;
}

export interface GraphEdge {
  type: EdgeType;
  source_type: NodeType;
  target_type: NodeType;
  attributes: Record<string, unknown>;
  version?: number;
}

export const NODE_REQUIRED_ATTRIBUTES = {
  "User": [
    "name",
    "optimization_goal"
  ],
  "Card": [
    "name",
    "issuer",
    "network",
    "annual_fee_cents"
  ],
  "Program": [
    "name",
    "kind",
    "currency_name"
  ],
  "MerchantCategory": [
    "name"
  ],
  "Balance": [
    "program_id",
    "amount_points",
    "as_of",
    "source"
  ],
  "Goal": [
    "goal_type",
    "description"
  ],
  "PlanQuery": [
    "plan_lineage_id",
    "revision_number",
    "query_text",
    "status"
  ],
  "PlanStep": [
    "plan_lineage_id",
    "revision_number",
    "step_order",
    "agent",
    "claim",
    "inputs",
    "output",
    "status"
  ]
} as const;
export const NODE_ATTRIBUTE_TYPES = {
  "User": {
    "name": "str",
    "optimization_goal": "str"
  },
  "Card": {
    "name": "str",
    "issuer": "str",
    "network": "str",
    "annual_fee_cents": "int",
    "signup_bonus_points": "int",
    "signup_bonus_spend_cents": "int"
  },
  "Program": {
    "name": "str",
    "kind": "str",
    "currency_name": "str"
  },
  "MerchantCategory": {
    "name": "str",
    "mcc_codes": "list[int]"
  },
  "Balance": {
    "program_id": "str",
    "amount_points": "int",
    "as_of": "str",
    "source": "str"
  },
  "Goal": {
    "goal_type": "str",
    "description": "str",
    "target_program_id": "str",
    "target_location": "str",
    "target_date": "str"
  },
  "PlanQuery": {
    "plan_lineage_id": "str",
    "revision_number": "int",
    "query_text": "str",
    "status": "str",
    "summary": "str|null"
  },
  "PlanStep": {
    "plan_lineage_id": "str",
    "revision_number": "int",
    "step_order": "int",
    "agent": "str",
    "claim": "str",
    "inputs": "object",
    "output": "object",
    "status": "str",
    "stale_reason": "str|null",
    "supersedes_plan_step_id": "str|null",
    "superseded_by_plan_step_id": "str|null"
  }
} as const;
export const NODE_TIERS = {
  "User": "personal",
  "Card": "world",
  "Program": "world",
  "MerchantCategory": "world",
  "Balance": "personal",
  "Goal": "personal",
  "PlanQuery": "plan",
  "PlanStep": "plan"
} as const;
export const EDGE_TYPE_RULES = {
  "HOLDS": {
    "source": "User",
    "target": "Card"
  },
  "ASSOCIATED_WITH": {
    "source": "Card",
    "target": "Program"
  },
  "EARNS": {
    "source": "Card",
    "target": "MerchantCategory"
  },
  "HAS_BALANCE": {
    "source": "User",
    "target": "Balance"
  },
  "BALANCE_FOR": {
    "source": "Balance",
    "target": "Program"
  },
  "HAS_GOAL": {
    "source": "User",
    "target": "Goal"
  },
  "FOR_USER": {
    "source": "PlanQuery",
    "target": "User"
  },
  "TRANSFERS_TO": {
    "source": "Program",
    "target": "Program"
  },
  "TARGETS": {
    "source": "PlanQuery",
    "target": "Goal"
  },
  "STEP_OF": {
    "source": "PlanStep",
    "target": "PlanQuery"
  },
  "DEPENDS_ON": {
    "source": "PlanStep",
    "target": null
  }
} as const;
export const EDGE_REQUIRED_ATTRIBUTES = {
  "HOLDS": [],
  "ASSOCIATED_WITH": [],
  "EARNS": [
    "earn_rate_basis_points",
    "earn_type"
  ],
  "HAS_BALANCE": [],
  "BALANCE_FOR": [],
  "HAS_GOAL": [],
  "FOR_USER": [],
  "TRANSFERS_TO": [
    "ratio_num",
    "ratio_den",
    "transfer_time_days",
    "is_active"
  ],
  "TARGETS": [],
  "STEP_OF": [],
  "DEPENDS_ON": [
    "observed_version",
    "observed_value"
  ]
} as const;
export const EDGE_ATTRIBUTE_TYPES = {
  "HOLDS": {
    "opened_date": "str",
    "is_primary": "bool"
  },
  "ASSOCIATED_WITH": {},
  "EARNS": {
    "earn_rate_basis_points": "int",
    "earn_type": "str",
    "cap_amount_cents": "int|null"
  },
  "HAS_BALANCE": {},
  "BALANCE_FOR": {},
  "HAS_GOAL": {},
  "FOR_USER": {},
  "TRANSFERS_TO": {
    "ratio_num": "int",
    "ratio_den": "int",
    "transfer_time_days": "int",
    "is_active": "bool"
  },
  "TARGETS": {},
  "STEP_OF": {},
  "DEPENDS_ON": {
    "observed_version": "int",
    "observed_property": "str|null",
    "observed_value": "any"
  }
} as const;
