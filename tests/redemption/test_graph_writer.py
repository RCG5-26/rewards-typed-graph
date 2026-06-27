import unittest

from plan_flows.redemption_graph_writer import write_redemption_steps


HERO_QUERY = "What is the best Hyatt redemption for a 3-night Tokyo trip?"


class FakeCursor:
    def __init__(self, connection):
        self.connection = connection
        self.result = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=None):
        self.connection.executed.append((sql, params or ()))
        compact_sql = " ".join(sql.split())
        if compact_sql.startswith("SELECT ub.id, rp.slug, ub.balance_points, ub.version"):
            self.result = self.connection.balance_row
            return
        self.result = None

    def fetchone(self):
        return self.result


class FakeConnection:
    def __init__(self, balance_row):
        self.balance_row = balance_row
        self.executed = []

    def cursor(self):
        return FakeCursor(self)


class FakeGraphWriteService:
    def __init__(self):
        self.step_requests = []
        self.dependency_requests = []

    def create_plan_step(self, request):
        self.step_requests.append(request)
        return f"00000000-0000-0000-0000-00000000f00{request.step_order}"

    def record_state_dependency(self, request):
        self.dependency_requests.append(request)
        return f"00000000-0000-0000-0000-00000000d10{len(self.dependency_requests)}"


class RedemptionGraphWriterTests(unittest.TestCase):
    def test_writes_tradeoff_steps_and_real_balance_dependencies(self):
        connection = FakeConnection(
            (
                "00000000-0000-0000-0000-00000000d001",
                "program:chase_ur",
                75000,
                7,
            )
        )
        service = FakeGraphWriteService()

        result = write_redemption_steps(
            connection,
            user_id="00000000-0000-0000-0000-00000000a001",
            plan_id="00000000-0000-0000-0000-00000000e001",
            query_text=HERO_QUERY,
            plan_lineage_id="00000000-0000-0000-0000-00000000e000",
            revision_number=1,
            graph_write_service=service,
        )

        self.assertEqual(result.step_count, 3)
        self.assertEqual(result.dependency_count, 3)
        self.assertTrue(all(request.actor == "redemption_agent" for request in service.step_requests))

        first_step_payload = service.step_requests[0].payload
        self.assertEqual(first_step_payload["action"], "Transfer 45,000 Chase Ultimate Rewards points to World of Hyatt.")
        self.assertIn("reasoning", first_step_payload)
        self.assertEqual(first_step_payload["tradeoff"]["transfer_ratio_basis_points"], 10000)

        second_step_payload = service.step_requests[1].payload
        self.assertEqual(second_step_payload["tradeoff"]["value_basis_points"], 23333)
        self.assertEqual(second_step_payload["tradeoff"]["cash_total_cents"], 105000)

        self.assertEqual(len(service.dependency_requests), 3)
        for dependency in service.dependency_requests:
            self.assertEqual(dependency.target_node_id, "00000000-0000-0000-0000-00000000d001")
            self.assertEqual(dependency.target_table, "user_balances")
            self.assertEqual(dependency.observed_version, 7)
            self.assertEqual(
                dependency.snapshot_value,
                {
                    "balance_points": 75000,
                    "program_slug": "program:chase_ur",
                },
            )

    def test_uses_current_database_balance_when_replanning(self):
        connection = FakeConnection(
            (
                "00000000-0000-0000-0000-00000000d001",
                "program:chase_ur",
                35000,
                2,
            )
        )
        service = FakeGraphWriteService()

        result = write_redemption_steps(
            connection,
            user_id="00000000-0000-0000-0000-00000000a001",
            plan_id="00000000-0000-0000-0000-00000000e002",
            query_text=HERO_QUERY,
            plan_lineage_id="00000000-0000-0000-0000-00000000e000",
            revision_number=2,
            step_status="proposed",
            graph_write_service=service,
        )

        self.assertEqual(result.plan_draft["chosen_award_slug"], "award:demo_hyatt_shinjuku:tokyo:3n")
        self.assertTrue(all(request.status == "proposed" for request in service.step_requests))
        self.assertEqual(service.dependency_requests[0].observed_version, 2)


if __name__ == "__main__":
    unittest.main()
