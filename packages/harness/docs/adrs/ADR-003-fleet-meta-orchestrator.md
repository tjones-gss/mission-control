# ADR-003: Fleet Meta-Orchestrator (Layer 2 fan-out)

Status: Accepted (Phase 3 + Phase 4 delivered in `main`, 2026-06-04)
Date: 2026-06-04
Owner: cockpit / harness

## Context

The cockpit already drives single autonomous runs: a mission `execute` spawns one
governed Claude implementer in a project cwd, early-acks on the file-watcher, and
guards against double-spawn with an in-memory acquire/release set
(`apps/cockpit/server/routes/harness.js`). Sessions can spawn into their own git
worktree via a `--worktree` CLI flag (`apps/cockpit/server/routes/sessions.js`).
The harness rails block dangerous operations at the `PreToolUse` hook and record a
human-approval contract under `.harness/approvals/pending/<id>.json` →
`.harness/approvals/decided/<id>.json` (the `harness` CLI is the single writer of
the decided file; cockpit reads pending, the decision is keyed by `commandHash`).

What is missing is **Layer 2**: a single goal that fans out to N autonomous child
Claude sessions, each in its OWN git worktree, each running its own prompt or
workflow under the rails, autonomous but escalating to the human on danger, then a
synthesize step that merges the children's results. This is the power-user
headline capability and must be built on the existing infra rather than a new
spawn/approval/persistence stack.

## Decision

Add a Fleet meta-orchestrator as a thin cockpit layer that **reuses** the existing
spawn, early-ack, concurrency-guard, worktree, SSE, atomic-write, and approval
primitives.

- **Server module** `apps/cockpit/server/fleet/fleet-runner.js` owns fleet
  lifecycle: validate policy, spawn each child via `runClaudeCancellable` WITH
  `--worktree`, early-ack each child with `awaitNewSession`, persist run state via
  `atomicWriteJson` to `apps/cockpit/server/data/fleet/<id>.json`, emit a new
  `fleet_update` SSE event on every state transition, and run a final synthesize
  child once all children settle.
