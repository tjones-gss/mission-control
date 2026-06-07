# Engineering Council Review — Mission Control

**Scope:** the tool as a whole — the cockpit (`apps/cockpit`, "the window") and the
harness (`packages/harness`, "the rails") — assessed for two audiences: an
**internal engineering team** and a **solo developer**.

**Date:** 2026-05-31  ·  **Status:** advisory (no binding changes mandated here)

> Evidence discipline (per the harness constitution): claims are tagged
> **[E]** evidence (verifiable in-repo), **[I]** inference, or **[A]** assumption.

---

## 1. What was reviewed

- **Cockpit** — Express server (~7,300 LOC, 14 routes, 15 parsers) + Vite/React
  client (~40 components across 8 tabs); `ConversationView` alone ≈ 920 lines.
  **[E]** Streams updates to the browser over SSE with 19 event types. **[E]**
- **Harness** — Python control plane: SessionStart context preload, `PreToolUse`
  dangerous-command denial and mission-scoped edit gating, quality-gates /
  danger-zone policy, model-tiers, a PRD planning layer, and an SDK orchestrator
  loop with Cursor and Claude drivers. **[E]**
- **Contracts** — shared JSON schemas; `harness status --json` is the declared
  contract boundary between the two halves. **[E]** (`CLAUDE.md`)

## 2. The council

Six roles. Each gives a verdict and the one thing they'd block on.

### Staff / Architect — *verdict: sound spine, sprawling skin*
The two-halves split is the strongest decision in the repo: the cockpit shells out
to `harness status --json` instead of reparsing YAML, so the rails can evolve
behind a contract. **[E]** The risk is not the architecture but the **skin**: the
cockpit has grown ~15 parsers, many reading **undocumented `~/.claude` on-disk
formats** (sessions, plans, hooks, MCP, memory). Each is an independent coupling to
a format Anthropic can change without notice. **[E/I]**
**Would block on:** any *new* feature that adds a *new* `~/.claude` coupling
without a fallback/version guard.

### Security — *verdict: honest, but the honesty is load-bearing*
The README is admirably explicit that the rails are **best-effort
accident-prevention, not an adversary-proof boundary**, and that OS-level
sandboxing is the real control. **[E]** That honesty is the security posture — so
it must never erode. Concrete gaps: an unused `OVERSIGHT_API_KEY` **[E]** (dead
auth surface — either wire it or delete it), and the cockpit reads and renders full
conversation transcripts, so anything that *exports* or *sends* them (the paid
Intel feature) is a transcript-egress path. **[E/I]**
**Would block on:** shipping browser-side destructive-command approval before the
hardened trust model exists — and the README already commits to *not* doing that. **[E]**

### SRE / Ops — *verdict: previously un-gated, now gating*
Before this review there was **no CI** **[E]** and the SDK tests mutated the live
repo working tree **[E]**. Both are now addressed (CI workflow + hermetic tests).
Remaining operational fragility: the cockpit degrades **silently** when an upstream
format shifts. The driver and the session parser now **warn loudly** on unexpected
shapes (this PR), which converts a silent-empty-dashboard into a diagnosable log
line. **[E]**
**Would block on:** any parser that can return empty on malformed input without a
warning.

