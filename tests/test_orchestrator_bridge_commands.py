"""Unit tests for the orchestrator-* subcommands in hero_bridge.py.

Each handler function (do_orchestrator_*) is tested in isolation by patching
_PsqlConnection, V31GraphWriteService, and _psql_exec/_psql_rows. This keeps
the tests fast and DB-free.

The CLI routing (that argparse actually dispatches to the correct handler) is
covered by the argument-parser smoke tests at the bottom of this file.

Live-PG integration is out of scope here — see the TypeScript live-PG test
gated by RUN_LIVE_POSTGRES_TESTS=1.
"""

import importlib.util
import json
import pathlib
import sys
import unittest
import uuid
from unittest.mock import MagicMock, call, patch

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
BRIDGE_PATH = REPO_ROOT / "apps" / "api" / "bridge" / "hero_bridge.py"


def _load_bridge():
    spec = importlib.util.spec_from_file_location("hero_bridge_orch_test", BRIDGE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("could not load hero_bridge.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


BRIDGE = _load_bridge()

PLAN_ID = "00000000-0000-0000-0000-000000001111"
USER_ID = "00000000-0000-0000-0000-000000002222"
AGENT_RUN_ID = "00000000-0000-0000-0000-000000003333"
LINEAGE_ID = "00000000-0000-0000-0000-000000004444"
PLAN_STEP_ID = "00000000-0000-0000-0000-000000005555"
BALANCE_ID = "00000000-0000-0000-0000-000000006666"


class TestDoOrchestratorCreatePlan(unittest.TestCase):
    def test_returns_plan_id_and_lineage(self):
        fake_service = MagicMock()
        fake_service.create_plan.return_value = PLAN_ID

        with (
            patch.object(BRIDGE, "_PsqlConnection", MagicMock()),
            patch.object(BRIDGE, "V31GraphWriteService", return_value=fake_service),
        ):
            result = BRIDGE.do_orchestrator_create_plan(
                user_id=USER_ID,
                plan_lineage_id=LINEAGE_ID,
                query_text="maximize Hyatt points",
            )

        self.assertEqual(result["planId"], PLAN_ID)
        self.assertEqual(result["planLineageId"], LINEAGE_ID)
        self.assertEqual(result["revisionNumber"], 1)

    def test_delegates_to_v31_create_plan(self):
        fake_service = MagicMock()
        fake_service.create_plan.return_value = PLAN_ID

        with (
            patch.object(BRIDGE, "_PsqlConnection", MagicMock()),
            patch.object(BRIDGE, "V31GraphWriteService", return_value=fake_service),
        ):
            BRIDGE.do_orchestrator_create_plan(
                user_id=USER_ID,
                plan_lineage_id=LINEAGE_ID,
                query_text="book Hyatt Ginza 3-night",
            )

        create_call = fake_service.create_plan.call_args
        req = create_call[0][0]
        self.assertEqual(req.actor, USER_ID)
        self.assertEqual(req.user_id, USER_ID)
        self.assertEqual(req.plan_lineage_id, LINEAGE_ID)
        self.assertEqual(req.revision_number, 1)
        self.assertEqual(req.query_text, "book Hyatt Ginza 3-night")

    def test_raises_bridge_error_on_missing_args(self):
        with self.assertRaises(BRIDGE.BridgeError) as ctx:
            BRIDGE.do_orchestrator_create_plan("", LINEAGE_ID, "query")
        self.assertEqual(ctx.exception.code, "validation")


class TestDoOrchestratorTransitionPlan(unittest.TestCase):
    def test_accepts_current_status(self):
        with (
            patch.object(BRIDGE, "_psql_rows", return_value=[(1,)]),
            patch.object(BRIDGE, "_psql_exec") as mock_exec,
        ):
            result = BRIDGE.do_orchestrator_transition_plan(USER_ID, PLAN_ID, "current")

        self.assertTrue(result["ok"])
        mock_exec.assert_called_once()

    def test_accepts_failed_status(self):
        with (
            patch.object(BRIDGE, "_psql_rows", return_value=[(1,)]),
            patch.object(BRIDGE, "_psql_exec") as mock_exec,
        ):
            result = BRIDGE.do_orchestrator_transition_plan(USER_ID, PLAN_ID, "failed")

        self.assertTrue(result["ok"])
        mock_exec.assert_called_once()

    def test_rejects_unknown_status(self):
        with self.assertRaises(BRIDGE.BridgeError) as ctx:
            BRIDGE.do_orchestrator_transition_plan(USER_ID, PLAN_ID, "published")
        self.assertEqual(ctx.exception.code, "validation")

    def test_rejects_generating_status(self):
        with self.assertRaises(BRIDGE.BridgeError) as ctx:
            BRIDGE.do_orchestrator_transition_plan(USER_ID, PLAN_ID, "generating")
        self.assertEqual(ctx.exception.code, "validation")

    def test_rejects_empty_plan_id(self):
        with self.assertRaises(BRIDGE.BridgeError) as ctx:
            BRIDGE.do_orchestrator_transition_plan(USER_ID, "", "current")
        self.assertEqual(ctx.exception.code, "validation")

    def test_rejects_empty_user_id(self):
        with self.assertRaises(BRIDGE.BridgeError) as ctx:
            BRIDGE.do_orchestrator_transition_plan("", PLAN_ID, "current")
        self.assertEqual(ctx.exception.code, "validation")

    def test_returns_not_found_when_user_id_mismatches(self):
        with (
            patch.object(BRIDGE, "_psql_rows", return_value=[]),
        ):
            with self.assertRaises(BRIDGE.BridgeError) as ctx:
                BRIDGE.do_orchestrator_transition_plan("wrong-user-id", PLAN_ID, "current")
        self.assertEqual(ctx.exception.code, "not_found")


class TestDoOrchestratorCommitStep(unittest.TestCase):
    def _plan_rows(self):
        return [(LINEAGE_ID, USER_ID, 1)]

    def test_returns_plan_step_id_as_mutation_txn_id(self):
        fake_service = MagicMock()
        fake_service.create_plan_step.return_value = PLAN_STEP_ID

        with (
            patch.object(BRIDGE, "_psql_rows", return_value=self._plan_rows()),
            patch.object(BRIDGE, "_PsqlConnection", MagicMock()),
            patch.object(BRIDGE, "V31GraphWriteService", return_value=fake_service),
        ):
            result = BRIDGE.do_orchestrator_commit_step(
                user_id=USER_ID,
                plan_id=PLAN_ID,
                agent_run_id=AGENT_RUN_ID,
                step_order=0,
                step_type="transfer_recommendation",
                payload={"fromProgramId": "b001", "toProgramId": "b002", "amount": 45000},
                idempotency_key="key-1",
                read_set={BALANCE_ID: 1},
            )

        self.assertEqual(result["mutationTxnId"], PLAN_STEP_ID)
        self.assertFalse(result["idempotencyReplayed"])

    def test_resolves_plan_lineage_from_db(self):
        fake_service = MagicMock()
        fake_service.create_plan_step.return_value = PLAN_STEP_ID

        with (
            patch.object(BRIDGE, "_psql_rows", return_value=self._plan_rows()) as mock_rows,
            patch.object(BRIDGE, "_PsqlConnection", MagicMock()),
            patch.object(BRIDGE, "V31GraphWriteService", return_value=fake_service),
        ):
            BRIDGE.do_orchestrator_commit_step(
                user_id=USER_ID,
                plan_id=PLAN_ID,
                agent_run_id=AGENT_RUN_ID,
                step_order=0,
                step_type="redemption_recommendation",
                payload={},
                idempotency_key="key-1",
                read_set={},
            )

        # Verify plan lookup was issued with correct plan_id
        sql_issued = mock_rows.call_args[0][0]
        self.assertIn(PLAN_ID, sql_issued)

    def test_raises_not_found_when_plan_missing(self):
        with (
            patch.object(BRIDGE, "_psql_rows", return_value=[]),
        ):
            with self.assertRaises(BRIDGE.BridgeError) as ctx:
                BRIDGE.do_orchestrator_commit_step(
                    user_id=USER_ID,
                    plan_id="nonexistent",
                    agent_run_id=AGENT_RUN_ID,
                    step_order=0,
                    step_type="transfer_recommendation",
                    payload={},
                    idempotency_key="key-1",
                    read_set={},
                )
        self.assertEqual(ctx.exception.code, "not_found")

    def test_raises_validation_error_on_missing_required_fields(self):
        with self.assertRaises(BRIDGE.BridgeError) as ctx:
            BRIDGE.do_orchestrator_commit_step(
                user_id="",
                plan_id=PLAN_ID,
                agent_run_id=AGENT_RUN_ID,
                step_order=0,
                step_type="transfer_recommendation",
                payload={},
                idempotency_key="key-1",
                read_set={},
            )
        self.assertEqual(ctx.exception.code, "validation")


class TestDoOrchestratorRecordDependency(unittest.TestCase):
    def test_returns_dependency_id_as_mutation_txn_id(self):
        dep_id = str(uuid.uuid4())
        fake_service = MagicMock()
        fake_service.record_state_dependency.return_value = dep_id

        with (
            patch.object(BRIDGE, "_PsqlConnection", MagicMock()),
            patch.object(BRIDGE, "V31GraphWriteService", return_value=fake_service),
        ):
            result = BRIDGE.do_orchestrator_record_dependency(
                user_id=USER_ID,
                plan_step_id=PLAN_STEP_ID,
                target_node_id=BALANCE_ID,
                target_node_type="UserBalance",
                target_table="user_balances",
                observed_version=1,
                depended_property="balance_points",
                snapshot_value={"balancePoints": 30000},
                idempotency_key="dep-key-1",
                read_set={BALANCE_ID: 1},
            )

        self.assertEqual(result["mutationTxnId"], dep_id)
        self.assertFalse(result["idempotencyReplayed"])

    def test_passes_all_fields_to_v31_service(self):
        dep_id = str(uuid.uuid4())
        fake_service = MagicMock()
        fake_service.record_state_dependency.return_value = dep_id

        with (
            patch.object(BRIDGE, "_PsqlConnection", MagicMock()),
            patch.object(BRIDGE, "V31GraphWriteService", return_value=fake_service),
        ):
            BRIDGE.do_orchestrator_record_dependency(
                user_id=USER_ID,
                plan_step_id=PLAN_STEP_ID,
                target_node_id=BALANCE_ID,
                target_node_type="UserBalance",
                target_table="user_balances",
                observed_version=2,
                depended_property="balance_points",
                snapshot_value={"balancePoints": 60000},
                idempotency_key="dep-key-2",
                read_set={BALANCE_ID: 2},
            )

        req = fake_service.record_state_dependency.call_args[0][0]
        self.assertEqual(req.plan_step_id, PLAN_STEP_ID)
        self.assertEqual(req.target_node_id, BALANCE_ID)
        self.assertEqual(req.target_node_type, "UserBalance")
        self.assertEqual(req.target_table, "user_balances")
        self.assertEqual(req.observed_version, 2)
        self.assertEqual(req.snapshot_value, {"balancePoints": 60000})
        self.assertEqual(req.depended_property, "balance_points")

    def test_raises_validation_error_on_missing_fields(self):
        with self.assertRaises(BRIDGE.BridgeError) as ctx:
            BRIDGE.do_orchestrator_record_dependency(
                user_id="",
                plan_step_id=PLAN_STEP_ID,
                target_node_id=BALANCE_ID,
                target_node_type="UserBalance",
                target_table="user_balances",
                observed_version=1,
                depended_property="balance_points",
                snapshot_value={},
                idempotency_key="dep-key",
                read_set={},
            )
        self.assertEqual(ctx.exception.code, "validation")


class TestDoOrchestratorRecordMutation(unittest.TestCase):
    def _plan_rows(self):
        return [(LINEAGE_ID,)]

    def test_returns_a_mutation_txn_id(self):
        with (
            patch.object(BRIDGE, "_psql_rows", return_value=self._plan_rows()),
            patch.object(BRIDGE, "_psql_exec") as mock_exec,
        ):
            result = BRIDGE.do_orchestrator_record_mutation(
                user_id=USER_ID,
                plan_id=PLAN_ID,
                agent_run_id=AGENT_RUN_ID,
                mutation_type="UpdateUserBalance",
                target_node_id=BALANCE_ID,
                target_table="user_balances",
                idempotency_key="mut-key-1",
                read_set={BALANCE_ID: 1},
                payload={"newBalancePoints": 180000},
            )

        # Should return a valid UUID as mutationTxnId
        txn_id = result["mutationTxnId"]
        uuid.UUID(txn_id)  # raises if not valid UUID
        self.assertFalse(result["idempotencyReplayed"])
        mock_exec.assert_called_once()

    def test_raises_not_found_when_plan_missing(self):
        with (
            patch.object(BRIDGE, "_psql_rows", return_value=[]),
        ):
            with self.assertRaises(BRIDGE.BridgeError) as ctx:
                BRIDGE.do_orchestrator_record_mutation(
                    user_id=USER_ID,
                    plan_id="bad-plan",
                    agent_run_id=AGENT_RUN_ID,
                    mutation_type="UpdateUserBalance",
                    target_node_id=BALANCE_ID,
                    target_table="user_balances",
                    idempotency_key="mut-key",
                    read_set={},
                    payload={},
                )
        self.assertEqual(ctx.exception.code, "not_found")

    def test_raises_validation_error_on_missing_fields(self):
        with self.assertRaises(BRIDGE.BridgeError) as ctx:
            BRIDGE.do_orchestrator_record_mutation(
                user_id="",
                plan_id=PLAN_ID,
                agent_run_id=AGENT_RUN_ID,
                mutation_type="UpdateUserBalance",
                target_node_id=BALANCE_ID,
                target_table="user_balances",
                idempotency_key="mut-key",
                read_set={},
                payload={},
            )
        self.assertEqual(ctx.exception.code, "validation")


class TestDoOrchestratorCreateAgentRun(unittest.TestCase):
    def test_returns_agent_run_id_uuid(self):
        with patch.object(BRIDGE, "_psql_exec"):
            result = BRIDGE.do_orchestrator_create_agent_run(
                plan_id=PLAN_ID,
                user_id=USER_ID,
                agent_type="wallet_agent",
            )

        agent_run_id = result["agentRunId"]
        uuid.UUID(agent_run_id)  # raises if not valid UUID

    def test_issues_insert_to_agent_runs(self):
        with patch.object(BRIDGE, "_psql_exec") as mock_exec:
            BRIDGE.do_orchestrator_create_agent_run(
                plan_id=PLAN_ID,
                user_id=USER_ID,
                agent_type="redemption_agent",
            )

        sql_issued = mock_exec.call_args[0][0]
        self.assertIn("agent_runs", sql_issued)
        self.assertIn("running", sql_issued)

    def test_accepts_all_valid_agent_types(self):
        for agent_type in ("orchestrator", "wallet_agent", "earning_agent", "redemption_agent"):
            with patch.object(BRIDGE, "_psql_exec"):
                result = BRIDGE.do_orchestrator_create_agent_run(
                    plan_id=PLAN_ID,
                    user_id=USER_ID,
                    agent_type=agent_type,
                )
            self.assertIn("agentRunId", result)

    def test_rejects_unknown_agent_type(self):
        with self.assertRaises(BRIDGE.BridgeError) as ctx:
            BRIDGE.do_orchestrator_create_agent_run(
                plan_id=PLAN_ID,
                user_id=USER_ID,
                agent_type="llm_agent",
            )
        self.assertEqual(ctx.exception.code, "validation")

    def test_rejects_empty_plan_id(self):
        with self.assertRaises(BRIDGE.BridgeError) as ctx:
            BRIDGE.do_orchestrator_create_agent_run(
                plan_id="",
                user_id=USER_ID,
                agent_type="wallet_agent",
            )
        self.assertEqual(ctx.exception.code, "validation")


class TestDoOrchestratorFinalizeAgentRun(unittest.TestCase):
    def test_accepts_completed_status(self):
        with (
            patch.object(BRIDGE, "_psql_rows", return_value=[(1,)]),
            patch.object(BRIDGE, "_psql_exec") as mock_exec,
        ):
            result = BRIDGE.do_orchestrator_finalize_agent_run(
                agent_run_id=AGENT_RUN_ID,
                status="completed",
                user_id=USER_ID,
            )

        self.assertTrue(result["ok"])
        mock_exec.assert_called_once()

    def test_accepts_failed_status_with_error(self):
        with (
            patch.object(BRIDGE, "_psql_rows", return_value=[(1,)]),
            patch.object(BRIDGE, "_psql_exec") as mock_exec,
        ):
            result = BRIDGE.do_orchestrator_finalize_agent_run(
                agent_run_id=AGENT_RUN_ID,
                status="failed",
                user_id=USER_ID,
                error="commit validation failed",
            )

        self.assertTrue(result["ok"])
        sql_issued = mock_exec.call_args[0][0]
        # Error string should appear in the parameterized query SQL
        self.assertIn("commit validation failed", sql_issued)

    def test_rejects_unknown_status(self):
        with self.assertRaises(BRIDGE.BridgeError) as ctx:
            BRIDGE.do_orchestrator_finalize_agent_run(
                agent_run_id=AGENT_RUN_ID,
                status="running",
                user_id=USER_ID,
            )
        self.assertEqual(ctx.exception.code, "validation")

    def test_rejects_empty_agent_run_id(self):
        with self.assertRaises(BRIDGE.BridgeError) as ctx:
            BRIDGE.do_orchestrator_finalize_agent_run(
                agent_run_id="",
                status="completed",
                user_id=USER_ID,
            )
        self.assertEqual(ctx.exception.code, "validation")

    def test_rejects_empty_user_id(self):
        with self.assertRaises(BRIDGE.BridgeError) as ctx:
            BRIDGE.do_orchestrator_finalize_agent_run(
                agent_run_id=AGENT_RUN_ID,
                status="completed",
                user_id="",
            )
        self.assertEqual(ctx.exception.code, "validation")

    def test_returns_not_found_when_user_id_mismatches(self):
        with (
            patch.object(BRIDGE, "_psql_rows", return_value=[]),
        ):
            with self.assertRaises(BRIDGE.BridgeError) as ctx:
                BRIDGE.do_orchestrator_finalize_agent_run(
                    agent_run_id=AGENT_RUN_ID,
                    status="completed",
                    user_id="wrong-user-id",
                )
        self.assertEqual(ctx.exception.code, "not_found")


class TestDoReadPlan(unittest.TestCase):
    def test_delegates_to_project_plan(self):
        expected = {"planId": PLAN_ID, "steps": []}

        with patch.object(BRIDGE, "project_plan", return_value=expected) as mock_proj:
            result = BRIDGE.do_read_plan(user_id=USER_ID, plan_id=PLAN_ID)

        mock_proj.assert_called_once_with(USER_ID, PLAN_ID)
        self.assertEqual(result, expected)

    def test_raises_validation_error_on_empty_user_id(self):
        with self.assertRaises(BRIDGE.BridgeError) as ctx:
            BRIDGE.do_read_plan(user_id="", plan_id=PLAN_ID)
        self.assertEqual(ctx.exception.code, "validation")

    def test_raises_validation_error_on_empty_plan_id(self):
        with self.assertRaises(BRIDGE.BridgeError) as ctx:
            BRIDGE.do_read_plan(user_id=USER_ID, plan_id="")
        self.assertEqual(ctx.exception.code, "validation")


class TestOrchestratorBridgeArgParser(unittest.TestCase):
    """Smoke-tests that the argparse subcommands are registered correctly."""

    def setUp(self):
        self.parser = BRIDGE.build_parser()

    def _parse(self, args):
        return self.parser.parse_args(args)

    def test_orchestrator_create_plan_subcommand_registered(self):
        ns = self._parse([
            "orchestrator-create-plan",
            "--user-id", USER_ID,
            "--plan-lineage-id", LINEAGE_ID,
            "--query-text", "maximize Hyatt",
        ])
        self.assertEqual(ns.command, "orchestrator-create-plan")
        self.assertEqual(ns.user_id, USER_ID)
        self.assertEqual(ns.plan_lineage_id, LINEAGE_ID)
        self.assertEqual(ns.query_text, "maximize Hyatt")

    def test_orchestrator_transition_plan_subcommand_registered(self):
        ns = self._parse([
            "orchestrator-transition-plan",
            "--user-id", USER_ID,
            "--plan-id", PLAN_ID,
            "--status", "current",
        ])
        self.assertEqual(ns.command, "orchestrator-transition-plan")
        self.assertEqual(ns.user_id, USER_ID)
        self.assertEqual(ns.plan_id, PLAN_ID)
        self.assertEqual(ns.status, "current")

    def test_orchestrator_commit_step_subcommand_registered(self):
        ns = self._parse([
            "orchestrator-commit-step",
            "--user-id", USER_ID,
            "--plan-id", PLAN_ID,
            "--agent-run-id", AGENT_RUN_ID,
            "--step-order", "0",
            "--step-type", "transfer_recommendation",
            "--payload", "{}",
            "--idempotency-key", "key-1",
            "--read-set", "{}",
        ])
        self.assertEqual(ns.command, "orchestrator-commit-step")
        self.assertEqual(ns.step_order, 0)
        self.assertEqual(ns.step_type, "transfer_recommendation")

    def test_orchestrator_create_agent_run_subcommand_registered(self):
        ns = self._parse([
            "orchestrator-create-agent-run",
            "--user-id", USER_ID,
            "--plan-id", PLAN_ID,
            "--agent-type", "wallet_agent",
        ])
        self.assertEqual(ns.command, "orchestrator-create-agent-run")
        self.assertEqual(ns.agent_type, "wallet_agent")

    def test_orchestrator_finalize_agent_run_subcommand_registered(self):
        ns = self._parse([
            "orchestrator-finalize-agent-run",
            "--user-id", USER_ID,
            "--agent-run-id", AGENT_RUN_ID,
            "--status", "completed",
        ])
        self.assertEqual(ns.command, "orchestrator-finalize-agent-run")
        self.assertEqual(ns.user_id, USER_ID)
        self.assertIsNone(ns.error)

    def test_read_plan_subcommand_registered(self):
        ns = self._parse([
            "read-plan",
            "--user-id", USER_ID,
            "--plan-id", PLAN_ID,
        ])
        self.assertEqual(ns.command, "read-plan")
        self.assertEqual(ns.plan_id, PLAN_ID)


if __name__ == "__main__":
    unittest.main()
