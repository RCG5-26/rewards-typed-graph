import importlib.util
import pathlib
import tempfile
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "scripts" / "ci" / "normalize_coverage_paths.py"

OLD_PREFIX = "SF:src/"
NEW_PREFIX = "SF:apps/api/src/"


def _load_module():
    spec = importlib.util.spec_from_file_location("normalize_coverage_paths", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


mod = _load_module()


class NormalizeLcovPrefixTest(unittest.TestCase):
    def test_rewrites_each_matching_line(self):
        content = "SF:src/a.ts\nDA:1,1\nSF:src/b.ts\n"
        out, count = mod.normalize_lcov_prefix(content, OLD_PREFIX, NEW_PREFIX)
        self.assertEqual(count, 2)
        self.assertIn("SF:apps/api/src/a.ts", out)
        self.assertIn("SF:apps/api/src/b.ts", out)

    def test_leaves_nonmatching_lines_untouched(self):
        content = "DA:1,1\nFN:3,foo\n"
        out, count = mod.normalize_lcov_prefix(content, OLD_PREFIX, NEW_PREFIX)
        self.assertEqual(count, 0)
        self.assertEqual(out, content)

    def test_only_rewrites_prefix_at_line_start(self):
        content = "note SF:src/a.ts\n"
        out, count = mod.normalize_lcov_prefix(content, OLD_PREFIX, NEW_PREFIX)
        self.assertEqual(count, 0)
        self.assertEqual(out, content)

    def test_empty_content(self):
        out, count = mod.normalize_lcov_prefix("", OLD_PREFIX, NEW_PREFIX)
        self.assertEqual(count, 0)
        self.assertEqual(out, "")

    def test_preserves_suffix_after_prefix(self):
        out, count = mod.normalize_lcov_prefix("SF:src/deep/x.ts\n", OLD_PREFIX, NEW_PREFIX)
        self.assertEqual(count, 1)
        self.assertEqual(out, "SF:apps/api/src/deep/x.ts\n")


class MainCliTest(unittest.TestCase):
    def _write(self, text):
        handle = tempfile.NamedTemporaryFile(
            "w", suffix=".info", delete=False, encoding="utf-8"
        )
        handle.write(text)
        handle.close()
        return pathlib.Path(handle.name)

    def test_rewrites_file_in_place_and_returns_zero(self):
        path = self._write("SF:src/a.ts\nDA:1,1\n")
        try:
            rc = mod.main(
                [str(path), "--old-prefix", OLD_PREFIX, "--new-prefix", NEW_PREFIX]
            )
            self.assertEqual(rc, 0)
            self.assertIn("SF:apps/api/src/a.ts", path.read_text(encoding="utf-8"))
        finally:
            path.unlink()

    def test_no_match_returns_one_and_leaves_file_unchanged(self):
        original = "DA:1,1\n"
        path = self._write(original)
        try:
            rc = mod.main(
                [str(path), "--old-prefix", OLD_PREFIX, "--new-prefix", NEW_PREFIX]
            )
            self.assertEqual(rc, 1)
            self.assertEqual(path.read_text(encoding="utf-8"), original)
        finally:
            path.unlink()


if __name__ == "__main__":
    unittest.main()
