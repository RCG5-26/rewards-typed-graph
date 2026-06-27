"""Unit coverage for ``plan_flows.hero_flow.create_direct_plan_from_query``.

The end-to-end write/promotion path needs a live Postgres (see
``tests/integration/test_hero_moment.py``). These tests patch the DB-touching
collaborators so the orchestration's routing decisions and failure handling are
asserted in the normal (DB-less) suite:

* the writer is driven by ``plan_direct_redemption`` over the Hyatt fixture, and
* a write failure marks the generating plan failed and re-raises (no promotion).
"""

import unittest
from unittest.mock import MagicMock, patch

from agents.redemption.planner import plan_direct_redemption
from plan_flows import hero_flow


class CreateDirectPlanFromQueryTests(unittest.TestCase):
    def _service(self):
        service = MagicMock()
        service.create_plan.return_value = "plan-direct-1"
        return service

    def test_drives_writer_with_direct_planner_then_promotes(self):
        service = self._service()
        snapshot = MagicMock()

        with (
            patch.object(hero_flow, "V31GraphWriteService", return_value=service),
            patch.object(hero_flow, "write_redemption_steps") as write,
            patch.object(hero_flow, "_promote_generating_plan_to_current") as promote,
            patch.object(hero_flow, "_plan_snapshot", return_value=snapshot) as snap,
        ):
            result = hero_flow.create_direct_plan_from_query(
                MagicMock(), user_id="user-1", query_text="book a Hyatt stay"
            )

        self.assertIs(result, snapshot)
        promote.assert_called_once()
        snap.assert_called_once()

        _, kwargs = write.call_args
        self.assertIs(kwargs["planner_fn"], plan_direct_redemption)
        self.assertEqual(kwargs["source_program_slug"], "program:hyatt")
        self.assertEqual(kwargs["fixture"]["scope"]["source_program_slug"], "program:hyatt")
        self.assertEqual(kwargs["plan_id"], "plan-direct-1")

    def test_marks_plan_failed_and_reraises_when_write_fails(self):
        service = self._service()

        with (
            patch.object(hero_flow, "V31GraphWriteService", return_value=service),
            patch.object(
                hero_flow, "write_redemption_steps", side_effect=RuntimeError("write failed")
            ),
            patch.object(hero_flow, "_mark_generating_plan_failed") as mark_failed,
            patch.object(hero_flow, "_promote_generating_plan_to_current") as promote,
            patch.object(hero_flow, "_plan_snapshot") as snap,
        ):
            with self.assertRaises(RuntimeError):
                hero_flow.create_direct_plan_from_query(
                    MagicMock(), user_id="user-1", query_text="book a Hyatt stay"
                )

        mark_failed.assert_called_once()
        promote.assert_not_called()
        snap.assert_not_called()


if __name__ == "__main__":
    unittest.main()
