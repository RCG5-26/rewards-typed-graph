"""v3.1 graph-write boundary.

The canonical v3.1 persistence path is table-per-type SQL in schema/schema.sql.
Application write services should live under apps/api once the API scaffold
exists. The older polymorphic mutation service is preserved for experiments at
schema.experimental.polymorphic.mutations.
"""

from __future__ import annotations


class V31GraphWriteNotImplemented(RuntimeError):
    """Raised if code tries to use the pre-app v3.1 write placeholder."""


def require_app_graph_write() -> None:
    """Signal that callers must use the application graph-write implementation."""

    raise V31GraphWriteNotImplemented(
        "v3.1 writes are implemented in the app graph-write layer; "
        "use schema.experimental.polymorphic.mutations only for the optional "
        "polymorphic experiment."
    )
