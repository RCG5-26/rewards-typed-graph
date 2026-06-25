#!/usr/bin/env python3
"""Rewrite lcov source-file path prefixes so coverage reports are repo-root-relative.

Vitest run inside ``apps/api`` emits ``SF:src/...`` lines (relative to ``apps/api``).
The CI diff-coverage gate matches coverage paths against ``git diff`` output, which
is repo-root-relative. This rewrites the prefix and fails loudly when nothing
matched, so a future report-format change can't silently drop a stack from the gate.
"""

from __future__ import annotations

import argparse
import sys


def normalize_lcov_prefix(
    content: str, old_prefix: str, new_prefix: str
) -> tuple[str, int]:
    """Return ``(rewritten_content, lines_rewritten)``.

    Only lines that start with ``old_prefix`` are rewritten; every other line is
    left byte-for-byte unchanged.
    """
    rewritten: list[str] = []
    count = 0
    for line in content.splitlines(keepends=True):
        if line.startswith(old_prefix):
            line = new_prefix + line[len(old_prefix) :]
            count += 1
        rewritten.append(line)
    return "".join(rewritten), count


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", help="lcov file to rewrite in place")
    parser.add_argument("--old-prefix", required=True)
    parser.add_argument("--new-prefix", required=True)
    args = parser.parse_args(argv)

    with open(args.path, encoding="utf-8") as handle:
        content = handle.read()

    rewritten, count = normalize_lcov_prefix(content, args.old_prefix, args.new_prefix)
    if count == 0:
        print(
            f"::error::no '{args.old_prefix}' lines found in {args.path}; "
            "coverage path normalization would silently disable the gate",
            file=sys.stderr,
        )
        return 1

    with open(args.path, "w", encoding="utf-8") as handle:
        handle.write(rewritten)
    print(
        f"Rewrote {count} '{args.old_prefix}' -> '{args.new_prefix}' "
        f"line(s) in {args.path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
