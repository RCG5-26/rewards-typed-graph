// Generated from schema/contracts/graph.schema.json. Do not edit by hand.

export const NODE_TYPES = [
  "User",
  "CreditCard",
  "RewardProgram",
  "SpendCategory",
  "RedemptionOption",
  "ExternalQuote",
  "UserBalance",
  "UserProgramStatus",
  "UserGoal",
  "Plan",
  "PlanStep",
  "AgentRun"
] as const;
export type NodeType = typeof NODE_TYPES[number];

export const EDGE_TYPES = [
  "HOLDS",
  "EARNS",
  "TRANSFERS_TO",
  "REDEEMS_VIA",
  "TARGETS",
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
  "issuer_transferable",
  "airline",
  "hotel",
  "cashback"
] as const;
export type ProgramKind = typeof PROGRAM_KINDS[number];

export const PLAN_STATUSES = [
  "generating",
  "current",
  "stale",
  "failed",
  "superseded"
] as const;
export type PlanStatus = typeof PLAN_STATUSES[number];

export const PLAN_QUERY_STATUSES = [
  "generating",
  "current",
  "stale",
  "failed",
  "superseded"
] as const;
export type PlanQueryStatus = typeof PLAN_QUERY_STATUSES[number];

export const MUTATION_ACTIONS = [
  "create_node",
  "update_node",
  "create_edge",
  "update_edge",
  "mark_stale",
  "supersede_plan_step",
  "transfer_points"
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
    "clerk_id"
  ],
  "CreditCard": [
    "name",
    "issuer",
    "network",
    "annual_fee_cents",
    "reward_program_id"
  ],
  "RewardProgram": [
    "name",
    "program_kind",
    "currency_name"
  ],
  "SpendCategory": [
    "name"
  ],
  "RedemptionOption": [
    "program_id",
    "option_type",
    "cpp_basis_points"
  ],
  "ExternalQuote": [
    "quote_type",
    "subject",
    "source_tool",
    "payload"
  ],
  "UserBalance": [
    "user_id",
    "program_id",
    "balance_points"
  ],
  "UserProgramStatus": [
    "user_id",
    "program_id",
    "status_tier"
  ],
  "UserGoal": [
    "user_id",
    "goal_type",
    "description"
  ],
  "Plan": [
    "plan_lineage_id",
    "revision_number",
    "query_text",
    "status"
  ],
  "PlanStep": [
    "plan_lineage_id",
    "revision_number",
    "step_order",
    "step_type",
    "status"
  ],
  "AgentRun": [
    "agent_type",
    "status"
  ]
} as const;
export const NODE_ATTRIBUTE_TYPES = {
  "User": {
    "clerk_id": "str",
    "email": "str|null"
  },
  "CreditCard": {
    "name": "str",
    "issuer": "str",
    "network": "str",
    "annual_fee_cents": "int",
    "reward_program_id": "str"
  },
  "RewardProgram": {
    "name": "str",
    "program_kind": "str",
    "currency_name": "str"
  },
  "SpendCategory": {
    "name": "str",
    "mcc_codes": "list[int]"
  },
  "RedemptionOption": {
    "program_id": "str",
    "option_type": "str",
    "cpp_basis_points": "int"
  },
  "ExternalQuote": {
    "quote_type": "str",
    "subject": "str",
    "source_tool": "str",
    "payload": "object"
  },
  "UserBalance": {
    "user_id": "str",
    "program_id": "str",
    "balance_points": "int"
  },
  "UserProgramStatus": {
    "user_id": "str",
    "program_id": "str",
    "status_tier": "str"
  },
  "UserGoal": {
    "user_id": "str",
    "goal_type": "str",
    "description": "str"
  },
  "Plan": {
    "plan_lineage_id": "str",
    "revision_number": "int",
    "query_text": "str",
    "status": "str"
  },
  "PlanStep": {
    "plan_lineage_id": "str",
    "revision_number": "int",
    "step_order": "int",
    "step_type": "str",
    "status": "str"
  },
  "AgentRun": {
    "agent_type": "str",
    "status": "str"
  }
} as const;
export const NODE_TIERS = {
  "User": "personal",
  "CreditCard": "world",
  "RewardProgram": "world",
  "SpendCategory": "world",
  "RedemptionOption": "world",
  "ExternalQuote": "world",
  "UserBalance": "personal",
  "UserProgramStatus": "personal",
  "UserGoal": "personal",
  "Plan": "plan",
  "PlanStep": "plan",
  "AgentRun": "plan"
} as const;
export const EDGE_TYPE_RULES = {
  "HOLDS": {
    "source": "User",
    "target": "CreditCard"
  },
  "EARNS": {
    "source": "CreditCard",
    "target": "SpendCategory"
  },
  "TRANSFERS_TO": {
    "source": "RewardProgram",
    "target": "RewardProgram"
  },
  "REDEEMS_VIA": {
    "source": "RewardProgram",
    "target": "RedemptionOption"
  },
  "TARGETS": {
    "source": "Plan",
    "target": "UserGoal"
  },
  "DEPENDS_ON": {
    "source": "PlanStep",
    "target": null
  }
} as const;
export const EDGE_REQUIRED_ATTRIBUTES = {
  "HOLDS": [],
  "EARNS": [
    "earn_rate_basis_points",
    "earn_type"
  ],
  "TRANSFERS_TO": [
    "transfer_ratio_basis_points",
    "is_active"
  ],
  "REDEEMS_VIA": [],
  "TARGETS": [],
  "DEPENDS_ON": [
    "target_table",
    "observed_version",
    "snapshot_value"
  ]
} as const;
export const EDGE_ATTRIBUTE_TYPES = {
  "HOLDS": {
    "opened_date": "str",
    "is_primary": "bool"
  },
  "EARNS": {
    "earn_rate_basis_points": "int",
    "earn_type": "str",
    "cap_amount_cents": "int|null"
  },
  "TRANSFERS_TO": {
    "transfer_ratio_basis_points": "int",
    "transfer_time_days": "int|null",
    "is_active": "bool"
  },
  "REDEEMS_VIA": {},
  "TARGETS": {},
  "DEPENDS_ON": {
    "target_table": "str",
    "observed_version": "int",
    "snapshot_value": "any"
  }
} as const;
