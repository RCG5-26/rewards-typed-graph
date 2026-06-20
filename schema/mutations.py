"""Mutation layer for schema-validated graph writes.

Agents should use this service instead of writing directly to Postgres. The
service validates structure, references, and MVP domain rules before commit.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Sequence

from schema.types import GraphEdge, GraphNode, validate_edge, validate_node


class MutationValidationError(ValueError):
    """Raised when a graph mutation is invalid before commit."""

    def __init__(self, errors: Sequence[str]):
        self.errors = list(errors)
        super().__init__("; ".join(self.errors))


class MutationConflictError(RuntimeError):
    """Raised when an optimistic update finds a stale expected version."""


class GraphMutationService:
    """Single write path for nodes, edges, validation, and mutation logging."""

    def __init__(self, connection):
        self.connection = connection

    def create_node(self, actor: str, node: GraphNode) -> str:
        errors = list(validate_node(node))
        errors.extend(self._validate_node_domain(node))
        self._raise_if_invalid(errors)

        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO nodes (type, tier, user_id, slug, attributes, version)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id, version
                """,
                (
                    node.type,
                    node.tier,
                    node.user_id,
                    node.slug,
                    node.attributes,
                    node.version,
                ),
            )
            node_id, resulting_version = cursor.fetchone()

        self._log_mutation(
            actor=actor,
            action="create_node",
            target_kind="node",
            target_id=node_id,
            target_type=node.type,
            before_value=None,
            after_value=node.attributes,
            resulting_version=resulting_version,
        )
        return node_id

    def update_node(
        self,
        actor: str,
        node_id: str,
        expected_version: int,
        attributes: Mapping[str, Any],
    ) -> str:
        current = self._fetch_node_row(node_id)
        if current is None:
            raise MutationValidationError([f"node does not exist: {node_id}"])

        current_node = GraphNode(
            type=current["type"],
            tier=current["tier"],
            user_id=current["user_id"],
            slug=current["slug"],
            attributes=dict(attributes),
            version=expected_version,
        )
        errors = list(validate_node(current_node))
        errors.extend(self._validate_node_domain(current_node, current_node_id=node_id))
        self._raise_if_invalid(errors)

        with self.connection.cursor() as cursor:
            cursor.execute(
                "SELECT id, version FROM update_node_optimistic(%s, %s, %s)",
                (node_id, expected_version, dict(attributes)),
            )
            updated = cursor.fetchone()

        if updated is None:
            raise MutationConflictError(
                f"node {node_id} was not at expected version {expected_version}"
            )

        updated_id, resulting_version = updated
        self._log_mutation(
            actor=actor,
            action="update_node",
            target_kind="node",
            target_id=updated_id,
            target_type=current["type"],
            before_value=current["attributes"],
            after_value=dict(attributes),
            resulting_version=resulting_version,
        )
        self._mark_stale_dependents(actor=actor, depended_node_id=node_id)
        return updated_id

    def create_edge(
        self,
        actor: str,
        edge_type: str,
        source_id: str,
        target_id: str,
        attributes: Optional[Mapping[str, Any]] = None,
    ) -> str:
        attributes = dict(attributes or {})
        source_type = self._require_node_type(source_id, label="source")
        target_type = self._require_node_type(target_id, label="target")

        edge = GraphEdge(
            type=edge_type,
            source_type=source_type,
            target_type=target_type,
            attributes=attributes,
        )
        errors = list(validate_edge(edge))
        errors.extend(self._validate_edge_domain(edge))
        self._raise_if_invalid(errors)

        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO edges (type, source_id, target_id, attributes, version)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, version
                """,
                (edge.type, source_id, target_id, edge.attributes, edge.version),
            )
            edge_id, resulting_version = cursor.fetchone()

        self._log_mutation(
            actor=actor,
            action="create_edge",
            target_kind="edge",
            target_id=edge_id,
            target_type=edge.type,
            before_value=None,
            after_value=edge.attributes,
            resulting_version=resulting_version,
        )
        return edge_id

    def update_edge(
        self,
        actor: str,
        edge_id: str,
        expected_version: int,
        attributes: Mapping[str, Any],
    ) -> str:
        current = self._fetch_edge_row(edge_id)
        if current is None:
            raise MutationValidationError([f"edge does not exist: {edge_id}"])

        edge = GraphEdge(
            type=current["type"],
            source_type=current["source_type"],
            target_type=current["target_type"],
            attributes=dict(attributes),
            version=expected_version,
        )
        errors = list(validate_edge(edge))
        errors.extend(self._validate_edge_domain(edge))
        self._raise_if_invalid(errors)

        with self.connection.cursor() as cursor:
            cursor.execute(
                "SELECT id, version FROM update_edge_optimistic(%s, %s, %s)",
                (edge_id, expected_version, dict(attributes)),
            )
            updated = cursor.fetchone()

        if updated is None:
            raise MutationConflictError(
                f"edge {edge_id} was not at expected version {expected_version}"
            )

        updated_id, resulting_version = updated
        self._log_mutation(
            actor=actor,
            action="update_edge",
            target_kind="edge",
            target_id=updated_id,
            target_type=current["type"],
            before_value=current["attributes"],
            after_value=dict(attributes),
            resulting_version=resulting_version,
        )
        return updated_id

    def _validate_node_domain(
        self,
        node: GraphNode,
        current_node_id: Optional[str] = None,
    ) -> List[str]:
        errors: List[str] = []

        if node.type == "Balance":
            amount_points = node.attributes.get("amount_points")
            if isinstance(amount_points, int) and amount_points < 0:
                errors.append("Balance.attributes.amount_points must be nonnegative")

            program_id = node.attributes.get("program_id")
            if node.user_id is None:
                errors.append("Balance.user_id is required")
            elif isinstance(program_id, str) and self._balance_exists(
                user_id=node.user_id,
                program_id=program_id,
                excluding_node_id=current_node_id,
            ):
                errors.append(
                    f"Balance already exists for user_id={node.user_id} program_id={program_id}"
                )

        return errors

    def _validate_edge_domain(self, edge: GraphEdge) -> List[str]:
        errors: List[str] = []

        if edge.type == "TRANSFERS_TO":
            ratio_num = edge.attributes.get("ratio_num")
            ratio_den = edge.attributes.get("ratio_den")
            transfer_time_days = edge.attributes.get("transfer_time_days")

            if isinstance(ratio_num, int) and ratio_num <= 0:
                errors.append("TRANSFERS_TO.attributes.ratio_num must be greater than 0")
            if isinstance(ratio_den, int) and ratio_den <= 0:
                errors.append("TRANSFERS_TO.attributes.ratio_den must be greater than 0")
            if isinstance(transfer_time_days, int) and transfer_time_days < 0:
                errors.append(
                    "TRANSFERS_TO.attributes.transfer_time_days must be nonnegative"
                )

        if edge.type == "EARNS":
            earn_rate = edge.attributes.get("earn_rate_basis_points")
            cap_amount = edge.attributes.get("cap_amount_cents")

            if isinstance(earn_rate, int) and earn_rate < 0:
                errors.append("EARNS.attributes.earn_rate_basis_points must be nonnegative")
            if isinstance(cap_amount, int) and cap_amount < 0:
                errors.append("EARNS.attributes.cap_amount_cents must be nonnegative")

        if edge.type == "DEPENDS_ON":
            observed_version = edge.attributes.get("observed_version")
            if isinstance(observed_version, int) and observed_version < 0:
                errors.append("DEPENDS_ON.attributes.observed_version must be nonnegative")

        return errors

    def _balance_exists(
        self,
        user_id: str,
        program_id: str,
        excluding_node_id: Optional[str] = None,
    ) -> bool:
        sql = """
            SELECT 1 FROM nodes
            WHERE type = 'Balance'
              AND user_id = %s
              AND attributes->>'program_id' = %s
        """
        params: List[Any] = [user_id, program_id]
        if excluding_node_id is not None:
            sql += " AND id <> %s"
            params.append(excluding_node_id)
        sql += " LIMIT 1"

        with self.connection.cursor() as cursor:
            cursor.execute(sql, tuple(params))
            return cursor.fetchone() is not None

    def _require_node_type(self, node_id: str, label: str) -> str:
        with self.connection.cursor() as cursor:
            cursor.execute("SELECT type FROM nodes WHERE id = %s", (node_id,))
            row = cursor.fetchone()

        if row is None:
            raise MutationValidationError([f"{label} node does not exist: {node_id}"])
        return row[0]

    def _fetch_node_row(self, node_id: str) -> Optional[Dict[str, Any]]:
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT type, tier, user_id, slug, attributes, version
                FROM nodes
                WHERE id = %s
                """,
                (node_id,),
            )
            row = cursor.fetchone()

        if row is None:
            return None
        return {
            "type": row[0],
            "tier": row[1],
            "user_id": row[2],
            "slug": row[3],
            "attributes": row[4],
            "version": row[5],
        }

    def _fetch_edge_row(self, edge_id: str) -> Optional[Dict[str, Any]]:
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                  e.type,
                  source_node.type AS source_type,
                  target_node.type AS target_type,
                  e.attributes,
                  e.version
                FROM edges e
                JOIN nodes source_node ON source_node.id = e.source_id
                JOIN nodes target_node ON target_node.id = e.target_id
                WHERE e.id = %s
                """,
                (edge_id,),
            )
            row = cursor.fetchone()

        if row is None:
            return None
        return {
            "type": row[0],
            "source_type": row[1],
            "target_type": row[2],
            "attributes": row[3],
            "version": row[4],
        }

    def _log_mutation(
        self,
        actor: str,
        action: str,
        target_kind: str,
        target_id: str,
        target_type: str,
        before_value: Optional[Mapping[str, Any]],
        after_value: Optional[Mapping[str, Any]],
        resulting_version: int,
    ) -> None:
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO mutation_log (
                  actor,
                  action,
                  target_kind,
                  target_id,
                  target_type,
                  before_value,
                  after_value,
                  resulting_version
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    actor,
                    action,
                    target_kind,
                    target_id,
                    target_type,
                    before_value,
                    after_value,
                    resulting_version,
                ),
            )

    def _mark_stale_dependents(self, actor: str, depended_node_id: str) -> None:
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT plan_step_id, depended_node_type, current_version, observed_version
                FROM stale_plan_steps
                WHERE depended_node_id = %s
                """,
                (depended_node_id,),
            )
            fetchall = getattr(cursor, "fetchall", None)
            stale_rows = [] if fetchall is None else fetchall()

        for plan_step_id, depended_node_type, current_version, observed_version in stale_rows:
            reason = (
                f"{depended_node_type}:{depended_node_id} version changed "
                f"from {observed_version} to {current_version}"
            )
            with self.connection.cursor() as cursor:
                cursor.execute(
                    "SELECT id, version FROM mark_plan_step_stale(%s, %s)",
                    (plan_step_id, reason),
                )
                marked = cursor.fetchone()
            if marked is not None:
                marked_id, marked_version = marked
                self._log_mutation(
                    actor=actor,
                    action="mark_stale",
                    target_kind="node",
                    target_id=marked_id,
                    target_type="PlanStep",
                    before_value=None,
                    after_value={"stale_reason": reason},
                    resulting_version=marked_version,
                )

    @staticmethod
    def _raise_if_invalid(errors: Sequence[str]) -> None:
        if errors:
            raise MutationValidationError(errors)
