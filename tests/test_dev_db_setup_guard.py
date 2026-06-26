import importlib.util
import io
import pathlib
import unittest
from contextlib import redirect_stderr

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "scripts" / "validate_local_test_database_url.py"


def _load_module():
    spec = importlib.util.spec_from_file_location(
        "validate_local_test_database_url", SCRIPT_PATH
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


mod = _load_module()


class ValidateLocalTestDatabaseUrlTest(unittest.TestCase):
    def test_accepts_local_dedicated_test_database(self):
        mod.validate_local_test_database_url(
            "postgresql://rewards:rewards@localhost:5432/rewards_test"
        )

    def test_accepts_ipv6_loopback_test_database(self):
        mod.validate_local_test_database_url(
            "postgresql://user:pass@[::1]:5432/test_db"
        )

    def test_accepts_loopback_test_database(self):
        mod.validate_local_test_database_url("postgresql://user:pass@127.0.0.1/test_db")

    def test_rejects_remote_database_host(self):
        with self.assertRaisesRegex(ValueError, "host must be localhost"):
            mod.validate_local_test_database_url(
                "postgresql://user:pass@db.example.com:5432/rewards_test"
            )

    def test_rejects_non_test_database_name(self):
        with self.assertRaisesRegex(ValueError, "dedicated test DB"):
            mod.validate_local_test_database_url(
                "postgresql://rewards:rewards@localhost:5432/rewards"
            )

    def test_rejects_hostaddr_query_target_override(self):
        with self.assertRaisesRegex(ValueError, "target override"):
            mod.validate_local_test_database_url(
                "postgresql://rewards:rewards@localhost:5432/rewards_test"
                "?hostaddr=203.0.113.10"
            )

    def test_rejects_host_query_target_override(self):
        with self.assertRaisesRegex(ValueError, "target override"):
            mod.validate_local_test_database_url(
                "postgresql://rewards:rewards@localhost:5432/rewards_test"
                "?host=db.example.com"
            )

    def test_rejects_dbname_query_target_override(self):
        with self.assertRaisesRegex(ValueError, "target override"):
            mod.validate_local_test_database_url(
                "postgresql://rewards:rewards@localhost:5432/rewards_test"
                "?dbname=prod"
            )

    def test_cli_reports_rejection_without_traceback(self):
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            rc = mod.main(["postgresql://rewards:rewards@localhost:5432/rewards"])
        self.assertEqual(rc, 1)
        self.assertIn("dedicated test DB", stderr.getvalue())
        self.assertNotIn("Traceback", stderr.getvalue())

    def test_cli_accepts_valid_database_url(self):
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            rc = mod.main(
                ["postgresql://rewards:rewards@localhost:5432/rewards_test"]
            )
        self.assertEqual(rc, 0)
        self.assertEqual(stderr.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
