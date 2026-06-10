# Mission Control

A live cockpit for the coding agents you're already running. If you have several
Claude Code agents going at once and want to see and steer them from one place,
this is for you. (Oversight reads Claude Code's own `~/.claude` — the cross-vendor
reach lives in the opt-in *rails* adapters, not the viewer.)

Mission Control unifies two pieces: **Oversight** (the window — a live, multi-project
mission view) and the **adaptive agentic engineering harness** (the rails — opt-in
guardrails you adopt when you feel the pain, not a prerequisite for the window).

- `apps/cockpit` — the Oversight dashboard (global runtime, the front door)
- `packages/harness` — the harness control plane (per-project, opt-in rails)
- `packages/contracts` — shared JSON schemas between them
- `installers` — one-command setup

## What it is

The cockpit leads with a **Core** view and hides power surfaces behind an
**Advanced** toggle — progressive disclosure that matches the window-vs-rails
philosophy instead of presenting everything at once.

- **Core tabs:** **Agents** (the "Needs you" triage queue is the default view —
  attention-ranked with real risk badges and inline approve/steer; Board and
  Detail modes preserved), **Tasks**, **Runs**, **Fleet**, and **History**
  (which now has three modes: the activity feed, an **"Everything"
  full-text search** over every message any agent ever produced, and a
  **usage/cost stats** view — per-day trend, per-project totals, model mix).
- **Advanced tabs** (one click away, preference persisted): **Workflows**,
  **Skills**, **Teams**.
- **⌘K command palette** — search everything from anywhere: sessions by name,
  then full-text hits with highlighted snippets (memory files and AI session
  summaries included); Enter jumps straight into the session detail. Backed by
  a local SQLite read-cache of `~/.claude`
  ([ADR-0008](docs/adr/0008-sqlite-derived-read-cache.md)) — a pure derived
  cache you can delete at any time; it rebuilds itself.
- **AFK gate notifications (notify-only).** Set `OVERSIGHT_WEBHOOK_URL` and the
  cockpit POSTs a compact payload (session, tool, risk classification, link)
  whenever an agent hits a tool-approval or danger-zone gate — point it at
  your Telegram/Slack bridge and get pinged when a fleet needs you. Outbound
  only: approving still happens in the cockpit, through the audited routes.
- **Runs** is the unified orchestration surface. Conductor (ADR-driven single runs)
  and Mission Control (the harness mission loop) used to be two top-level tabs; they
  are now two modes under one "Runs" concept.
- **Inspect** folds the four read-only `~/.claude` viewers (Config, Hooks, MCP,
  Memory) into a single panel in the session detail view, cutting both UI weight and
  the number of independent couplings to undocumented on-disk formats. Timeline stays
  paired with Conversation since it's the one you reach for live.
- **Workflows are runnable from the UI.** A workflow (an ordered list of
  skill/agent/instruction/command steps) can be authored *and* launched as a Claude
  session directly from the Workflows panel — not just exported to a skill.
