"""v3.1 graph-write boundary.

The canonical v3.1 persistence path is table-per-type SQL in schema/schema.sql.
This module provides the pre-API graph-write adapter for schema-lane tests and
early integration. The older polymorphic mutation service is preserved for
experiments at schema.experimental.polymorphic.mutations.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, Dict, Optional

from schema.types import GraphNode, validate_node


class V31GraphWriteNotImplemented(RuntimeError):
    """Raised if code tries to use the pre-app v3.1 write placeholder."""


class MutationValidationError(ValueError):
    """Raised when a graph mutation is invalid before SQL execution."""

    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


class MutationCommitError(RuntimeError):
    """Raised when the database write boundary returns an impossible result."""


@dataclass(frozen=True)
class CreatePlanRequest:
    """Create a v3.1 plan revision."""

    actor: str
    user_id: str
    plan_lineage_id: str
    revision_number: int
    query_text: str
    status: str = "generating"
    plan_type: str = "agent_generated"
    benchmark_query_id: Optional[str] = None
    raw_output: Optional[Dict[str, Any]] = None
    summary: Optional[str] = None
    supersedes_plan_id: Optional[str] = None


@dataclass(frozen=True)
class CreatePlanStepRequest:
    """Create a v3.1 plan step on an existing plan revision."""

    actor: str
    user_id: str
    plan_id: str
    plan_lineage_id: str
    revision_number: int
    step_order: int
    step_type: str
    payload: Dict[str, Any]
    status: str = "proposed"
    supersedes_plan_step_id: Optional[str] = None


@dataclass(frozen=True)
class RecordStateDependencyRequest:
    """Create a dependency edge from a plan step to a graph target."""

    actor: str
    user_id: str
    plan_step_id: str
    target_node_id: str
    target_node_type: str
    target_table: str
    observed_version: int
    snapshot_value: Dict[str, Any]
    depended_property: Optional[str] = None


@dataclass(frozen=True)
class TransferPointsRequest:
    """Canonical v3.1 TransferPoints graph mutation request."""

    actor: str
    user_id: str
    source_balance_id: str
    dest_balance_id: str
    amount_points: int
    source_expected_version: int
    dest_expected_version: int
    idempotency_key: str
    request_hash: str


class V31GraphWriteService:
    """Small canonical graph-write adapter around v3.1 SQL functions."""

    def __init__(self, connection: Any):
        self.connection = connection

    def create_plan(self, request: CreatePlanRequest) -> str:
        """Validate and create a plan revision."""

        errors = _validate_create_plan(request)
        if errors:
            raise MutationValidationError(errors)

        with self.connection.cursor() as cursor:
            _lock_user(cursor, request.user_id)
            cursor.execute(
                """
                INSERT INTO plans (
                  user_id,
                  plan_lineage_id,
                  revision_number,
                  supersedes_plan_id,
                  query_text,
                  status,
                  plan_type,
                  benchmark_query_id,
                  raw_output,
                  summary
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id, version
                """,
                (
                    request.user_id,
                    request.plan_lineage_id,
                    request.revision_number,
                    request.supersedes_plan_id,
                    request.query_text,
                    request.status,
                    request.plan_type,
                    request.benchmark_query_id,
                    request.raw_output,
                    request.summary,
                ),
            )
            row = cursor.fetchone()

            if row is None:
                raise MutationCommitError("CreatePlan returned no result")

            plan_id, version = row
            _insert_graph_mutation(
                cursor=cursor,
                user_id=request.user_id,
                plan_lineage_id=request.plan_lineage_id,
                plan_id=plan_id,
                mutation_type="CreatePlan",
                target_table="plans",
                target_node_id=plan_id,
                summary="Created plan",
                before=None,
                after={
                    "query_text": request.query_text,
                    "status": request.status,
                    "revision_number": request.revision_number,
                    "actor": request.actor,
                    "version": version,
                },
            )

        return str(plan_id)

    def create_plan_step(self, request: CreatePlanStepRequest) -> str:
        """Validate and create a plan step on an existing plan revision."""

        errors = _validate_create_plan_step(request)
        if errors:
            raise MutationValidationError(errors)

        with self.connection.cursor() as cursor:
            plan = _fetch_plan(cursor, request.plan_id)
            errors = _validate_plan_step_parent(request, plan)
            if errors:
                raise MutationValidationError(errors)

            _lock_user(cursor, request.user_id)
            cursor.execute(
                """
                INSERT INTO plan_steps (
                  plan_id,
                  plan_lineage_id,
                  revision_number,
                  supersedes_plan_step_id,
                  step_order,
                  step_type,
                  payload,
                  status
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id, version
                """,
                (
                    request.plan_id,
                    request.plan_lineage_id,
                    request.revision_number,
                    request.supersedes_plan_step_id,
                    request.step_order,
                    request.step_type,
                    request.payload,
                    request.status,
                ),
            )
            row = cursor.fetchone()

            if row is None:
                raise MutationCommitError("CreatePlanStep returned no result")

            plan_step_id, version = row
            _insert_graph_mutation(
                cursor=cursor,
                user_id=request.user_id,
                plan_lineage_id=request.plan_lineage_id,
                plan_id=request.plan_id,
                mutation_type="CreatePlanStep",
                target_table="plan_steps",
                target_node_id=plan_step_id,
                summary="Created plan step",
                before=None,
                after={
                    "plan_id": request.plan_id,
                    "step_order": request.step_order,
                    "step_type": request.step_type,
                    "status": request.status,
                    "actor": request.actor,
                    "version": version,
                },
            )

        return str(plan_step_id)

    def record_state_dependency(self, request: RecordStateDependencyRequest) -> str:
        """Validate and create a state dependency edge for a plan step."""

        errors = _validate_record_state_dependency(request)
        if errors:
            raise MutationValidationError(errors)

        with self.connection.cursor() as cursor:
            plan_step = _fetch_plan_step_scope(cursor, request.plan_step_id)
            target = _fetch_target_reference(
                cursor, request.target_table, request.target_node_id
            )
            errors = _validate_state_dependency_references(
                request=request,
                plan_step=plan_step,
                target=target,
            )
            if errors:
                raise MutationValidationError(errors)

            _lock_user(cursor, request.user_id)
            cursor.execute(
                """
                INSERT INTO state_dependencies (
                  plan_step_id,
                  target_node_id,
                  target_node_type,
                  target_table,
                  depended_property,
                  observed_version,
                  snapshot_value
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id, 0
                """,
                (
                    request.plan_step_id,
                    request.target_node_id,
                    request.target_node_type,
                    request.target_table,
                    request.depended_property,
                    request.observed_version,
                    request.snapshot_value,
                ),
            )
            row = cursor.fetchone()

            if row is None:
                raise MutationCommitError("RecordStateDependency returned no result")

            dependency_id, version = row
            _insert_graph_mutation(
                cursor=cursor,
                user_id=request.user_id,
                plan_lineage_id=plan_step[1],
                plan_id=None,
                mutation_type="RecordStateDependency",
                target_table="state_dependencies",
                target_node_id=dependency_id,
                summary="Recorded state dependency",
                before=None,
                after={
                    "plan_step_id": request.plan_step_id,
                    "target_node_id": request.target_node_id,
                    "target_node_type": request.target_node_type,
                    "target_table": request.target_table,
                    "observed_version": request.observed_version,
                    "actor": request.actor,
                    "version": version,
                },
            )

        return str(dependency_id)

    def transfer_points(self, request: TransferPointsRequest) -> Dict[str, Any]:
        """Validate and apply a TransferPoints mutation through schema.sql."""

        errors = _validate_transfer_points(request)
        if errors:
            raise MutationValidationError(errors)

        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                  source_balance_id,
                  source_version,
                  dest_balance_id,
                  dest_version,
                  idempotency_replayed
                FROM transfer_points(%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    request.user_id,
                    request.source_balance_id,
                    request.dest_balance_id,
                    request.amount_points,
                    request.source_expected_version,
                    request.dest_expected_version,
                    request.idempotency_key,
                    request.request_hash,
                    request.actor,
                ),
            )
            row = cursor.fetchone()

        if row is None:
            raise MutationCommitError("TransferPoints returned no result")

        (
            source_balance_id,
            source_version,
            dest_balance_id,
            dest_version,
            idempotency_replayed,
        ) = row
        return {
            "source_balance_id": str(source_balance_id),
            "source_version": source_version,
            "dest_balance_id": str(dest_balance_id),
            "dest_version": dest_version,
            "idempotency_replayed": idempotency_replayed,
        }


def require_app_graph_write() -> None:
    """Signal that callers must use the application graph-write implementation."""

    raise V31GraphWriteNotImplemented(
        "Use V31GraphWriteService for the current schema-lane graph-write adapter; "
        "use schema.experimental.polymorphic.mutations only for the optional "
        "polymorphic experiment."
    )


PLAN_TYPES = {
    "agent_generated",
    "baseline_single_agent",
    "baseline_free_text_multiagent",
}

PLAN_STEP_TYPES = {
    "card_assignment",
    "redemption_recommendation",
    "spend_analysis",
    "transfer_recommendation",
}

PLAN_STEP_STATUSES = {"proposed", "current", "stale", "superseded"}

STATE_DEPENDENCY_TARGET_TABLES = {
    "users": ("User", True),
    "user_balances": ("UserBalance", True),
    "user_program_statuses": ("UserProgramStatus", True),
    "plans": ("Plan", True),
    "plan_steps": ("PlanStep", True),
    "transfers_to": ("TransferRoute", False),
}


def _validate_create_plan(request: CreatePlanRequest) -> list[str]:
    errors = _validate_actor_user(request.actor, request.user_id)

    plan_errors = validate_node(
        GraphNode(
            type="Plan",
            tier="plan",
            attributes={
                "user_id": request.user_id,
                "plan_lineage_id": request.plan_lineage_id,
                "revision_number": request.revision_number,
                "query_text": request.query_text,
                "status": request.status,
                "plan_type": request.plan_type,
            },
        )
    )
    errors.extend(plan_errors)

    if not request.plan_lineage_id:
        errors.append("Plan.plan_lineage_id is required")

    if not request.query_text:
        errors.append("Plan.query_text is required")

    if request.revision_number <= 0:
        errors.append("Plan.revision_number must be greater than 0")

    if request.plan_type not in PLAN_TYPES:
        errors.append(f"Plan.plan_type must be one of {tuple(sorted(PLAN_TYPES))}")

    return errors


def _validate_create_plan_step(request: CreatePlanStepRequest) -> list[str]:
    errors = _validate_actor_user(request.actor, request.user_id)

    plan_step_errors = validate_node(
        GraphNode(
            type="PlanStep",
            tier="plan",
            attributes={
                "plan_id": request.plan_id,
                "plan_lineage_id": request.plan_lineage_id,
                "revision_number": request.revision_number,
                "step_order": request.step_order,
                "step_type": request.step_type,
                "payload": request.payload,
                "status": request.status,
            },
        )
    )
    errors.extend(plan_step_errors)

    if not request.plan_id:
        errors.append("PlanStep.plan_id is required")

    if not request.plan_lineage_id:
        errors.append("PlanStep.plan_lineage_id is required")

    if request.revision_number <= 0:
        errors.append("PlanStep.revision_number must be greater than 0")

    if request.step_order <= 0:
        errors.append("PlanStep.step_order must be greater than 0")

    if request.step_type not in PLAN_STEP_TYPES:
        errors.append(f"PlanStep.step_type must be one of {tuple(sorted(PLAN_STEP_TYPES))}")

    if not isinstance(request.payload, dict):
        errors.append("PlanStep.payload must be an object")

    if request.status not in PLAN_STEP_STATUSES:
        errors.append(
            f"PlanStep.status must be one of {tuple(sorted(PLAN_STEP_STATUSES))}"
        )

    return errors


def _validate_record_state_dependency(
    request: RecordStateDependencyRequest,
) -> list[str]:
    errors = _validate_actor_user(request.actor, request.user_id)

    if not request.plan_step_id:
        errors.append("StateDependency.plan_step_id is required")

    if not request.target_node_id:
        errors.append("StateDependency.target_node_id is required")

    if not request.target_node_type:
        errors.append("StateDependency.target_node_type is required")

    if request.target_table not in STATE_DEPENDENCY_TARGET_TABLES:
        errors.append(f"StateDependency.target_table is not allowed: {request.target_table}")

    if request.observed_version < 0:
        errors.append("StateDependency.observed_version must be nonnegative")

    if not isinstance(request.snapshot_value, dict):
        errors.append("StateDependency.snapshot_value must be an object")

    return errors


def _validate_transfer_points(request: TransferPointsRequest) -> list[str]:
    errors = _validate_actor_user(request.actor, request.user_id)

    if not request.source_balance_id:
        errors.append("TransferPoints.source_balance_id is required")

    if not request.dest_balance_id:
        errors.append("TransferPoints.dest_balance_id is required")

    if request.amount_points <= 0:
        errors.append("TransferPoints.amount_points must be greater than 0")

    if request.source_balance_id == request.dest_balance_id:
        errors.append("TransferPoints.source_balance_id and dest_balance_id must differ")

    if request.source_expected_version < 0:
        errors.append("TransferPoints.source_expected_version must be nonnegative")

    if request.dest_expected_version < 0:
        errors.append("TransferPoints.dest_expected_version must be nonnegative")

    if not request.idempotency_key:
        errors.append("TransferPoints.idempotency_key is required")

    if not request.request_hash:
        errors.append("TransferPoints.request_hash is required")

    return errors


def _validate_actor_user(actor: str, user_id: str) -> list[str]:
    errors = []

    if not actor:
        errors.append("actor is required")

    if not user_id:
        errors.append("user_id is required")

    return errors


def _validate_plan_step_parent(
    request: CreatePlanStepRequest,
    plan: Optional[tuple[Any, Any, int]],
) -> list[str]:
    if plan is None:
        return [
            "PlanStep.plan_id does not exist or is not visible to user "
            f"{request.user_id}"
        ]

    user_id, plan_lineage_id, revision_number = plan
    errors = []
    if str(user_id) != request.user_id:
        errors.append(
            "PlanStep.plan_id does not exist or is not visible to user "
            f"{request.user_id}"
        )
    if str(plan_lineage_id) != request.plan_lineage_id:
        errors.append("PlanStep.plan_lineage_id must match parent plan")
    if revision_number != request.revision_number:
        errors.append("PlanStep.revision_number must match parent plan")
    return errors


def _validate_state_dependency_references(
    request: RecordStateDependencyRequest,
    plan_step: Optional[tuple[Any, Any, int]],
    target: Optional[tuple[Any, int, Optional[Any]]],
) -> list[str]:
    errors = []

    if plan_step is None:
        errors.append(
            "StateDependency.plan_step_id does not exist or is not visible to user "
            f"{request.user_id}"
        )
    else:
        plan_step_user_id, _plan_lineage_id, _revision_number = plan_step
        if str(plan_step_user_id) != request.user_id:
            errors.append(
                "StateDependency.plan_step_id does not exist or is not visible to user "
                f"{request.user_id}"
            )

    if target is None:
        errors.append(
            "StateDependency target does not exist: "
            f"{request.target_table}:{request.target_node_id}"
        )
        return errors

    target_node_type, target_version, target_user_id = target
    expected_node_type, scoped_to_user = STATE_DEPENDENCY_TARGET_TABLES[
        request.target_table
    ]
    if request.target_table == "transfers_to":
        expected_node_type = request.target_node_type

    if str(target_node_type) != expected_node_type:
        errors.append(
            f"StateDependency.target_node_type must be {target_node_type}, "
            f"got {request.target_node_type}"
        )

    if request.target_node_type != expected_node_type:
        errors.append(
            f"StateDependency.target_node_type must match target table "
            f"{request.target_table}"
        )

    if target_version != request.observed_version:
        errors.append("StateDependency.observed_version must match target version")

    if scoped_to_user and target_user_id is not None and str(target_user_id) != request.user_id:
        errors.append(
            "StateDependency target does not exist or is not visible to user "
            f"{request.user_id}"
        )

    return errors


def _fetch_plan(cursor: Any, plan_id: str) -> Optional[tuple[Any, Any, int]]:
    cursor.execute(
        """
        SELECT user_id, plan_lineage_id, revision_number
          FROM plans
         WHERE id = %s
        """,
        (plan_id,),
    )
    return cursor.fetchone()


def _fetch_plan_step_scope(
    cursor: Any, plan_step_id: str
) -> Optional[tuple[Any, Any, int]]:
    cursor.execute(
        """
        SELECT p.user_id, ps.plan_lineage_id, ps.revision_number
          FROM plan_steps ps
          JOIN plans p ON p.id = ps.plan_id
         WHERE ps.id = %s
        """,
        (plan_step_id,),
    )
    return cursor.fetchone()


def _fetch_target_reference(
    cursor: Any, target_table: str, target_node_id: str
) -> Optional[tuple[Any, int, Optional[Any]]]:
    if target_table == "users":
        cursor.execute(
            """
            SELECT node_type, version, id AS user_id
              FROM users
             WHERE id = %s
            """,
            (target_node_id,),
        )
        return cursor.fetchone()

    if target_table == "plan_steps":
        cursor.execute(
            """
            SELECT ps.node_type, ps.version, p.user_id
              FROM plan_steps ps
              JOIN plans p ON p.id = ps.plan_id
             WHERE ps.id = %s
            """,
            (target_node_id,),
        )
        return cursor.fetchone()

    if target_table == "transfers_to":
        cursor.execute(
            """
            SELECT 'TransferRoute' AS node_type, version, NULL AS user_id
              FROM transfers_to
             WHERE id = %s
            """,
            (target_node_id,),
        )
        return cursor.fetchone()

    cursor.execute(
        f"""
        SELECT node_type, version, user_id
          FROM {target_table}
         WHERE id = %s
        """,
        (target_node_id,),
    )
    return cursor.fetchone()


def _lock_user(cursor: Any, user_id: str) -> None:
    cursor.execute(
        "SELECT pg_advisory_xact_lock(hashtextextended('graph_write:' || %s::text, 0))",
        (user_id,),
    )


def _insert_graph_mutation(
    *,
    cursor: Any,
    user_id: str,
    plan_lineage_id: Optional[str],
    plan_id: Optional[str],
    mutation_type: str,
    target_table: str,
    target_node_id: Any,
    summary: str,
    before: Optional[Dict[str, Any]],
    after: Dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO graph_mutations (
          mutation_txn_id,
          user_id,
          plan_lineage_id,
          plan_id,
          mutation_type,
          target_table,
          target_node_id,
          summary,
          before,
          after
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            str(uuid.uuid4()),
            user_id,
            plan_lineage_id,
            plan_id,
            mutation_type,
            target_table,
            target_node_id,
            summary,
            before,
            after,
        ),
    )
