# Experimental Polymorphic Schema

This directory preserves the earlier MVP `nodes` / `edges` implementation for
experiments only.

Canonical application lanes must use:

- `schema/schema.sql`
- `schema/contracts/graph.schema.json`
- `schema/generated/types.py`
- `schema/generated/types.ts`
- `schema/types.py`

The files in this directory are intentionally not the default schema contract.
Do not wire app code to this path unless a later accepted ADR replaces locked
v3.1 table-per-type storage.
