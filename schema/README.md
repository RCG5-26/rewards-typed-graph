# Canonical MVP Schema Artifacts

These files are the machine-usable schema artifacts for the MVP described in
[`docs/architecture/schemaMVP.md`](../docs/architecture/schemaMVP.md).

- `schema.sql` defines the Postgres tables, constraints, and indexes.
- `types.py` defines Python constants, dataclasses, and lightweight validators
  for node and edge payloads.

Keep these artifacts aligned with the MVP doc. After schema lock, changes should
be additive unless the team records and approves a migration decision.
