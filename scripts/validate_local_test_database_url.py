#!/usr/bin/env python3
"""Validate that a destructive dev DB reset targets a local test database."""

from __future__ import annotations

import argparse
import sys
from urllib.parse import urlparse

ALLOWED_HOSTS = {"localhost", "127.0.0.1", "::1"}


def validate_local_test_database_url(database_url: str) -> None:
    parsed = urlparse(database_url)
    host = (parsed.hostname or "").lower()
    db_name = (parsed.path or "/").lstrip("/").split("?")[0]

    if host not in ALLOWED_HOSTS:
        raise ValueError(
            f"Refusing to reset schema: DATABASE_URL host must be localhost "
            f"(got {host!r})."
        )

    if not (
        db_name == "test" or db_name.endswith("_test") or db_name.startswith("test_")
    ):
        raise ValueError(
            "Refusing to reset schema: database must be a dedicated test DB "
            f"(e.g. rewards_test); got {db_name!r}."
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Validate a DATABASE_URL before resetting a local dev schema."
    )
    parser.add_argument("database_url")
    args = parser.parse_args(argv)

    try:
        validate_local_test_database_url(args.database_url)
    except ValueError as exc:
        print(exc, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