- **Fleet is the higher-level orchestrator.** It turns a single goal into N
  autonomous child sessions, each spawned in its own git worktree/branch (`--worktree`)
  and running under the harness rails. Children run unattended and only *escalate*
  on a danger-zone or tool-approval prompt — Fleet never auto-approves; the human
  decision is routed through the existing approval write paths. When every child
  settles, a synthesis pass merges the per-branch results into one report. Fleet
  also supports a **policy surface**: a **token/dollar budget** that refuses to spawn
  children past a cap and stops the run when the running cost crosses it;
  **adversarial verification** (a fresh, authorship-blind reviewer child checks each
  worker's diff against the goal, with bounded re-dispatch on reject); **quarantine**
  (a best-effort read-only stance for a child); and **save/replay templates** for
  repeatable fleet configs. Because Fleet spawns *several* autonomous agents at once,
  the honest framing below matters more than ever: the rails — and quarantine — are
  best-effort accident-prevention, **not** a sandbox. The real control is OS-level
  sandboxing, and Fleet enforces hard ceilings on how many children it will ever spawn.
- **Missions graduate draft → ready → build.** The roadmap compiler slices a
  plain-language roadmap into bounded, sequenced mission *drafts*; you mark a draft
  **ready** from the UI (the harness CLI owns the `mission-index.yml` write), then
  execute (build) it as an on-rails implementer session.

## Who this is for

People already running multiple Claude Code agents who want to see and steer them
in one place. It assumes you've felt the friction of juggling
several agent sessions and want a single live view — it does not promise to turn a
first-time user into a power user.

## What this is / isn't

- **Is**: a live cockpit for your agents plus accident-prevention. The window
  works with zero harness setup; the rails are progressive disclosure you opt into.
- **The danger-zone rails are best-effort accident-prevention, not an
  adversary-proof security boundary.** They catch common mistakes (a stray
  `rm -rf`, a forgotten mission scope) at the tool-call boundary. They are not
  designed to stop a determined or adversarial agent, and you should not treat
  them as a sandbox.
- **The real control for destructive operations is OS-level sandboxing** —
  containers, VMs, restricted users, scoped credentials. The harness hooks
  complement that; they do not replace it.
- **In-cockpit approvals are risk-typed, never auto-approved.** Tool approvals
  and harness danger-zone escalations surface in the UI with a real risk
  classification (`DESTRUCTIVE` / `CODE_EXECUTION` / `REQUIRES_REVIEW` — never
  fabricated; null when unclassified), and every decision is written to the
  append-only audit log with its control state (which gates and policies were
  in force, who decided). The AFK webhook is deliberately notify-only — there
  is no remote-approve path.

## Quick start

From the repo root:

```
npm run setup     # or: node installers/setup.mjs
npm run up
```

`npm run setup` is the one-command installer. It checks prerequisites (Node
**22.13+** and npm are the only hard requirement — the cockpit server uses the
built-in `node:sqlite` for its read-cache, declared in its `engines` field),
installs the root workspaces, and then installs the cockpit's `server/` and
`client/` (which have their own `package.json` and are not workspaces). It does
not launch anything by default — it prints the next steps. It is safe to re-run.

Then `npm run up` launches the cockpit dashboard (the Oversight window) and you
open it at http://localhost:5173. The window is the front door: it works on its
own, with no harness setup.

Installer flags (all cross-platform — `setup.ps1` / `setup.sh` are thin wrappers
around `setup.mjs`):

- `node installers/setup.mjs --launch` — install, then run `npm run up` for you.
- `node installers/setup.mjs --check` — preflight only (no install, no launch);
  exits nonzero if the cockpit prerequisites are missing. Good for CI. Also
  available as `npm run setup:check`.

Python and (on Windows) Git Bash are only needed for the opt-in rails, not the
cockpit. The installer warns about them but never blocks the cockpit on them.

### Add the rails to a project (optional)

The harness rails are opt-in and per-project — adopt them when you feel the pain,
not before. They need Python (3.10+ recommended) and, on Windows, Git Bash to run
the `.sh` hooks. To wire them into a project:

```
node installers/add-rails.mjs --project <path-to-your-project>
```

This reuses the harness's own adapter installer
(`packages/harness/tools/install-claude-adapter.py`), which copies `.claude/` +
`CLAUDE.md`, makes the hooks executable, and on Windows wires `settings.json` to
Git Bash (WSL-safe). The equivalent manual command, run **from the repo root**, is:

```
python packages/harness/tools/install-claude-adapter.py --root <path-to-your-project>
```

Run `node installers/add-rails.mjs --project <path> --print` to print the exact
command with absolute paths (so it works from any directory). After wiring, restart
Claude Code in that project and run `/hooks` to verify. The rails are best-effort
accident-prevention, not an adversary-proof boundary — pair them with OS-level
sandboxing.

## Layout

- **`apps/cockpit`** — the Oversight dashboard, "the window." A Node + React app
  that gives you a live, multi-project mission view across your running agents.
  Manages its own `client/` and `server/`. This is the front door and needs no
  harness setup.
- **`packages/harness`** — the harness control plane, "the rails." Python.
  An opt-in, per-project guardrail layer agents can run inside. The cockpit shells
  out to `harness status --json` rather than reparsing its YAML, so the window can
  read the rails without being coupled to them.
- **`packages/contracts`** — shared JSON schemas defining the data the harness
  emits and the cockpit consumes.
- **`installers`** — one-command setup.
- **`docs/adr`** — accepted program ADRs that fix the direction:
  [0004 deployment topology](docs/adr/0004-deployment-topology.md)
  (localhost-first, architect-for-team), [0005 moat & surface
  strategy](docs/adr/0005-moat-and-surface-strategy.md),
  [0006 canonical orchestration model](docs/adr/0006-canonical-orchestration-model.md)
  (the harness pipeline is the spine; Fleet is a phase *strategy*; a Workflow is
  a degenerate single-phase pipeline), [0007 core vs experimental
  scope](docs/adr/0007-core-vs-experimental-scope.md), and
  [0008 SQLite derived read-cache](docs/adr/0008-sqlite-derived-read-cache.md)
  (`cockpit.db` is a pure derived cache of `~/.claude` — the substrate for
  search, analytics, and knowledge; deleting it is always safe).
- **[`SCOPE.md`](SCOPE.md)** — the CORE vs EXPERIMENTAL surface split and the
  "no new tab without retiring an overlap" freeze rule.
- **[`DOD-LADDER.md`](DOD-LADDER.md)** — the definition-of-done ladder (L0 honest →
  L1 trustworthy → L2 adoptable → L3 standard) with testable exit criteria.
- **`docs/governance`** — whole-tool reviews: an [engineering council
  review](docs/governance/council-review.md) and a [feature-by-feature UI/UX
  sweep](docs/governance/feature-sweep.md) with keep/fold/cut verdicts.
