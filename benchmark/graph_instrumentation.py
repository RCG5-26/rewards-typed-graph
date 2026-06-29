"""Graph-lane evidence collection for benchmark evaluation.

RCG-52 is intentionally read-only: it summarizes the canonical Postgres
evidence trail produced by graph-write so the eval harness can score structural
invalidation without duplicating write behavior.
"""

from __future__ import annotations

from typing import Any


GRAPH_INSTRUMENTATION_EVALUATOR_VERSION = "graph-lane-instrumentation-v1"

_STRUCTURAL_PLAN_TYPES = {"agent_generated"}
_INVALIDATED_SOURCE_STATUSES = {"stale", "superseded"}
_COMPLETED_JOB_STATUS = "completed"


def collect_graph_eval_metrics(
    connection: Any,
    *,
    user_id: str,
    source_plan_id: str,
) -> dict[str, Any]:
    """Return an `evaluations`-ready metric payload for one source plan.

    The source plan is the plan revision that should have been invalidated by a
    personal-state mutation. Baseline plans deliberately receive no structural
    invalidation credit because ADR 0002/0003 keep baselines outside the graph
    coordination layer.
    """

    if not user_id:
        raise ValueError("user_id is required")
    if not source_plan_id:
        raise ValueError("source_plan_id is required")

    source_plan = _fetch_source_plan(
        connection,
        user_id=user_id,
        source_plan_id=source_plan_id,
    )
    if source_plan is None:
        raise ValueError(
            "source plan does not exist or is not visible to user "
            f"{user_id}: {source_plan_id}"
        )

    (
        _source_user_id,
        plan_lineage_id,
        plan_type,
        source_plan_status,
        benchmark_query_id,
    ) = source_plan
    plan_lineage_id = _string_or_none(plan_lineage_id)
    benchmark_query_id = _string_or_none(benchmark_query_id)

    dependent_step_count, stale_step_count = _fetch_dependent_step_counts(
        connection,
        source_plan_id=source_plan_id,
    )
    replan_job = _fetch_latest_replan_job(
        connection,
        user_id=user_id,
        source_plan_id=source_plan_id,
    )
    (
        replan_job_status,
        result_plan_id,
        trigger_mutation_txn_id,
    ) = _normalize_replan_job(replan_job)
    result_plan_status, result_supersedes_source = _fetch_result_plan_signal(
        connection,
        user_id=user_id,
        result_plan_id=result_plan_id,
        source_plan_id=source_plan_id,
    )
    mutation_counts = _fetch_mutation_counts(
        connection,
        user_id=user_id,
        trigger_mutation_txn_id=trigger_mutation_txn_id,
    )
    token_cost_total = _fetch_token_cost_total(
        connection,
        user_id=user_id,
        plan_lineage_id=plan_lineage_id,
    )

    metric_scores = {
        "plan_type": plan_type,
        "source_plan_status": source_plan_status,
        "dependent_step_count": dependent_step_count,
        "stale_or_superseded_step_count": stale_step_count,
        "replan_job_status": replan_job_status,
        "result_plan_id": result_plan_id,
        "result_plan_status": result_plan_status,
        "result_supersedes_source": result_supersedes_source,
        "trigger_mutation_txn_id": trigger_mutation_txn_id,
        "transfer_points_mutation_count": _mutation_count(
            mutation_counts,
            "TransferPoints",
            "user_balances",
        ),
        "mark_stale_plan_mutation_count": _mutation_count(
            mutation_counts,
            "MarkStale",
            "plans",
        ),
        "mark_stale_step_mutation_count": _mutation_count(
            mutation_counts,
            "MarkStale",
            "plan_steps",
        ),
    }
    failure_reason = _invalidation_failure_reason(metric_scores)
    if failure_reason is not None:
        metric_scores["invalidation_failure_reason"] = failure_reason

    return {
        "plan_id": source_plan_id,
        "baseline_plan_id": None,
        "benchmark_query_id": benchmark_query_id,
        "token_cost_total": token_cost_total,
        "plan_invalidation_correct": failure_reason is None,
        "metric_scores": metric_scores,
        "evaluator_version": GRAPH_INSTRUMENTATION_EVALUATOR_VERSION,
    }


def _fetch_source_plan(
    connection: Any,
    *,
    user_id: str,
    source_plan_id: str,
) -> tuple[Any, ...] | None:
    """Load the source plan row scoped to the requesting user."""
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT user_id, plan_lineage_id, plan_type, status, benchmark_query_id
              FROM plans
             WHERE id = %s
               AND user_id = %s
            """,
            (source_plan_id, user_id),
        )
        return cursor.fetchone()


def _fetch_dependent_step_counts(
    connection: Any,
    *,
    source_plan_id: str,
) -> tuple[int, int]:
    """Count dependent steps and how many are stale or superseded."""
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT
              COUNT(*) AS dependent_step_count,
              COUNT(*) FILTER (
                WHERE ps.status IN ('stale', 'superseded')
              ) AS stale_or_superseded_step_count
              FROM plan_steps ps
             WHERE ps.plan_id = %s
               AND EXISTS (
                 SELECT 1
                   FROM state_dependencies sd
                  WHERE sd.plan_step_id = ps.id
               )
            """,
            (source_plan_id,),
        )
        row = cursor.fetchone()

    if row is None:
        return 0, 0
    return int(row[0] or 0), int(row[1] or 0)


