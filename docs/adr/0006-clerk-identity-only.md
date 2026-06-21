# 0006 — Clerk Identity-Only Scope

- **Status:** Accepted — June 18, 2026.
- **Owner:** Val (frontend); Raq (API integration)
- **Index:** [`context/decisions-log.md`](../../context/decisions-log.md) (D006, D016)
- **Related:** [`architecture-context.md`](../../context/architecture-context.md) §Auth & access model

## Context

The demo needs real sign-in without building authorization product features. Multi-user isolation must be clear for judges and for per-user graph tiers.

## Decision

**Clerk scope: identity only**
- Sign-in / sign-up via Clerk; API verifies JWT → maps to `users.clerk_id`.
- **No** Clerk organizations, roles, invitations, or admin UI in MVP.

**Data ownership**
- World graph: shared seed; read-only in app paths.
- Personal + plan graph: scoped by authenticated `user_id` on all mutable rows.
- Demo persona = **bootstrap template** cloned on first login — not one global mutable user shared by all sessions.

**Reset behavior**
- **Per-user reset** (authenticated): deletes or restores only that user's personal and plan state; world seed unchanged; ordinary demo feature, not admin tooling.
- **Global reset** (optional stretch): requires separate `ADMIN_RESET_SECRET`; not ordinary user behavior.

**Eval path**
- No Clerk; fixture user on ephemeral eval DB.

## Consequences

- All graph-write and graph-query paths filter by authenticated user for personal/plan tiers.
- SSE streams filter `graph_mutations WHERE user_id = authenticated_user`.
- Frontend never receives or stores database credentials.
- Org-style demos (shared team workspace) are out of scope for MVP.
