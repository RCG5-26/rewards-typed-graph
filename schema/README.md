# Canonical MVP Schema Artifacts

These files are the machine-usable schema artifacts for the MVP described in
[`docs/architecture/schemaMVP.md`](../docs/architecture/schemaMVP.md).

- `schema.sql` defines the Postgres tables, constraints, and indexes.
- `types.py` defines Python constants, dataclasses, and lightweight validators
  for node and edge payloads.

Keep these artifacts aligned with the MVP doc. After schema lock, changes should
be additive unless the team records and approves a migration decision.

## Still Not Fully Implemented

- `seed.sql` fixture with stable IDs for the demo user, cards, programs,
  balances, goal, plan query, plan step, and dependency edges.
- One active `Balance` per `User` + `Program` enforcement. The likely MVP path
  is a partial unique index on `nodes.user_id` and
  `nodes.attributes->>'program_id'` for rows where `type = 'Balance'`.
- Full graph write service tying together Python validation, optimistic SQL
  writes, mutation logging, stale-plan propagation, and retry behavior.
