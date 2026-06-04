# Concepts vs. System — what to build, what already exists, what to trim

Companion to `council-review.md` and `feature-sweep.md`. This doc compares two
external concept sources against what Mission Control already is, and turns the
result into a concrete, sequenced build plan.

Sources compared:
- **`top1_agentic.md`** — an "Agentic Dev Operating System": planner/implementer/
  reviewer/tester/security/documenter subagents, a `feature-loop` skill, `PostToolUse`
  hooks, and `CLAUDE.md` / `PROJECT_STATE.md` / `TASK_QUEUE.md` / `LESSONS.md` memory.
- **`dynamic-workflows-recommended-concepts.md`** — the high-value patterns from a
  "Dynamic Workflows in Claude Code" thread: fan-out/synthesize, adversarial
  verification, token budgets, tournament, loop-until-done, quarantine.

Evidence discipline: claims grounded in files are stated plainly with paths;
walkthrough-level judgments are marked **[I]** (inference).

---

## TL;DR

1. **`top1_agentic.md` is already built — and surpassed — by `packages/harness`.**
   Every element it proposes exists in the harness today, usually in a stronger
   form. There is **nothing to build** from that doc; it validates the existing
   design. Details in §1.
2. **`dynamic-workflows` is a real gap.** The cockpit's "Workflows" tab is only a
   *linear* step-list (skill/agent/instruction/command) exported as a skill —
   `apps/cockpit/server/routes/workflows.js`. None of the multi-agent power
   patterns (fan-out, adversarial verify, token budgets, tournament,
   loop-until-done) exist as runnable machinery. This gap is exactly what the
   **Fleet** layer (plan Phases 3–4) fills. Details in §2.
3. **The trim is real but bounded.** The overwhelm is mostly *surface count*, not
   dead weight. Moderate trim now (Core/Advanced split + dead-code removal),
   full governance sweep approached incrementally. Verdict table in §3.

---

## 1. `top1_agentic.md` → already covered by the harness

The doc proposes a file-and-agent scaffold. Mapped to what exists:

| `top1_agentic.md` proposes | Already in `packages/harness` | Evidence |
|---|---|---|
| `.claude/agents/planner.md` | `mission-planner` + `prd-writer` roles | `agents/roles/`, `agent-registry.yml` role_tiers |
| `.claude/agents/implementer.md` | `implementer` role (persistent across phases) | `agents/roles/implementer.md`; `sdk/python/harness_orchestrator/loop.py` |
| `.claude/agents/reviewer.md` | `reviewer` role (read-only) | `agents/roles/reviewer.md` |
| `tester.md` / `security.md` / `documenter.md` | `tester`, `security-reviewer`, `session-memory` roles | `agents/roles/` |
| `feature-loop/SKILL.md` | `feature-development.yml` + `next-mission-loop.yml` pipelines | `pipelines/` |
| `PostToolUse: npm test` hook | 4 enforcement hooks (danger-block, mission-scope, session-note, state-load) | `adapters/claude-code/.claude/hooks/`, `.claude/settings.json` |
| `CLAUDE.md` mission rules | `project-state.yml` + `context-manifest.yml` | `.harness/` |
| `PROJECT_STATE.md` | `project-state.yml` + `pipeline-state.yml` | `.harness/` |
| `TASK_QUEUE.md` | `mission-index.yml` (status, priority, selection_policy) | `.harness/` |
| `LESSONS.md` | `improvement-backlog.yml` + `anti-patterns.yml` + `harness-retrospective.yml` | `.harness/`, `pipelines/` |
| `Goal→Plan→Build→Test→Review→Fix→Document→Learn` loop | the same loop, plus **gates** between every step + **model-tier routing** (heavy/standard/light → Opus/Sonnet/Haiku) | `harness_core/gates.py`, `harness_core/model_tiers.py` |

