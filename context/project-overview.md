# Rewards Agent

> A personalized credit-card rewards planning assistant whose specialist agents coordinate through a shared typed graph to build multi-step plans that adapt when the user's situation changes.

**Owner:** Raq · **Repo:** https://github.com/RCG5-26/rewards-typed-graph · **Status:** active

---

## What it is

Rewards Agent is a personalized credit-card rewards planning assistant. Instead of answering one question at a time, it produces multi-step redemption plans — which points to transfer and how to book — with reasoning shown for each step. Its specialist agents (orchestrator, wallet, earning, redemption) coordinate by reading and writing a shared typed graph rather than passing free-text messages to one another. When a relevant piece of state changes mid-conversation, the plan steps that relied on it are structurally invalidated and the plan is recomputed automatically.

---

## Who it's for

### Primary users

- **The rewards optimizer (modeled user).** Someone with several cards across multiple loyalty programs who wants the best use of their points for a concrete goal, such as a trip. Existing tools do category lookups, not multi-step plans that stay valid when things change.
- **Fellowship reviewers and technical evaluators.** This sprint is a proof of concept, not a shipped product; its job is to make the architecture legible through a live demo and a benchmark.

### Not for

- Everyday consumers expecting a production tool with linked accounts. This sprint does not connect to real banks, sync live balances, or manage real money.

---

## Goals

1. Generate portfolio-level multi-step plans with reasoning visible on each step.
2. Adapt correctly: a relevant state change invalidates the affected plan steps and produces an updated plan.
3. Make agent coordination observable — typed-graph mutations visible as the plan is built.
4. Evaluate typed-graph coordination against a single-agent baseline and a free-text multi-agent baseline on one shared query set.
5. Deliver an effective live demonstration within the allotted time.

---

## Core user flows

### Flow 1: Create a rewards plan

1. The user enters their wallet — cards, balances, loyalty status, and a goal.
2. They ask a natural-language question (e.g., best use of points for a Tokyo trip in October).
3. The orchestrator splits the query into graph operations; the earning and redemption agents read state and weigh the tradeoffs.
4. The system returns a multi-step plan, each step carrying its reasoning and a net value comparison.
5. **Outcome:** an actionable, explained plan rather than a single-line answer.

### Flow 2: Update state and automatically re-plan

1. Mid-conversation, the user reports a change ("I transferred 60k Chase to Hyatt yesterday").
2. The wallet agent records the change as a typed mutation to the personal graph.
3. Dependency tracking marks every plan step that relied on the old value as stale.
4. The redemption agent re-plans automatically — no re-query, and no agent prompting another in prose.
5. **Outcome:** a structural update to the existing plan, not a fresh, unrelated answer.

### Flow 3: Run the architecture benchmark

1. The same query set runs against three architectures: the typed-graph system and the two baselines.
2. The model, tools, domain data, and persona are held constant so that only the coordination mechanism differs.
3. Each run is scored on the agreed metrics and compiled into a head-to-head comparison, reported honestly.
4. **Outcome:** evidence of whether typed-graph coordination outperforms the baselines on this task.

---

## Features (capability map)

### Wallet and personal state

- Manual entry of cards, balances, loyalty status, and goals.
- A fixed demo persona (five cards, roughly 240k points across three programs).

### Rewards planning

- Natural-language planning queries returning multi-step plans with per-step reasoning and a net value comparison.
- Redemption reasoning across transfer routes (transfer versus portal, fees, status, timing).

### Typed-graph coordination and adaptation

- Agents coordinate only through a shared typed graph — no free-text messages between agents.
- Structural invalidation: a state change marks dependent plan steps stale and triggers re-planning.
- Observable coordination: graph mutations stream live as the plan forms.

### Evaluation and demonstration

- One benchmark run identically across the three architectures.
- Metrics: accuracy, hallucination rate, cost per query, and plan-invalidation correctness.
- A live head-to-head demonstration contrasting the architectures.

### Domain learning (stretch — not part of the MVP)

- Learn a new world-graph fact from an unstructured update, under verification. Cut-by-default; the core demo does not depend on it.

---

## Scope

### In scope (MVP / current phase)

- Layers 1–3: the typed knowledge graph (world, personal, plan), the specialist agents, and dependency tracking with graph-typed tools.
- A demo interface that presents the plan and streams graph mutations live.
- A fixed demo persona and a locked seed slice: five cards, three programs, 240k points, and transfer routes for the Tokyo hero flow.
- One real external tool (cash-price lookup); award availability is fixture-based.
- The research benchmark: the three architectures, the shared query set, and the scored metrics.

### Out of scope (explicitly not now)

- Linked accounts: transaction ingestion and real-time balance sync.
- Live award search across a full airline or hotel alliance.
- A mobile application.
- Full transitive dependency propagation (the MVP tracks plan-step dependencies on personal state only).

### Stretch / later

- Layer 4 — domain learning under verification: an ingestion step proposes graph changes that a verifier accepts or rejects. Cut-by-default, with a mid-sprint go/no-go; the core demo runs without it.

---

## Success criteria

What the team must demonstrate by end of sprint (not current completion state):

- [ ] The user can manually establish the fixed rewards portfolio.
- [ ] The system produces a multi-step plan with reasoning for the persona's query.
- [ ] A relevant personal-state change invalidates the dependent plan steps.
- [ ] The system automatically produces an updated plan after that change.
- [ ] Typed graph mutations can be observed during the demo.
- [ ] All three architectures run against the same benchmark dataset.
- [ ] Results are reported for accuracy, hallucination rate, cost, and plan-invalidation correctness.
- [ ] The live demo is completed within the allotted presentation time.

---

## Non-goals (anti-patterns to avoid)

- Not a production consumer financial application — it is a demo-grade proof of concept.
- Not a general-purpose multi-agent framework — shown on one domain, not packaged for reuse.
- Not a live account-aggregation product — the wallet is entered by hand.
- Not a comprehensive award-search engine — availability is illustrative.
- The core demo must not depend on Layer 4.

---

## Glossary

| Term                    | Meaning in this project                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| Typed graph mutation    | A schema-validated change to the shared graph; the only way agents communicate.            |
| World graph             | Shared reference data: cards, programs, and transfer routes.                               |
| Personal graph          | A user's balances, loyalty status, and goals.                                              |
| Plan graph              | The generated plan, as steps linked back to the state they relied on.                      |
| State dependency        | A recorded link from a plan step to the state it used.                                     |
| Structural invalidation | Marking plan steps stale when the state they relied on changes.                            |
| Baseline                | A comparison architecture (single-agent or free-text multi-agent) run on the same queries. |