### QA — *verdict: strong coverage, two stale counts (fixed)*
Test depth is genuinely good: 788 server + 460 client + 59 Python tests. **[E]**
Two client tests had **stale count assertions** (a 16th keyboard shortcut and a
19th SSE event the suite hadn't been told about) — fixed in this PR. **[E]** The
lesson: "exact count" assertions are tripwires that catch real drift; keep them,
but wire CI so they fail in PRs, not months later.
**Would block on:** nothing now that CI runs the full suite.

### EM / Product — *verdict: clear thesis, blurred surface*
The product thesis is sharp — "see and steer the agents you're already running" —
and the progressive-disclosure framing (window first, rails opt-in) is right. **[E]**
But the UI does not yet practice that philosophy: all 8 tabs and ~8 detail
inspectors are always-on, and two orchestration mental models (Conductor vs
Mission Control; Skills vs Workflows) overlap. **[I]** See `feature-sweep.md`.
**Would block on:** adding a 9th top-level surface before consolidating the
existing ones.

### DX / Solo developer — *verdict: high ceiling, heavy floor*
`npm run up` is a genuine one-command start **[E]**, and the rails being opt-in
means a solo dev gets value with zero harness setup. **[E]** But the cockpit's
server/client are **not** workspaces and install separately **[E]** — a paper cut
for first-run and for CI (the workflow handles all three installs explicitly). For
a solo dev, the 8-tab surface is more than the core loop (list → read → reply →
watch status) needs.
**Would block on:** nothing; recommends a "core view" default (see sweep).

## 3. Premortem — *"it's 6 months later and Mission Control burned someone"*

| # | Failure mode | Trigger | Blast radius | Mitigation | Status |
|---|--------------|---------|--------------|------------|--------|
| 1 | Cockpit shows an empty/wrong dashboard | Claude changes `~/.claude/*.jsonl` shape | Every session surface | Loud warn on zero-parse; driver warns on bad JSON envelope | **Done (this PR)** |
| 2 | Loop corrupts/dirties real repo state in tests | Non-hermetic tests run the loop against `ROOT` | Working tree, CI noise | Tests copy a throwaway harness root | **Done (this PR)** |
| 3 | Regression lands silently | No CI gate | Both halves | `.github/workflows/ci.yml` runs Python + Node | **Done (this PR)** |
| 4 | User treats rails as a sandbox | Misread of guarantees | Destructive op on real system | README is loud; OS sandbox is the real control | Standing (docs) |
| 5 | Maintenance/UX debt compounds | Feature sprawl, ~/.claude couplings | Velocity, fragility | Consolidate per `feature-sweep.md` | **Recommended** |
| 6 | Transcript egress | Paid Intel sends transcripts externally | Privacy/cost | Keep opt-in; surface cost before enabling | **Recommended** |
| 7 | Stale UI | Half-wired watcher events not refetched | Confusing live view | Wire or remove the dangling events | **Recommended** |

## 4. Verdict matrix

| Concern | Internal team | Solo dev |
|---|---|---|
| Core value (window) | ✅ Ship | ✅ Ship |
| Rails (opt-in) | ✅ Adopt per-project | ◐ Optional; adopt when pain appears |
| CI gating | ✅ Required (now present) | ◐ Nice-to-have (now present) |
| Hermetic tests | ✅ Required (now present) | ✅ Required (now present) |
| Format-drift resilience | ✅ Hardened (this PR) | ✅ Hardened (this PR) |
| Feature surface | ⚠ Consolidate (sweep) | ⚠ Prefer a core view (sweep) |
| Security posture | ✅ With OS sandbox | ✅ With OS sandbox |

## 5. Conditions (the four things to keep true)

1. **Never let the honesty erode** — the rails are accident-prevention; OS
   sandboxing is the real control. Keep that front-and-center.
2. **No new silent `~/.claude` coupling** — any new parser of an undocumented
   on-disk format must warn loudly on unexpected shape and degrade, not crash.
3. **CI stays green and required** — the gate added here is only useful if it
   blocks merges; wire branch protection to it.
4. **Consolidate before adding** — match the UI to the progressive-disclosure
   thesis before introducing a 9th surface (see `feature-sweep.md`).

## 6. What this PR changed (the quick wins the review surfaced)

- **Hermetic SDK tests** — the loop now runs against a copied throwaway harness
  root; `git status` is unchanged before/after the suite. (Premortem #2)
- **CI workflow** — `.github/workflows/ci.yml`: Python harness job + Node cockpit
  job (lint + server + client). (Premortem #3)
- **Claude-format hardening** — the Claude driver logs loudly when
  `--output-format json` drifts; the cockpit session parser warns when a non-empty
  `.jsonl` yields zero records. (Premortem #1)
- **Incidental:** fixed two stale client test counts and applied the repo's own
  prettier formatting to 9 files so the lint gate is green on arrival.
