# Lane tracking (daily status)

Each person owns **one file** here. This is the daily source of truth for Yesterday / Today / Blocked — not feature PRs and not `STATUS.md`.

## Daily (each person)

1. Edit your file (`alan-graph.md`, `val-frontend.md`, `michael-redemption.md`, or `raq-orchestrator-lead.md`).
2. Update **Today / Next / Blockers**.
3. Open a **tiny PR** (this file only) and merge same day.
4. Update your **Linear** tickets (RCG-##) to match.

**Do not** put standup updates in feature PRs. **Do not** edit `STATUS.md` unless you are the lead syncing the board.

## Where things live

| Artifact                          | Who updates | Cadence                 | Purpose                                         |
| --------------------------------- | ----------- | ----------------------- | ----------------------------------------------- |
| **Linear** (RCG tickets)          | Each person | Daily                   | Live task board — Yesterday / Today / Blocked   |
| **`tracking/<lane>.md`**          | Each person | Daily                   | Repo copy of lane status; tiny PRs merge fast   |
| **`STATUS.md`**                   | Raq (lead)  | Before standup / gates  | Weekly snapshot — standup grid, gates, blockers |
| **`context/progress-tracker.md`** | Raq (lead)  | When a spec or PR lands | Milestone narrative for agents and integration  |

See [`AGENTS.md`](../AGENTS.md) § Team status & visibility.
