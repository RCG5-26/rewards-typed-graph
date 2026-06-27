import pathlib
import unittest


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]


class RuntimeArchitectureDocsTest(unittest.TestCase):
    def test_architecture_context_names_current_bridge_runtime(self) -> None:
        doc = _read("context/architecture-context.md")

        self.assertIn("BridgePlanService", doc)
        self.assertIn("apps/api/bridge/hero_bridge.py", doc)
        self.assertIn("synchronous inline replan", doc)
        self.assertIn("not mounted in `apps/api/src/server.ts`", doc)

    def test_orchestration_flow_separates_current_and_target_paths(self) -> None:
        doc = _read("docs/architecture/orchestration-flow.md")

        self.assertIn("Current mounted path: query", doc)
        self.assertIn("Current mounted path: transfer", doc)
        self.assertIn("Target graph-native path", doc)
        self.assertIn("no background replan worker is mounted on `main`", doc)

    def test_runtime_decision_log_records_bridge_amendment(self) -> None:
        decisions = _read("context/decisions-log.md")
        adr = _read("docs/adr/0004-runtime-topology.md")

        self.assertIn("D031", decisions)
        self.assertIn("Python `psql` bridge", decisions)
        self.assertIn("TypeScript orchestrator and async replan worker", adr)
        self.assertIn("does not compose them into the live server on `main`", adr)


def _read(relative_path: str) -> str:
    return (REPO_ROOT / relative_path).read_text(encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
