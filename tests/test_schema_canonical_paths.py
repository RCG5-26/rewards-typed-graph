import pathlib
import unittest


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
CANONICAL_SCHEMA_SQL = REPO_ROOT / "schema" / "schema.sql"
EXPERIMENTAL_POLYMORPHIC_SQL = (
    REPO_ROOT / "schema" / "experimental" / "polymorphic" / "schema.sql"
)
EXPERIMENTAL_POLYMORPHIC_CONTRACT = (
    REPO_ROOT / "schema" / "experimental" / "polymorphic" / "graph.schema.json"
)


class SchemaCanonicalPathsTest(unittest.TestCase):
    def test_default_schema_is_v31_table_per_type(self):
        schema_sql = CANONICAL_SCHEMA_SQL.read_text(encoding="utf-8")

        self.assertIn("CREATE TABLE credit_cards", schema_sql)
        self.assertIn("CREATE TABLE reward_programs", schema_sql)
        self.assertIn("CREATE TABLE user_balances", schema_sql)
        self.assertIn("CREATE TABLE plans", schema_sql)
        self.assertIn("CREATE TABLE plan_steps", schema_sql)
        self.assertIn("CREATE TABLE state_dependencies", schema_sql)
        self.assertNotIn("CREATE TABLE nodes", schema_sql)
        self.assertNotIn("CREATE TABLE edges", schema_sql)

    def test_default_schema_uses_v31_plan_lifecycle(self):
        schema_sql = CANONICAL_SCHEMA_SQL.read_text(encoding="utf-8")

        self.assertIn(
            "status IN ('generating', 'current', 'stale', 'failed', 'superseded')",
            schema_sql,
        )
        self.assertIn(
            "status IN ('proposed', 'current', 'stale', 'superseded')",
            schema_sql,
        )
        self.assertIn("CREATE UNIQUE INDEX plans_one_current_revision", schema_sql)
        self.assertIn("WHERE status = 'current'", schema_sql)
        self.assertNotIn("is_current", schema_sql)
        self.assertNotIn("is_stale", schema_sql)

    def test_polymorphic_schema_is_explicitly_experimental(self):
        self.assertTrue(EXPERIMENTAL_POLYMORPHIC_SQL.exists())
        self.assertTrue(EXPERIMENTAL_POLYMORPHIC_CONTRACT.exists())

        schema_sql = EXPERIMENTAL_POLYMORPHIC_SQL.read_text(encoding="utf-8")
        self.assertIn("CREATE TABLE nodes", schema_sql)
        self.assertIn("CREATE TABLE edges", schema_sql)
        self.assertIn("CREATE TABLE replan_jobs", schema_sql)


if __name__ == "__main__":
    unittest.main()
