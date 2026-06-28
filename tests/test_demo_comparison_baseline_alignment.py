"""Step 3 proof: both LLM baselines receive the canonical wallet + canonical query.

These tests construct the exact user prompt each baseline would send to the
model (no network call) from the canonical comparison fixture and case, and
assert the supplied facts match the frozen transfer-required wallet. This is the
data-alignment guarantee: without it, a head-to-head comparison would be unfair.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from agents.redemption.planner import load_fixture
from benchmark import free_text_multiagent_baseline as free_text
from benchmark import single_agent_baseline as single_agent

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_PATH = ROOT / "fixtures" / "demo-comparison-baseline.json"
CASES_PATH = ROOT / "benchmark" / "gold" / "demo-comparison-cases.json"
CANONICAL_QUERY = (
    "What is the best way to use my points for a three-night hotel stay in Tokyo?"
)


def _canonical_case() -> dict:
    cases = load_fixture(CASES_PATH)
    return cases["cases"][0]


class SingleAgentAlignmentTest(unittest.TestCase):
    def setUp(self) -> None:
        self.base_fixture = load_fixture(FIXTURE_PATH)
        self.case = _canonical_case()
        fixture = single_agent._fixture_for_case(self.base_fixture, self.case)
        self.prompt = single_agent._user_prompt(fixture, self.case)
        self.payload = json.loads(self.prompt)

    def test_query_is_canonical_verbatim(self) -> None:
        self.assertEqual(self.payload["benchmark_case"]["query"], CANONICAL_QUERY)

    def test_supplied_balances_match_canonical_wallet(self) -> None:
        balances = {
            b["program_slug"]: b["balance_points"]
            for b in self.payload["seeded_context"]["balances"]
        }
        self.assertEqual(balances["program:chase_ur"], 180000)
        self.assertEqual(balances["program:hyatt"], 30000)
        self.assertEqual(balances["program:united"], 30000)

    def test_supplied_award_costs_match_canonical_wallet(self) -> None:
        awards = {
            a["slug"]: a["points_total"]
            for a in self.payload["seeded_context"]["award_options"]
        }
        self.assertEqual(awards["award:demo_hyatt_ginza:tokyo:3n"], 45000)
        self.assertEqual(awards["award:demo_united_tokyo:3n"], 60000)

    def test_supplied_transfer_routes_are_one_to_one(self) -> None:
        routes = {
            (p["source_program_slug"], p["dest_program_slug"]): p["transfer_ratio_basis_points"]
            for p in self.payload["seeded_context"]["transfer_paths"]
        }
        self.assertEqual(routes[("program:chase_ur", "program:hyatt")], 10000)
        self.assertEqual(routes[("program:chase_ur", "program:united")], 10000)


class FreeTextAlignmentTest(unittest.TestCase):
    def setUp(self) -> None:
        self.base_fixture = load_fixture(FIXTURE_PATH)
        self.case = _canonical_case()

    def _payload_for_role(self, role: str) -> dict:
        fixture = free_text._fixture_for_case(self.base_fixture, self.case)
        prompt = free_text._user_prompt(fixture, self.case, role, transcript=[])
        return json.loads(prompt)

    def test_every_role_receives_the_canonical_query(self) -> None:
        for role in free_text.FREE_TEXT_AGENT_ROLES:
            payload = self._payload_for_role(role)
            self.assertEqual(
                payload["benchmark_case"]["query"],
                CANONICAL_QUERY,
                msg=f"role {role} did not receive the canonical query",
            )

    def test_coordinator_receives_canonical_facts(self) -> None:
        payload = self._payload_for_role("coordinator")
        balances = {
            b["program_slug"]: b["balance_points"]
            for b in payload["seeded_context"]["balances"]
        }
        self.assertEqual(balances["program:chase_ur"], 180000)
        self.assertEqual(balances["program:hyatt"], 30000)
        self.assertEqual(balances["program:united"], 30000)
        awards = {
            a["slug"]: a["points_total"]
            for a in payload["seeded_context"]["award_options"]
        }
        self.assertEqual(awards["award:demo_hyatt_ginza:tokyo:3n"], 45000)


class BaselinePromptsAreEquivalentTest(unittest.TestCase):
    """The two baselines must share identical seeded facts for a fair comparison."""

    def test_seeded_context_is_identical_across_baselines(self) -> None:
        base_fixture = load_fixture(FIXTURE_PATH)
        case = _canonical_case()
        sa_fixture = single_agent._fixture_for_case(base_fixture, case)
        ft_fixture = free_text._fixture_for_case(base_fixture, case)
        sa = json.loads(single_agent._user_prompt(sa_fixture, case))["seeded_context"]
        ft = json.loads(
            free_text._user_prompt(ft_fixture, case, "coordinator", transcript=[])
        )["seeded_context"]
        self.assertEqual(sa, ft)


if __name__ == "__main__":
    unittest.main()