**What the harness adds that the doc lacks:** mission *scope enforcement* (Allowed/
Forbidden files denied at the Edit/Write hook), a **danger-zone** block-list,
**human-approval contracts** with replay-proof `commandHash`, a **PRD planning
layer** gated before missions, and **quality gates** as explicit transition
preconditions. The doc is a good first-principles sketch; the harness is the
hardened implementation of the same idea.

**Action: none.** Cite this mapping when someone proposes "let's add planner/
implementer agents" — we have them.

---

## 2. `dynamic-workflows` → the genuine gap (→ Fleet, Phases 3–4)

The doc's patterns and where they stand today:

> **Native-patterns note (Phase 4, 2026-06-04).** The dynamic-workflow patterns
> below are **DELIVERED in Fleet (Phase 3+4)** — but implemented **natively in the
> Fleet runner** (`server/fleet/fleet-runner.js`), NOT by embedding the Claude Code
> Workflow engine. That engine is part of the agent runtime, not an importable
> library for the cockpit's Express server, so there is nothing for the Node server
> to `import`. The patterns (budget caps, adversarial verification with bounded
> loop-until-done, quarantine, saved templates) are valuable independent of where the
> engine lives and map cleanly onto the spawn / early-ack / persist / SSE primitives
> Fleet already reuses. The persisted state stays workflow-compatible so a later
> migration onto the runtime engine remains possible. Decision + rationale:
> **ADR-003 §Phase 4**.

