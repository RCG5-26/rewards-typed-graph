import json
import pathlib
import unittest


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTINGENCY_PATH = REPO_ROOT / "fixtures" / "demo-contingency-layer4-cut.json"
RUNBOOK_PATH = REPO_ROOT / "docs" / "demo" / "layer4-cut-contingency.md"
SPRINT_PLAN_PATH = REPO_ROOT / "docs" / "meetings" / "sprint-plan-jun24-29.md"

# D030 (context/decisions-log.md) anchors the Layer 4 no-go decision to these
# two sources; the fixture's canonicalSources must mirror them.
D030_CANONICAL_SOURCES = {
    "docs/demo/layer4-cut-contingency.md",
    "docs/meetings/sprint-plan-jun24-29.md",
}


class DemoLayer4CutContingencyTest(unittest.TestCase):
    def setUp(self):
        self.fixture = json.loads(CONTINGENCY_PATH.read_text(encoding="utf-8"))
        self.runbook = RUNBOOK_PATH.read_text(encoding="utf-8")
        self.sprint_plan = SPRINT_PLAN_PATH.read_text(encoding="utf-8")

    def test_layer4_is_explicitly_cut(self):
        decision = self.fixture["decision"]

        self.assertEqual(decision["layer4Status"], "cut")
        self.assertIn("Layer 4", decision["presenterLine"])
        self.assertIn("cut", decision["presenterLine"])
        self.assertIn("Layers 1-3", decision["presenterLine"])
        self.assertIn("Layer 4 is cut", self.runbook)
        self.assertIn("Layer 4 (ingestion/verifier, Hero Moment 2)", self.sprint_plan)
        self.assertIn("NO-GO now", self.sprint_plan)

    def test_canonical_sources_mirror_the_decision_log(self):
        self.assertEqual(
            set(self.fixture["decision"]["canonicalSources"]),
            D030_CANONICAL_SOURCES,
        )

    def test_demo_path_uses_only_shipped_layers_one_to_three_routes(self):
        routes = set(self.fixture["demoPath"]["requiredRoutes"])
        expected_routes = {
            "GET /session",
            "POST /demo/reset",
            "POST /plans",
            "GET /plans/:planId",
            "GET /plans/current",
            "POST /balance-transfer",
            "GET /mutations",
            "GET /mutations/stream",
        }

        self.assertEqual(routes, expected_routes)
        forbidden_fragments = ("ingest", "verifier", "proposal", "layer4")
        for route in routes:
            self.assertFalse(
                any(fragment in route.lower() for fragment in forbidden_fragments),
                route,
            )

    def test_hero_moment_two_is_cut_with_a_shipped_replacement(self):
        moments = {
            moment["id"]: moment
            for moment in self.fixture["demoPath"]["heroMoments"]
        }

        self.assertEqual(moments["hero-1"]["status"], "show")
        self.assertEqual(moments["hero-2"]["status"], "cut")
        self.assertIn("mutation sidebar", moments["hero-2"]["replacement"])
        self.assertIn("revision history", moments["hero-2"]["replacement"])
        self.assertIn("Hero Moment 2 (Layer 4): **cut**", self.sprint_plan)

    def test_layer4_forbidden_surface_is_complete(self):
        forbidden = self.fixture["demoPath"]["forbiddenSurface"]

        self.assertEqual(
            set(forbidden["tickets"]),
            {"RCG-39", "RCG-41", "RCG-42", "RCG-43", "RCG-44", "RCG-50"},
        )
        self.assertEqual(
            set(forbidden["schemaTerms"]),
            {"MutationProposal", "visibility_scope", "global graph_mutations"},
        )
        self.assertEqual(
            set(forbidden["routes"]),
            {"/ingestion", "/verifier", "/mutation-proposals", "/layer4"},
        )
        self.assertEqual(
            set(forbidden["eventScopes"]),
            {"global mutation events", "world-tier Layer 4 events"},
        )

    def test_fallbacks_preserve_the_layer4_cut(self):
        fallbacks = self.fixture["demoPath"]["fallbacks"]

        self.assertGreaterEqual(len(fallbacks), 2)
        self.assertTrue(
            any("GET /mutations?after=<lastEventId>" in item["action"] for item in fallbacks)
        )
        self.assertTrue(
            any("fixtures/mock-plan.json" in item["action"] for item in fallbacks)
        )
        for item in fallbacks:
            self.assertNotIn("MutationProposal", item["action"])
            self.assertNotIn("/verifier", item["action"])

    def test_runbook_links_the_machine_checked_fixture(self):
        self.assertEqual(
            self.fixture["runbook"],
            "docs/demo/layer4-cut-contingency.md",
        )
        self.assertIn("fixtures/demo-contingency-layer4-cut.json", self.runbook)
        self.assertIn("../demo/layer4-cut-contingency.md", self.sprint_plan)
        self.assertIn("POST /plans", self.runbook)
        self.assertIn("POST /balance-transfer", self.runbook)
        self.assertIn("GET /mutations/stream", self.runbook)


if __name__ == "__main__":
    unittest.main()
