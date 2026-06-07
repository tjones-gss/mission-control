# Mission Control — Agent Guide

This monorepo is a live cockpit for people already running multiple Claude Code
(and Cursor/Codex) agents who want to see and steer them in one place. It unifies
two halves. Know which one you are touching.

The honest framing: the cockpit (the window) is the front door and works with zero
harness setup. The harness (the rails) is **opt-in** accident-prevention you adopt
per project when you feel the pain — not a prerequisite. The rails are best-effort
accident-prevention, **not** an adversary-proof security boundary; the real control
for destructive operations is OS-level sandboxing.

## The two halves

- **`apps/cockpit`** — the Oversight dashboard, "the window." A Node + React app
  (Express server + Vite/React client) that gives a live, multi-project mission
  view across running agents. It is the global runtime you look *at* and the front
  door. It manages its own `client/` and `server/` via `cd` scripts — do NOT
  restructure it into workspaces.

  The UI uses progressive disclosure. **Core** tabs (always visible): Agents,
  Tasks, **Runs**, **Fleet**, History. **Advanced** tabs (behind a persisted
  toggle): Workflows, Skills, Teams. Surface map a future agent should not
  relitigate:
  - **Runs** is the unified orchestration surface — Conductor (ADR runs) and
    Mission Control (the harness mission loop) are two *modes* under it, not two
    top-level tabs (`client/src/components/RunsTab/RunsTab.jsx`).
  - **Inspect** is the single folded panel for the four read-only `~/.claude`
    viewers (Config, Hooks, MCP, Memory), mounted in the session detail view
    (`client/src/components/InspectPanel/InspectPanel.jsx`). Each fold removes one
    coupling to an undocumented on-disk format — do not re-split them.
  - **Workflows are runnable** from the UI (`POST /api/workflows/:name/run` spawns
    a Claude session), not just exportable to a skill.
  - **Missions** graduate draft → ready → build: the roadmap compiler writes
    drafts, mark-ready flips a draft to ready via the harness CLI
    (`POST /api/harness/:projectKey/missions/:missionId/ready`), then execute
    builds it. The cockpit never edits `mission-index.yml` directly — the harness
    CLI owns that write.
  - **Fleet** is the meta-orchestrator: a goal explodes into N autonomous child
    sessions, each spawned with `--worktree` (own git branch) under harness rails,
    escalating on danger, then synthesized. **The cockpit owns `/api/fleet`**
    (`server/routes/fleet.js` → `server/fleet/fleet-runner.js`); the *children* run
    under the harness. Fleet builds NO new spawn/approval/persistence stack — it
    copies the canonical mission-execute spawn-with-early-ack pattern once per child
    and routes every human decision through the existing approval write paths (no
    auto-approve). Layer model: **Fleet (L2)** → per-child **session + harness (L1)**
    → **subagents / skills (L0)**. Each layer up adds a bounded supervisor that
    holds the goal the layer below can't quietly drop. Phase 3 is the cockpit-infra
    implementation. **Fleet policy surface (Phase 4, delivered):** per-run
    **budget** (`policy.budgetUsd`/`perChildUsd` — refuse-to-spawn projection +
    stop-the-line latch, run → `budget_exceeded`), adversarial **verify**
    (`policy.verify` — authorship-blind verifier child per worker, bounded
    loop-until-done via `minApprovals`/`maxRounds`, statuses `verifying`/`rejected`),
    **quarantine** (`child.quarantine` — best-effort read-only stance, NOT a sandbox),
    and save/replay **templates** (`/api/fleet/templates`, `POST /api/fleet
    { template }`). These patterns are implemented **natively in the Fleet runner**,
    not by embedding the Claude Code Workflow engine (which is part of the agent
    runtime, not an importable library for the Express server) — see
    `packages/harness/docs/adrs/ADR-003-fleet-meta-orchestrator.md` §Phase 4. (The
    monorepo ADR index lives at `docs/adr/`; see ADR-0006 for the canonical
    orchestration model.)
- **`packages/harness`** — the harness control plane, "the rails." Python. An
  opt-in, per-project guardrail layer that agents can run *inside*. Not an npm
  workspace.

## How they talk

The cockpit does **not** reparse harness YAML. It shells out to the harness CLI:

```
harness status --json
```

and renders the structured output. Treat `harness status --json` as the contract
boundary: if the dashboard needs new data, the harness emits it, the cockpit
consumes it. Never duplicate harness parsing logic in the cockpit.

## Shared schemas

- **`packages/contracts`** — the shared JSON schemas that define the shape of what
  the harness emits and the cockpit consumes. **Contracts first, always:** when you
  add or change a `--json` field, update the schema here *before* touching the
  harness emitter or the cockpit consumer. The contract boundary above
  (`harness status --json`) is meaningless if either side drifts from the schema.

## Layout

- `apps/cockpit` — Oversight dashboard (the window)
- `packages/harness` — harness control plane (the rails, Python)
- `packages/contracts` — shared JSON schemas
- `installers` — one-command setup

## Running it

From the repo root:

```
npm install      # installs cockpit + contracts workspaces
npm run up       # one command — launches the cockpit dashboard
```

`npm run up` is the canonical launch. It runs the cockpit's `dev` script, which
starts the server and client together.

## Conventions

- npm workspaces cover only the Node side (`apps/cockpit`, `packages/contracts`).
  `packages/harness` is Python — manage it with its own tooling, not npm.
- Root scripts are thin pass-throughs (`npm --prefix apps/cockpit ...`). Keep heavy
  logic in the subprojects, not in the root `package.json`.
