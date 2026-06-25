import unittest

from benchmark.graph_instrumentation import (
    GRAPH_INSTRUMENTATION_EVALUATOR_VERSION,
    collect_graph_eval_metrics,
)


USER_ID = "00000000-0000-0000-0000-000000000001"
SOURCE_PLAN_ID = "00000000-0000-0000-0000-000000000010"
RESULT_PLAN_ID = "00000000-0000-0000-0000-000000000011"
LINEAGE_ID = "00000000-0000-0000-0000-000000000020"
BENCHMARK_QUERY_ID = "00000000-0000-0000-0000-000000000030"
MUTATION_TXN_ID = "00000000-0000-0000-0000-000000000040"


class GraphInstrumentationTests(unittest.TestCase):
    def test_collects_eval_ready_invalidation_metrics_from_graph_evidence(self):
        connection = FakeConnection(
            source_plan=(
                USER_ID,
                LINEAGE_ID,
                "agent_generated",
                "superseded",
                BENCHMARK_QUERY_ID,
            ),
            dependent_steps=(2, 2),
            replan_job=("completed", RESULT_PLAN_ID, MUTATION_TXN_ID),
            result_plan=("current", SOURCE_PLAN_ID),
            mutation_counts=[
                ("TransferPoints", "user_balances", 2),
                ("MarkStale", "plans", 1),
                ("MarkStale", "plan_steps", 2),
            ],
            token_cost_total=321,
        )

        metrics = collect_graph_eval_metrics(
            connection,
            user_id=USER_ID,
            source_plan_id=SOURCE_PLAN_ID,
        )

        self.assertEqual(metrics["plan_id"], SOURCE_PLAN_ID)
        self.assertEqual(metrics["benchmark_query_id"], BENCHMARK_QUERY_ID)
        self.assertEqual(metrics["evaluator_version"], GRAPH_INSTRUMENTATION_EVALUATOR_VERSION)
        self.assertEqual(metrics["token_cost_total"], 321)
        self.assertTrue(metrics["plan_invalidation_correct"])
        self.assertEqual(
            metrics["metric_scores"],
            {
                "plan_type": "agent_generated",
                "source_plan_status": "superseded",
                "dependent_step_count": 2,
                "stale_or_superseded_step_count": 2,
                "replan_job_status": "completed",
                "result_plan_id": RESULT_PLAN_ID,
                "result_plan_status": "current",
                "result_supersedes_source": True,
                "trigger_mutation_txn_id": MUTATION_TXN_ID,
                "transfer_points_mutation_count": 2,
                "mark_stale_plan_mutation_count": 1,
                "mark_stale_step_mutation_count": 2,
            },
        )

    def test_baseline_plans_do_not_receive_structural_invalidation_credit(self):
        connection = FakeConnection(
            source_plan=(
                USER_ID,
                LINEAGE_ID,
                "baseline_single_agent",
                "completed",
                BENCHMARK_QUERY_ID,
            ),
            dependent_steps=(0, 0),
            replan_job=None,
            result_plan=None,
            mutation_counts=[],
            token_cost_total=88,
        )

        metrics = collect_graph_eval_metrics(
            connection,
            user_id=USER_ID,
            source_plan_id=SOURCE_PLAN_ID,
        )

        self.assertFalse(metrics["plan_invalidation_correct"])
        self.assertEqual(metrics["token_cost_total"], 88)
        self.assertEqual(
            metrics["metric_scores"]["invalidation_failure_reason"],
            "plan_type_not_agent_generated",
        )

    def test_missing_source_plan_is_rejected_before_scoring(self):
        connection = FakeConnection(
            source_plan=None,
            dependent_steps=(0, 0),
            replan_job=None,
            result_plan=None,
            mutation_counts=[],
            token_cost_total=0,
        )

        with self.assertRaises(ValueError) as raised:
            collect_graph_eval_metrics(
                connection,
                user_id=USER_ID,
                source_plan_id=SOURCE_PLAN_ID,
            )

        self.assertEqual(
            str(raised.exception),
            f"source plan does not exist or is not visible to user {USER_ID}: {SOURCE_PLAN_ID}",
        )


class FakeConnection:
    def __init__(
        self,
        *,
        source_plan,
        dependent_steps,
        replan_job,
        result_plan,
        mutation_counts,
        token_cost_total,
    ):
        self.source_plan = source_plan
        self.dependent_steps = dependent_steps
        self.replan_job = replan_job
        self.result_plan = result_plan
        self.mutation_counts = mutation_counts
        self.token_cost_total = token_cost_total

    def cursor(self):
        return FakeCursor(self)


class FakeCursor:
    def __init__(self, connection):
        self.connection = connection
        self.result = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=None):
        compact_sql = " ".join(sql.split())
        if compact_sql.startswith(
            "SELECT user_id, plan_lineage_id, plan_type, status, benchmark_query_id FROM plans"
        ):
            self.result = self.connection.source_plan
            return
        if compact_sql.startswith("SELECT COUNT(*) AS dependent_step_count"):
            dependent_step_count, stale_step_count = self.connection.dependent_steps
            self.result = (dependent_step_count, stale_step_count)
            return
        if compact_sql.startswith(
            "SELECT status, result_plan_id, trigger_mutation_txn_id FROM replan_jobs"
        ):
            self.result = self.connection.replan_job
            return
        if compact_sql.startswith("SELECT status, supersedes_plan_id FROM plans"):
            self.result = self.connection.result_plan
            return
        if compact_sql.startswith(
            "SELECT mutation_type, target_table, COUNT(*) FROM graph_mutations"
        ):
            self.result = self.connection.mutation_counts
            return
        if compact_sql.startswith("SELECT COALESCE(SUM(ar.token_count), 0)"):
            self.result = (self.connection.token_cost_total,)
            return
        raise AssertionError(f"unexpected SQL: {compact_sql}")

    def fetchone(self):
        return self.result

    def fetchall(self):
        return self.result


if __name__ == "__main__":
    unittest.main()
