# Understanding: Mission Control unification

_Goal: you can rebuild and defend this design unaided. Updated live by the tutor._
_Status: `[ ]` not addressed · `[~]` taught, awaiting your demonstration · `[x]` mastered_

## Layer 1 — The problem
- [ ] What the problem actually was (two separate tools: Oversight + the harness)
- [ ] Why it existed — how the two halves grew up and what friction that caused
- [ ] Why it mattered — what juggling separate agent tools cost you
- [ ] The branches — keep separate / tightly couple / cockpit reparses harness state / unify-but-decouple, and why the last one won

## Layer 2 — The solution
- [ ] The monorepo shape — `apps/cockpit` (window), `packages/harness` (rails), `packages/contracts`, `installers`, and what each is
- [ ] The contract boundary — why the cockpit shells out to `harness status --json` instead of reading harness YAML
- [ ] "Window vs rails" / progressive disclosure — why the window works with zero harness setup and the rails are opt-in
- [ ] The workspace decision — why npm workspaces cover only the Node side and the Python harness is excluded
- [ ] Key edge cases in discovery — path-whitelist before shell-out, async spawn with timeout-kill, caching
- [ ] Why the schemas are deliberately permissive (`additionalProperties: true`, few required)
- [ ] The Core/Advanced disclosure split — Core (Agents, Tasks, Runs, History) always on; Advanced (Workflows, Skills, Teams) one toggle away, so the UI practices the window-vs-rails philosophy
- [ ] The **Runs** unification — Conductor (ADR runs) + Mission Control (harness mission loop) collapsed from two top-level tabs into two modes under one "Runs" surface
- [ ] The **Inspect** fold — Config/Hooks/MCP/Memory merged into one panel; why this cuts `~/.claude`-format couplings (not just UI weight) and fixes the half-threaded live-refetch in one move
- [ ] Executable workflows + draft→ready→build — workflows now *run* from the UI (`POST /api/workflows/:name/run`); missions graduate via mark-ready (`.../missions/:id/ready`), with the harness CLI as the sole writer of `mission-index.yml`

## Layer 3 — The broader context
- [ ] Why this unification matters as a *product*, not just a refactor
- [ ] The security/trust story — why the rails are "best-effort accident-prevention, not a boundary," and why browser approval is deliberately NOT shipped yet
- [ ] What breaks if the design is wrong (coupling the cockpit to harness internals; overselling the rails as a sandbox)
- [ ] **The Fleet meta-orchestrator (Phase 3) — why a layer *above* the agent.** A
  single goal explodes into N autonomous child sessions, each in its **own git
  worktree/branch** (`--worktree`) running under the harness rails, escalating only
  on danger, then merged by a synthesis pass. Be able to defend: (a) *why a
  meta-orchestrator at all* — it makes fan-out/synthesize **durable** and gives one
  supervisor that holds the original goal so children can't quietly drop it
  (counters agentic laziness, self-preferential bias, goal drift); (b) *why
  autonomous worktrees* — isolation means children can't clobber each other's (or
  your) tree, so they can run unattended; (c) *why escalate-on-danger, never
  auto-approve* — Fleet is read-only on decisions and routes allow/deny through the
  existing approval write paths; (d) *the layer model* — Fleet (L2) → per-child
  session + harness (L1) → subagents/skills (L0); (e) *why this sharpens the
  rails≠sandbox story* — spawning N autonomous agents at once raises the stakes, so
  Fleet hard-caps child count server-side and still leans on OS-level sandboxing as
  the real control. The cockpit owns `/api/fleet`; the children run under the harness.

## Capstone
- [ ] You give an unaided 2-minute recap: problem → solution → why it matters