def _fetch_latest_replan_job(
    connection: Any,
    *,
    user_id: str,
    source_plan_id: str,
) -> tuple[Any, ...] | None:
    """Return the newest replan job for the source plan, if any."""
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT status, result_plan_id, trigger_mutation_txn_id
              FROM replan_jobs
             WHERE user_id = %s
               AND source_plan_id = %s
             ORDER BY created_at DESC
             LIMIT 1
            """,
            (user_id, source_plan_id),
        )
        return cursor.fetchone()


def _fetch_result_plan_signal(
    connection: Any,
    *,
    user_id: str,
    result_plan_id: str | None,
    source_plan_id: str,
) -> tuple[str | None, bool]:
    """Load result-plan status and whether it directly supersedes the source plan."""
    if result_plan_id is None:
        return None, False

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT status, supersedes_plan_id
              FROM plans
             WHERE id = %s
               AND user_id = %s
            """,
            (result_plan_id, user_id),
        )
        row = cursor.fetchone()

    if row is None:
        return None, False

    status, supersedes_plan_id = row
    return _string_or_none(status), _string_or_none(supersedes_plan_id) == source_plan_id


def _fetch_mutation_counts(
    connection: Any,
    *,
    user_id: str,
    trigger_mutation_txn_id: str | None,
) -> dict[tuple[str, str], int]:
    """Group graph mutations for the trigger transaction by type and target table."""
    if trigger_mutation_txn_id is None:
        return {}

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT mutation_type, target_table, COUNT(*)
              FROM graph_mutations
             WHERE user_id = %s
               AND mutation_txn_id = %s
             GROUP BY mutation_type, target_table
            """,
            (user_id, trigger_mutation_txn_id),
        )
        rows = cursor.fetchall()

    return {
        (_string_or_none(mutation_type) or "", _string_or_none(target_table) or ""): int(
            count or 0
        )
        for mutation_type, target_table, count in (rows or [])
    }


def _fetch_token_cost_total(
    connection: Any,
    *,
    user_id: str,
    plan_lineage_id: str | None,
) -> int:
    """Sum recorded agent-run token usage across the plan lineage."""
    if plan_lineage_id is None:
        return 0

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT COALESCE(SUM(ar.token_count), 0)
              FROM agent_runs ar
              JOIN plans p ON p.id = ar.plan_id
             WHERE p.user_id = %s
               AND p.plan_lineage_id = %s
               AND ar.token_count IS NOT NULL
            """,
            (user_id, plan_lineage_id),
        )
        row = cursor.fetchone()

    if row is None:
        return 0
    return int(row[0] or 0)


def _normalize_replan_job(
    replan_job: tuple[Any, ...] | None,
) -> tuple[str | None, str | None, str | None]:
    """Coerce replan-job row values to optional strings."""
    if replan_job is None:
        return None, None, None

    status, result_plan_id, trigger_mutation_txn_id = replan_job
    return (
        _string_or_none(status),
        _string_or_none(result_plan_id),
        _string_or_none(trigger_mutation_txn_id),
    )


def _mutation_count(
    mutation_counts: dict[tuple[str, str], int],
    mutation_type: str,
    target_table: str,
) -> int:
    """Return the mutation count for one type/table pair, defaulting to zero."""
    return mutation_counts.get((mutation_type, target_table), 0)


def _invalidation_failure_reason(metric_scores: dict[str, Any]) -> str | None:
    """Return the first structural invalidation failure reason, or None when valid."""
    if metric_scores["plan_type"] not in _STRUCTURAL_PLAN_TYPES:
        return "plan_type_not_agent_generated"
    if metric_scores["source_plan_status"] not in _INVALIDATED_SOURCE_STATUSES:
        return "source_plan_not_invalidated"
    if metric_scores["dependent_step_count"] <= 0:
        return "no_recorded_state_dependencies"
    if (
        metric_scores["stale_or_superseded_step_count"]
        != metric_scores["dependent_step_count"]
    ):
        return "dependent_steps_not_invalidated"
    if metric_scores["replan_job_status"] is None:
        return "missing_replan_job"
    if metric_scores["replan_job_status"] != _COMPLETED_JOB_STATUS:
        return "replan_job_not_completed"
    if metric_scores["transfer_points_mutation_count"] <= 0:
        return "missing_transfer_points_mutation"
    if metric_scores["mark_stale_plan_mutation_count"] <= 0:
        return "missing_mark_stale_plan_mutation"
    if (
        metric_scores["mark_stale_step_mutation_count"]
        < metric_scores["stale_or_superseded_step_count"]
    ):
        return "missing_mark_stale_step_mutation"
    if metric_scores["result_plan_status"] != "current":
        return "completed_job_result_plan_not_current"
    if not metric_scores["result_supersedes_source"]:
        return "result_plan_not_direct_successor"
    return None


def _string_or_none(value: Any) -> str | None:
    """Normalize database scalars to optional strings."""
    if value is None:
        return None
    return str(value)
