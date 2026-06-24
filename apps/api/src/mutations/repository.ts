import { type GraphMutationRow, toMutationEvent } from "./events";

export interface QueryClient {
  query(
    sql: string,
    params: unknown[],
  ): Promise<{ rows: GraphMutationRow[] }>;
}

const LIST_MUTATION_EVENTS_SQL = `SELECT id, mutation_txn_id, user_id, plan_lineage_id, plan_id, agent_run_id,
       mutation_type, target_table, target_node_id, summary, before, after,
       committed_at
  FROM graph_mutations
 WHERE user_id = $1
   AND id > $2
 ORDER BY id ASC
 LIMIT $3`;

export async function listMutationEvents(
  client: QueryClient,
  userId: string,
  after: number | string = 0,
  limit = 100,
) {
  const result = await client.query(LIST_MUTATION_EVENTS_SQL, [
    userId,
    after,
    limit,
  ]);

  return result.rows.map(toMutationEvent);
}