- **Route module** `apps/cockpit/server/routes/fleet.js` (mounted at `/api/fleet`
  in `server/index.js`) exposes start/list/detail, an escalations list, and a
  single decision endpoint:
  - `GET /api/fleet/:id/escalations` surfaces both escalation sources —
    `source:'tool'` (live SDK tool-approval requests for the child's session) and
    `source:'harness'` (the rails' `.harness/approvals/pending/<requestId>.json`).
    It also reconciles the per-child `running↔escalated` status as a side effect so
    the badge survives a reload.
  - `POST /api/fleet/:id/decide` routes ONE human Allow/Deny through the EXISTING
    write paths — it is a **dispatcher, not a new approval store**:
    - `source:'tool'` → the in-memory SDK `resolveApproval` (the same function
      `POST /api/sessions/:id/tool-approval` uses), keyed by `approvalId`.
    - `source:'harness'` → shell **`harness approve <requestId> --allow|--deny`**
      in the child's whitelisted cwd. The harness CLI is the SINGLE WRITER of
      `.harness/approvals/decided/<requestId>.json`; it copies the pending
      request's `commandHash` onto the decision (matching the
      `approval-decision.schema.json` contract: `id`, `schemaVersion`, `decision`,
      `approver`, `commandHash`, `decidedAt`) so a stale or replayed decision can
      never unblock a different command. The cockpit NEVER writes the decided file
      directly.

  Fleet builds NO new approval mechanism and has no auto-approve branch — both UI
  buttons resolve through this one endpoint.
- **Child cwd whitelist + git-repo precondition**: every child cwd must pass
  `isKnownHarnessRoot`-style validation AND be a real git repo before a
  `--worktree` spawn. A hard concurrency cap (default 4) bounds fan-out and refuses
  absurd N.
- **UI** is a new Core tab `FleetTab` (the power-user headline surface), reusing
  LiveFeed/SSE and the DispatchDrawer launch UX.

## Options Considered

### Option A — Thin cockpit layer reusing harness.js execute pattern (CHOSEN)

Pros:
- Reuses `runClaudeCancellable` + `awaitNewSession` + acquire/release exactly as
  the canonical mission `execute` handler does; no new spawn semantics.
- Children get worktree isolation for free via the existing `--worktree` flag.
- Escalation surfaces the EXISTING approval contracts; no parallel approval store.
- Persistence is a single JSON per run via `atomicWriteJson`, matching tasks/
  workflows/ persistence.

Cons:
- Orchestration state lives in cockpit memory + one JSON file; a server restart
  mid-run orphans live child processes (mitigated: persist child sessionIds so the
  run can be reconciled/observed via the watcher after restart).

### Option B — Drive Fleet from the Python harness control plane

Pros:
- Co-located with the rails and the approval CLI.

Cons:
- Duplicates the cockpit's spawn/early-ack/worktree/SSE machinery in Python.
- Violates the contract boundary: the cockpit shells `harness status --json`; it
  does not delegate live agent spawning to Python. Rejected.

### Option C — Build on the Workflow engine now

Pros:
- Workflows already model fan-out/fan-in.

Cons:
- Couples the first Fleet release to a larger refactor. Deferred to Phase 4 — the
  state shape here is intentionally workflow-compatible so Fleet can migrate onto
  the Workflow engine later without changing the API or UI.

## Consequences

Positive:
- One goal → N isolated, governed, autonomous children + a synthesis, on existing
  rails.
- Worktree isolation means children never clobber each other's working tree.
- Danger always escalates to the human; nothing auto-approves.

Negative:
- N concurrent claude processes multiply cost and machine load — bounded by the
  hard cap and surfaced per-child in the UI.
- Server restart mid-run leaves children running detached (observable, not
  resumable in v1).

Neutral:
- Adds one SSE event type (`fleet_update`) and one data dir
  (`server/data/fleet/`).

## Evidence

Facts:
- `runClaudeCancellable({ args, cwd, timeoutMs })` returns `{ promise, cancel }`
  and kills the child on cancel (`apps/cockpit/server/claude-cli.js`).
- `awaitNewSession(cwd, { timeoutMs })` resolves with the new sessionId when the
  watcher sees a fresh JSONL (`apps/cockpit/server/lib/pending-session.js`).
- The mission `execute` handler is the canonical spawn-with-early-ack +
  acquire/release pattern (`apps/cockpit/server/routes/harness.js`).
- `POST /api/sessions/new` pushes `--worktree` when `worktree === true`
  (`apps/cockpit/server/routes/sessions.js` ~line 514).
- `atomicWriteJson` persists user data (`apps/cockpit/server/lib/atomic-write.js`).
- The approval contract is `.harness/approvals/pending/<id>.json` →
  `decided/<id>.json`, keyed by `commandHash`, harness CLI is the single writer
  of decided (`packages/harness/tools/harness`). The decided-file write is the
  `harness approve <id> --allow|--deny [--approver <name>]` subcommand
  (`cmd_approve`): it reads the pending request, copies its `commandHash`, writes
  the decided file atomically conforming to `approval-decision.schema.json`, and
  errors non-zero if the pending is missing or already decided. It is discoverable
  via `harness --help` / `harness approve --help`.
- `useSSE.js` has an allowed-event list new event types must be added to.

Inferences:
- Because children run with the harness rails, a dangerous op in any child pauses
  THAT child and writes a pending approval; Fleet only needs to read pending and
  route the human's decision through the existing write path — `resolveApproval`
  for a live tool prompt, `harness approve` for a filesystem danger-zone pending.
  No new approval persistence is added on the Fleet side.

Assumptions:
- A child's worktree/branch name can be derived from the fleet id + child idx for
  display; the exact branch the CLI creates is read back from the child session
  once known.

## Phase 4 — Dynamic-workflow patterns, native (Addendum 2026-06-04)

Status: Accepted — delivered in `main` (extends the Decision above; supersedes
Option C "build on the Workflow engine now").

### Decision

The Claude Code **Workflow engine is part of the agent runtime, not an importable
library for the cockpit's Express server.** There is no package the Node server can
`import` to get fan-out/fan-in, verification loops, and budget caps. Therefore
Phase 4 implements the dynamic-workflow PATTERNS natively in `fleet-runner.js`
orchestration logic rather than embedding an external engine. This is the honest,
achievable approach: the patterns (budget caps, adversarial verification with
bounded loop-until-done, quarantine, saved templates) are valuable independent of
where the engine lives, and they map cleanly onto the existing spawn / early-ack /
persist / SSE primitives Fleet already reuses. The seam is the same one Phase 3
established — `spawnChild` (one governed `runClaudeCancellable --worktree` per
child) and `persistFleet` (atomic write + `fleet_update`). Phase 4 adds new KINDS
of children (verifier, and synthesis already exists) and new run-level policy/state;
it introduces no new spawn, approval, or persistence stack.

The state shape stays workflow-compatible (`additionalProperties:true`, free-string
statuses) so a future migration onto the runtime Workflow engine remains possible
without breaking persisted runs or the API/UI — but that migration is explicitly
NOT this phase.

### What Phase 4 adds

- **Budgets** (`policy.budgetUsd`, optional `policy.perChildUsd`). The runner sums
  `child.cost.totalCost` across workers + verifiers + synthesis into `run.spentUsd`.
  Enforcement: refuse to spawn a new child when projected total would exceed the
  cap; if a running total crosses the cap, stop spawning further children/verifiers
  and set `run.status = 'budget_exceeded'` (new run status). Remaining budget is
  surfaced in `--json` and the UI. This follows the dynamic-workflows "always set a
  cap" rule — an unbounded fan-out of autonomous agents is the headline cost risk.

- **Verification** (`policy.verify`: bool or `{ minApprovals, maxRounds }`). After a
  worker settles `succeeded`, the runner spawns a VERIFIER child in the SAME cwd
  with fresh context, prompted to adversarially check the worker's git diff/output
  against the goal + a rubric. The verifier never learns who produced the work and
  returns a structured verdict (`{ verdict: 'approve'|'reject', reasons, rubric }`).
  On reject the worker flips to `rejected` and is OPTIONALLY re-dispatched up to
  `maxRounds` (bounded loop-until-done). Verifiers count toward the budget, emit
  `fleet_update`, and their verdicts persist on the child. New child statuses:
  `verifying`, `rejected`.

- **Quarantine** (`child.quarantine: true`). A quarantined child gets a read-only /
  no-privileged-action posture via (a) an explicit prompt directive and (b) where
  the child's project has harness rails, the existing danger-zone hooks. This is
  **best-effort accident-prevention, not a sandbox** (matching the README framing:
  "the rails are best-effort accident-prevention, not an adversary-proof boundary —
  pair them with OS-level controls"). A quarantined child may not be the
  synthesis/acting child.

- **Templates**. A run's config (`goal`, `children`, `policy`) is saveable as a named
  template under `apps/cockpit/server/data/fleet-templates/<name>.json` via
  `atomicWriteJson`, listable, and instantiable (`POST /api/fleet { template: name }`).
  This follows the dynamic-workflows "save working workflows" rule.

### Why not a new ADR-004

Phase 4 does not reverse any Phase 3 decision; it fills in the "deferred to Phase 4"
note already written into Option C, and it reuses the exact same seams. Recording it
as an addendum keeps the Fleet decision in one place. A separate ADR-004 would only
be warranted if Phase 4 changed the spawn/approval/persistence stack — it does not.

### Consequences (Phase 4)

Positive: cost is now bounded by an explicit dollar cap, not just a child-count cap;
"loop until a fresh adversarial reviewer approves" raises output quality; templates
make good fleet configs repeatable.

Negative: verifiers roughly double spawn count for verified runs (mitigated: they
count toward the same budget cap and `maxRounds` bounds the loop); a budget race
between concurrent settle handlers must be serialized (mitigated: single-writer
in-process check-then-spawn, same model as the existing `pendingCounts` decrement).

## Related Specs

- docs/specs/SPEC-001-control-plane-lifecycle.md
- packages/contracts/schemas (fleet-run schema added FIRST, then both sides)
