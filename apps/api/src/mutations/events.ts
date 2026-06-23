export type JsonObject = Record<string, unknown>;

export interface GraphMutationRow {
  id: bigint | number | string;
  mutation_txn_id: string;
  user_id: string;
  plan_lineage_id: string | null;
  plan_id: string | null;
  agent_run_id: string | null;
  mutation_type: string;
  target_table: string | null;
  target_node_id: string | null;
  summary: string;
  before: JsonObject | null;
  after: JsonObject | null;
  committed_at: Date | string;
}

export interface MutationEvent {
  event_id: string;
  mutation_txn_id: string;
  user_id: string;
  plan_lineage_id: string | null;
  plan_id: string | null;
  agent_run_id: string | null;
  mutation_type: string;
  target_table: string | null;
  target_node_id: string | null;
  summary: string;
  before: JsonObject | null;
  after: JsonObject | null;
  committed_at: string;
}

export function toMutationEvent(row: GraphMutationRow): MutationEvent {
  return {
    event_id: String(row.id),
    mutation_txn_id: row.mutation_txn_id,
    user_id: row.user_id,
    plan_lineage_id: row.plan_lineage_id,
    plan_id: row.plan_id,
    agent_run_id: row.agent_run_id,
    mutation_type: row.mutation_type,
    target_table: row.target_table,
    target_node_id: row.target_node_id,
    summary: row.summary,
    before: row.before,
    after: row.after,
    committed_at:
      row.committed_at instanceof Date
        ? row.committed_at.toISOString()
        : row.committed_at,
  };
}
