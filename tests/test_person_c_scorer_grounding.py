"""Step 4: grounding boundary correctness for person_c_scorer.

Root cause of the prior EVALUATOR_BOUNDARY_MISMATCH: a balance slug genuinely
supplied to the model (`balance:user_mvp_demo:chase_ur`) was omitted from
`_fixture_fact_slugs`, so the scorer mislabeled a grounded citation as
`award_not_in_tool_result`. These tests pin the boundary: every slug that is
genuinely supplied is grounded; an identifier absent from every supplied source
is still ungrounded (the evaluator is not weakened to accept arbitrary ids).
"""

from __future__ import annotations

import unittest
from pathlib import Path

from agents.redemption.planner import load_fixture
from benchmark.person_c_scorer import (
    _fixture_fact_slugs,
    fixture_fact_slug_sources,
    hallucination_issues,
)

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_PATH = ROOT / "fixtures" / "demo-comparison-baseline.json"

GINZA = "award:demo_hyatt_ginza:tokyo:3n"
CHASE_BALANCE_SLUG = "balance:user_mvp_demo:chase_ur"


def _plan_citing(fact_slugs: list[str]) -> dict:
    """A minimal baseline-shaped plan whose single ranked award cites fact_slugs."""
    return {
        "status": "current",
        "chosen_award_slug": GINZA,
        "fallback": None,
        "balance_points": 180000,
        "ranked_awards": [
            {
                "award_slug": GINZA,
                "required_source_points": 45000,
                "candidate_fact_slugs": fact_slugs,
            }
        ],
        "steps": [],
    }


def _case() -> dict:
    return {"starting_balance_points": 180000}


class GroundingBoundaryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = load_fixture(FIXTURE_PATH)
        self.case = _case()

    def test_supplied_balance_slug_is_grounded(self) -> None:
        issues = hallucination_issues(
            self.fixture, _plan_citing([CHASE_BALANCE_SLUG]), self.case
        )
        self.assertNotIn("award_not_in_tool_result", issues)

    def test_supplied_award_slug_is_grounded(self) -> None:
        issues = hallucination_issues(self.fixture, _plan_citing([GINZA]), self.case)
        self.assertNotIn("award_not_in_tool_result", issues)

    def test_absent_slug_is_ungrounded(self) -> None:
        issues = hallucination_issues(
            self.fixture, _plan_citing(["balance:made_up:nonexistent"]), self.case
        )
        self.assertIn("award_not_in_tool_result", issues)

    def test_normalizer_created_slug_is_detected_separately(self) -> None:
        # A slug invented by a normalizer (not present in any supplied source) is
        # NOT silently accepted — it has no source category and stays ungrounded.
        sources = fixture_fact_slug_sources(self.fixture)
        self.assertEqual(sources.get(CHASE_BALANCE_SLUG), "balance")
        self.assertEqual(sources.get(GINZA), "award_option")
        self.assertIsNone(sources.get("normalized:synthetic:slug"))
        issues = hallucination_issues(
            self.fixture, _plan_citing(["normalized:synthetic:slug"]), self.case
        )
        self.assertIn("award_not_in_tool_result", issues)

    def test_balance_slugs_are_in_the_valid_fact_set(self) -> None:
        slugs = _fixture_fact_slugs(self.fixture)
        self.assertIn(CHASE_BALANCE_SLUG, slugs)
        self.assertIn("balance:user_mvp_demo:hyatt", slugs)

    def test_does_not_accept_arbitrary_identifiers(self) -> None:
        # Guard against weakening: an identifier matching no supplied fact source
        # must never appear in the valid set.
        slugs = _fixture_fact_slugs(self.fixture)
        self.assertNotIn("balance:made_up:nonexistent", slugs)


if __name__ == "__main__":
    unittest.main()
