# JSON Schema contracts

Authoritative wire shapes per [ADR 0007](../../docs/adr/0007-contract-ownership-codegen.md). SQL DDL remains authoritative for persistence in `schema/schema.sql`.

| Contract                     | File                                                       | Maps to                   |
| ---------------------------- | ---------------------------------------------------------- | ------------------------- |
| SSE mutation event (one row) | [`mutation-event.schema.json`](mutation-event.schema.json) | `graph_mutations` columns |

Generated TS/Python types land in `packages/schema-ts/` and `agents/schema_py/` when codegen is wired (Phase A3).