| Pattern (doc) | Status in Mission Control | Where it lands |
|---|---|---|
| **Fan-out / synthesize** | **DELIVERED (Fleet Phase 3).** The goal→N-children→merge engine is cockpit machinery: `POST /api/fleet` explodes a goal into N autonomous `--worktree` children under harness rails, then a synthesis pass merges per-branch results (`server/fleet/fleet-runner.js`, `routes/fleet.js`, `FleetTab`). `DispatchDrawer` (client-side one-to-many to *existing* sessions) is the older, weaker form. | Fleet Phase 3 (cockpit infra) **— DONE** |
| **Adversarial verification** | **DELIVERED (Fleet Phase 4, native).** `policy.verify` spawns an authorship-blind VERIFIER child per succeeded worker, fresh context, checking the worker's git diff against the goal + rubric; `parseVerdict` fails closed to reject. Implemented natively in the runner (no embedded engine). | Fleet Phase 4 — **DONE** |
| **Token budgets** | **DELIVERED (Fleet Phase 4, native).** `policy.budgetUsd` (+ optional `perChildUsd`) bounds a run by dollars: refuse-to-spawn pre-spawn projection, a stop-the-line latch, and a `budget_exceeded` run status. Cost is still *observed* per child, but now also *bounded*. | Fleet Phase 4 — **DONE** |
| **Tournament (pairwise)** | Missing (not in Phase 4 scope). | Future Fleet option (sorting/taste tasks) |
| **Loop-until-done** | **DELIVERED (Fleet Phase 4, native), bounded.** A rejected worker is re-dispatched up to `policy.verify.maxRounds` with the prior reviewer's reasons prepended — bounded loop-until-done. (The harness `next-mission-loop` remains the mission-level iterator.) | Fleet Phase 4 — **DONE** |
| **Quarantine** (untrusted readers can't act) | **DELIVERED (Fleet Phase 4, native) — best-effort.** `child.quarantine` gives a read-only / no-privileged-action stance via a prompt directive + the harness danger-zone hooks where present, and bars the child from being the synthesis/acting child. **Honest caveat:** advisory accident-prevention, NOT a sandbox (see §4). | Fleet Phase 4 — **DONE** |
| **Save working workflows** | **DELIVERED.** **[Phase 2]** cockpit workflows are *executable* from the UI (`POST /api/workflows/:name/run`) and export to `~/.claude/skills`; **[Fleet Phase 4]** a fleet config (`goal`/`children`/`policy`) is saveable + replayable as a named template (`/api/fleet/templates`, `POST /api/fleet { template }`). | ~~Phase 2 (executable workflows)~~ + Fleet Phase 4 (templates) **— DONE** |

**Why this is the headline work.** The user's "higher-level agent above the
current layer" *is* fan-out/synthesize made durable: a goal explodes into N
isolated git-worktree sessions, each running a workflow under harness rails,
autonomous, escalating only on danger, then a synthesize barrier merges results.
The three failure modes the doc names map directly onto why this layer matters:
- **Agentic laziness** → each child owns one bounded piece, so "20 of 50" can't hide.
- **Self-preferential bias** → the adversarial, authorship-blind verifier child (Phase 4, delivered) judges child output in a fresh context.
- **Goal drift** → the Fleet supervisor holds the original goal; children can't quietly drop it.

The mapping from doc → plan phases is 1:1 with plan §Phase 3 and §Phase 4 — both
now delivered (the patterns natively in the Fleet runner; see the native-patterns
note above and ADR-003 §Phase 4).

---

## 3. Trim verdict — KEEP / FOLD / DEAD (with justification)

The overwhelm is **surface count and overlapping mental models**, not rot. Almost
everything has a real purpose; the fix is *disclosure*, not *deletion*. Verdicts
reconcile `feature-sweep.md` with the agreed Moderate-now appetite.

| Surface | Purpose (why it earns its place) | Verdict | When |
|---|---|---|---|
| Agents (list/board/conversation/approval) | The core loop: see → read → steer agents | **KEEP** | — |
| Tasks (TaskBoard) | Per-session work tracking | **KEEP** | — |
| Mission Control (`HarnessDetail`) | The rails↔window contract surface (`harness status --json`) | **KEEP** | — |
| History | Command analytics | **KEEP (core)** | — |
| Workflows | Authoring surface for repeatable playbooks — *now executable* (`POST /api/workflows/:name/run`) | **KEEP → upgrade — [DONE Phase 2]** | ~~Phase 2~~ |
| Skills | The skill *library* (browse/run) | **KEEP** — make it the library, not a 2nd author surface | Phase 1 |
| Teams | Multi-agent inbox coordination | **KEEP (advanced)** | gate Phase 1 |
| Conductor | ADR-driven single-run orchestration | **FOLD → Runs** (with Mission Control) **— [DONE Phase 2]** (the Conductor mode of `RunsTab`) | ~~Phase 2~~ |
| Config / Hooks / MCP / Memory inspectors | Read-only `~/.claude` views — 4 independent format couplings, and their live-refetch props are half-threaded (see below) | **FOLD → one "Inspect"** **— [DONE Phase 2]** (`InspectPanel`) | ~~Phase 2~~ |
| `OVERSIGHT_API_KEY` | **Live** optional API-key auth (mounted `index.js:41`; used in `apiKeyAuth` + CSRF guard `security.js:140,252`; documented; tested) | **KEEP** | — |
| Inspector watcher SSE events (`config_/memory_/plan_/hooks_update`) | Handlers exist in `App.jsx`, but the version props were **not threaded** through `AgentTree.jsx` to the inspector components, so refetch was inert; `hooksVersion` had no state at all | **FIX via the Phase 2 fold** (single live version on the merged Inspect panel) **— [DONE Phase 2]** (`InspectPanel` threads one live version per section) | ~~Phase 2~~ |
| `workflows_/skills_update` events | Wired correctly (direct `refetch*()`) | **KEEP** | — |
| Stale skill-cache invalidation | 30s TTL not tied to watcher | **FIX or document** | Phase 1/2 |
| IntelView | Paid transcript-egress path; useful but a quarantine concern | **KEEP (advanced) + flag** | Phase 1 gate; §4 |

> **Audit correction (2026-06-04).** An earlier draft of this table and
> `feature-sweep.md` §E marked `OVERSIGHT_API_KEY` "DEAD" and the SSE events
> "unconsumed." Verified against source, both were wrong: the API key is live
> security code, and the SSE handlers exist — the real defect is that the four
> *inspector* version props were not threaded to their components. That defect was
> fixed structurally by the Phase 2 inspector fold (now shipped in `main` as
> `InspectPanel`), not by deleting anything.

**Net:** there is essentially **no dead code to remove** — the codebase is healthier
than the prior docs claimed. The overwhelm fix is **disclosure** (Core/Advanced
split, Phase 1) and **folds** that cut mental-model overlap *and* `~/.claude`
coupling *and* the half-wired refetch in one move (Phase 2).

---

## 4. Carried-forward risks (watch during build)

From the source docs' "what to watch" sections, applied here:

- **Observability of multi-agent runs.** Debugging why a fleet child failed is hard
  — build the SSE progress bridge and structured per-child logging *before* running
  fleets unattended (plan Phase 3/4). [I]
- **Cost discipline.** Opus across many parallel children is expensive. Default
  children to Haiku/Sonnet for exploration; reserve Opus for synthesize/verify.
  Every fleet run *can* now take an explicit dollar cap (`policy.budgetUsd`, Phase 4 —
  delivered); it is opt-in, so a run with no budget is still count-cap-only. [I]
- **Quarantine.** Any fleet child (or `IntelView`) that reads untrusted input must
  not also hold high-privilege actions. Separate read from act. Fleet's
  `child.quarantine` (Phase 4 — delivered) gives that separation as **best-effort
  accident-prevention, NOT a sandbox**: it is an advisory prompt directive plus the
  harness danger-zone hooks where present, and it bars a quarantined child from being
  the synthesis/acting child. A determined or confused model can ignore the directive —
  the genuine control for an untrusted child is OS-level sandboxing (same framing the
  README uses for the rails generally). [I]
- **Don't over-index on workflows.** A five-minute task does not need a panel of
  five reviewers. Fleet is for genuinely parallel, enumerable, independent work —
  not the default path. [I]
- **No new silent `~/.claude` coupling** without a version/format guard (council
  condition; reinforced by every fold above).

---

## 5. Sequenced conclusion

- **Phase 1 (Trim, Moderate):** Core/Advanced tab split (the real overwhelm win);
  consolidate Skills/Workflows authoring. *No dead-code deletion — the prior "dead"
  list was inaccurate (see §3 correction).*
- **Phase 2 (Finish Mission Control) — DONE (2026-06-04, in `main`):** workflows
  *run* from the UI (`POST /api/workflows/:name/run`); the roadmap → draft → ready →
  build path is closed (mark-ready via `POST /api/harness/:projectKey/missions/:missionId/ready`,
  the harness CLI owns the `mission-index.yml` write); Conductor + Mission Control
  folded into the **Runs** surface (`RunsTab`); the 4 inspectors folded into one
  **Inspect** panel (`InspectPanel`), which also fixed the half-threaded inspector
  refetch.
- **Phase 3 (Fleet on cockpit infra) — DONE (2026-06-04, in `main`):**
  fan-out/synthesize made durable as cockpit machinery — `POST /api/fleet` explodes a
  goal into N autonomous `--worktree` children under harness rails, escalate-on-danger
  (read-only; allow/deny via the existing approval write paths, no auto-approve), then
  a synthesis pass merges per-branch results. Owned by `server/fleet/fleet-runner.js` +
  `routes/fleet.js` + `FleetTab`, with hard child-count ceilings and the `fleet_update`
  SSE event.
- **Phase 4 (Fleet dynamic-workflow patterns, native) — DONE (2026-06-04, in
  `main`):** adversarial verification (authorship-blind verifier child per worker,
  fail-closed verdict), token/dollar **budgets** (refuse-to-spawn projection +
  stop-the-line latch, `budget_exceeded` status), **bounded loop-until-done**
  (re-dispatch a rejected worker up to `maxRounds`), **quarantine** (best-effort
  read-only stance, not a sandbox), and save/replay **templates**. Implemented
  **natively in the Fleet runner**, not by embedding the Claude Code Workflow engine
  (which is part of the agent runtime, not an importable Express library) — the
  honest, achievable approach, recorded in **ADR-003 §Phase 4**.

`top1_agentic.md` requires no build. `dynamic-workflows` was the blueprint for
Phases 3–4, both now delivered.
