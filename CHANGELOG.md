# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/); the project is pre-1.0
and versioned on three independent axes (package semver, contracts
`SCHEMA_VERSION`, `APPROVAL_SCHEMA_VERSION`) — see `RELEASING.md`. This file is
the **package semver** axis; `0.4.0` is the first tagged version off `0.1.0`.

## [Unreleased]

<!-- New entries land here. ONLY S7 (E-release-eng) flips the heading below. -->

### The Epicenter — ADR-0008 SQLite cache + search everything + palette + AFK notify + analytics + knowledge

[ADR-0008](docs/adr/0008-sqlite-derived-read-cache.md) **Accepted** (amended:
`cockpit.db` is a PURE derived cache — deleting it is always safe, it rebuilds
from `~/.claude`; fleet runs stay JSON-per-run; engine is `node:sqlite`
confined to `lib/db/connection.js`, so the server now requires **Node 22.13+**
via the `engines` field). Built on top of it, the personal-tool "epicenter"
capability stack (owner decision: the adoption tripwire is relaxed for
personal-value work; it still gates the Composer + broad reskin).

**Added**

- **SQLite derived read-cache** (`apps/cockpit/server/lib/db/` — `connection`
  / `session-index` / `message-index` / `usage-index` / `memory-index` /
  `intelligence-store`): WAL mode, schema-version delete-and-rebuild, degraded
  fallback to direct parser reads. The session list is served from the index
  with event-driven watcher invalidation — the 3-second TTL scan cache is
  gone, the previously-unhandled session-file `unlink` now removes rows, and
  subagent transcripts are guarded out of the index (phantom-session fix).
- **Search everything** — a messages table + external-content **FTS5** index
  over every session's user/assistant text, thinking, and tool-input
  summaries (tool_results and base64 excluded; ~4KB block truncation).
  `GET /api/search?q=&project=&from=&to=&type=&limit=` with snippet
  highlights and BM25+recency ordering; the **History tab gains an
  "Everything" mode** with deep links into the session detail.
- **⌘K Command Palette** (`client/src/components/CommandPalette.jsx`) —
  debounced search from anywhere; grouped sessions → message hits → knowledge
  docs with type-filter pills; keyboard navigation; `--mc-*` tokens only.
- **AFK gate notifier (notify-only)** — `lib/notify.js`, env-gated by
  `OVERSIGHT_WEBHOOK_URL` (unset = total no-op): POSTs
  `{sessionId, displayName, riskLevel, riskDescription, toolName, action_url}`
  on tool-approval and harness danger-zone approval-pending events. **No
  inbound path** — approving stays on the audited cockpit routes.
- **Cost analytics** — a `usage_daily` rollup table (tokens stored, priced at
  read time via the existing `utils/cost.js` tables), `GET /api/stats/usage`
  (`groupBy=project|day|model`), and a **stats mode inside the History tab**
  (totals, per-day trend, per-project, model mix — no new top-level tab,
  per ADR-0007).
- **Knowledge surfacing** — `~/.claude` memory files and intelligence
  summaries join the FTS corpus as `doc_type='memory'|'summary'`;
  intelligence analyses (and their messageCount/subagentCount staleness
  snapshots) now **persist across restarts** behind the unchanged
  `intelligence/cache.js` API.

### Theme cascade — gray/indigo resolve through the token layer

**Changed**

- **`tailwind.config.js` remaps the `gray` + `indigo` palettes** through new
  `--mc-gray-*` / `--mc-indigo-*` RGB channel variables
  (`rgb(var(--mc-gray-900) / <alpha-value>)`), so all ~850 existing utility
  usages — including the 43 alpha-modifier forms like `bg-gray-900/50` —
  follow the active theme with zero component edits. `:root` pins the EXACT
  default Tailwind channels (classic is pixel-identical); calm/tron/warm remap
  each rung onto their semantic tokens. A theme-switch is now a whole-app
  change, not a body+TriageView-only change. Guarded by
  `src/tests/theme-cascade.test.js` (24 cases: alpha slots, classic ground
  truth, full per-theme override coverage).

### Harness MCP server — the rails as a vendor-neutral MCP surface

**Added**

- **`harness mcp`** serves the rails as a **READ-ONLY** MCP server over stdio
  (newline-delimited JSON-RPC 2.0, stdlib-only — no new dependency). Any
  MCP-compatible agent (Claude Code, Cursor, Copilot, …) can consult the
  rails without the cockpit: `harness_status` (the SAME composition as
  `harness status --json`, single-sourced in `harness_core/status.py` so the
  two can never drift), `get_policy_context` (danger-zone operations +
  quality gates + current pipeline phase/gate — consult BEFORE acting), and
  `get_pending_approvals` (what the agent is blocked on). **Deliberately no
  approve/decide tool** — agent self-approval is the hole the rails exist to
  close; a test asserts the surface stays read-only. This is the ADR-0005
  cross-vendor strategy made concrete: cross-vendor reach lives in the rails
  + the contract, with MCP as the consumption path.

### Risk-typed approvals — real risk on the session summary

**Added**

- **Session summaries carry live approval risk** (`GET /api/sessions` +
  `GET /api/sessions/:id`): `riskLevel` is the WORST pending tool-approval
  classification (`SAFE_READONLY | UNKNOWN | REQUIRES_REVIEW | CODE_EXECUTION |
  DESTRUCTIVE`, from the existing `commandClassifier`), with
  `riskDescription` + `pendingApprovalCount`; an unresolved approval forces
  `needsInput` true (a blocked tool call IS "waiting on you"). The
  classification is now STORED on the approval (it previously rode only the
  SSE event) so the polled status, the session list, and the audit log all
  surface the same value — null when not classified, never fabricated.
- **TriageView risk badges** — the "Needs you" card renders
  Destructive / Runs code / Needs review badges and danger styling from the
  REAL `riskLevel`, closing the seam documented at the slice-1 landing.
- **Tool-approval audit events carry `payload.riskLevel`** —
  `resolveApproval` returns the resolved approval so the decision's risk
  classification rides the v9 audit record.

### Audit log v2 — control-state capture (runtime governance)

**Changed**

- **`audit-event` schema v9 (BREAKING on the contracts axis, sidecar 8 → 9):**
  every audit record can now carry `controlState` — which guardrails were in
  force (`policiesInForce`), whether the gate blocked execution
  (`gateType: hard | soft | policy`), who decided (`decisionMaker: human |
  auto`), and the `permissionMode`/`model` snapshot when knowable. An
  `approval` event REQUIRES it (schema conditional + the writer's fail-closed
  check, both derived from the same schema so they cannot drift) — an approval
  is never recorded without its control context. All seven emit sites
  (front-door spawn, tool approval, trust grant, fleet child spawn / synthesis
  / tool + harness escalations) now record their real control state; unknown
  fields stay null — never fabricated.

**Decisions**

- **ADR-0006 amendment:** native Agent Teams absorb the fan-out primitive;
  Fleet's identity is the governance layer (gates / verify / budget /
  escalation / audit). `strategy: fleet` gains a native-team dispatch substrate
  when teams exit experimental; no new orchestration engine.

### UI/UX redesign — slice 1 (Calm-console themes + "Needs you" triage)

First slices of the Oversight redesign (a Claude Design handoff), ruled
**ship-narrow-slice / advances-rails** by a council (reports
`council-mission-control-20260608.*`, `council-redesign-20260608.*`, gitignored).
TDD-first; client suite **567** green, lint + `vite build` pass. A redesign track
on top of the 0.4.0 / L3 ladder, merged after the `v0.4.0` tag.

**Added**

- **Calm-console token layer** — semantic `--mc-*` CSS variables in
  `apps/cockpit/client/src/index.css`. `:root` reproduces the historical
  gray-950/indigo palette exactly (zero regression); `[data-theme=calm|tron|warm]`
  override the same names; `body` is driven by the tokens.
- **Theme system** — a `useTheme` hook (`hooks/useTheme.js`, persists
  `oversight.theme`) and an **Appearance** tab in Settings (now the default tab),
  offering four themes (Classic / Calm / Tron / Warm gold).
- **"Needs you" triage queue** (`components/TriageView/TriageView.jsx`) — the new
  **default Agents view** (Triage · Board · Detail toggle; Kanban preserved).
  Attention-ranks the real session list needs→running→calm, with inline one-tap
  approve/reply reusing the existing `QuickActions` (`POST /api/sessions/:id/message`)
  write path. No new backend; no fabricated risk flag (a documented seam is left for
  when the session-list contract carries `riskLevel`).

**Decisions**

- **IA ruling (in `SCOPE.md`, not a standalone ADR):** Runs stays the one
  orchestration surface; "Pipeline" is a mode _inside_ it, never a sibling tab;
  `Missions`/`Conductor` collapse into the Pipeline vocabulary.

**Deferred — gated behind the adoption tripwire (per two consecutive councils)**

- The plain-language Pipeline **Composer** (the prototype's was a `setTimeout`+regex
  mock with no backend).
- The read-only **Pipeline spine** — blocked on a **contracts-first** change:
  `harness status --json` must emit the ordered phase list (it currently emits only
  the active phase/gate) before the cockpit can render the Research→Ship spine.
- Any broad **multi-component reskin** — the token layer is meant to cascade instead
  (next step: remap `tailwind.config.js` colors to `--mc-*`).

## [0.4.0] - 2026-06-09

### Phase 4 — Standard (L3)

Phase 4 (Standard, L3) closes the L3 release gate: the cross-vendor VIEWING label
is dropped, the versioned vendor-neutral `harness status` contract is published
(`packages/contracts/SPEC.md`, sidecar schema **8**), the cockpit serves its own
OpenAPI surface, an append-only audit log (cockpit sole writer) + env-gated OTel
land, and release engineering (lockstep semver **0.4.0**, this CHANGELOG flip,
`RELEASING.md`, `RUNBOOK.md`, a CycloneDX SBOM, and a tag-triggered
`release.yml`) is in place. The literal proof artifact — a real `v0.4.0` tag →
GitHub release with `bom.json` + `openapi.json` attached — is the human-cut final
step documented in `RELEASING.md`.

**Added**

- **Append-only audit log (cockpit sole writer) + env-gated OTel + app factory.**
  One append-only JSONL log (`apps/cockpit/server/data/audit/audit.jsonl` via the
  existing atomic-rename helper, ADR-0004 local-JSON) records every **spawn**
  (front-door `POST /api/sessions/new` + Fleet child spawn), **approval** (session
  tool-approval, trust grant, Fleet escalation decide — tool and harness-mediated),
  and **merge** (Fleet synthesis) event the dashboard orchestrates. Each record
  validates against the versioned `packages/contracts` `audit-event` schema (sidecar
  v8) before it is written; a monotonic `seq` (resumed from the on-disk tail) makes
  the never-mutate/never-truncate invariant observable and tested. KNOWN LIMITATION:
  harness-CLI-**direct** actions (outside the dashboard) are not captured — no
  second Python-side writer this phase (documented in `lib/audit-log.js` + ADR-0004).
  OpenTelemetry tracing is **env-gated (`OTEL_ENABLED`), OFF by default** — the
  localhost path pays nothing; provability is an in-process `InMemorySpanExporter`
  span-export test with **no external collector** (green on Win11 + CI). `index.js`
  gains an exported `buildApp()`/`createApp` factory so OTel (now) and the served
  OpenAPI doc (next) share one app builder; `start()` keeps `listen()` and is guarded
  so importing the factory never binds a socket.
- **OpenAPI for the cockpit's own HTTP surface, served + exported.** The cockpit
  serves interactive docs at `GET /api/docs` (swagger-ui) and the machine-readable
  spec at `GET /api/docs.json`, mounted via the `buildApp()` factory AFTER the
  routers but BEFORE the `/api` 404 catch-all. `info.version` reads the server
  package version (0.4.0); only the **CORE** routers carry `@openapi` annotations
  this phase (health, sessions incl. tool-approval/cancel, fleet, harness,
  conductor, rails) — the experimental routers stay unannotated by design, and SSE
  `/api/stream` is excluded. A `npm run openapi:export` script writes the spec
  without booting the server (FAIL-CLOSED on an empty `paths`), and CI publishes it
  as the `cockpit-openapi` artifact. This is a SEPARATE artifact from the
  `packages/contracts` schema — it versions the cockpit REST surface, not
  `harness status --json`.
- **Release engineering: lockstep semver, SBOM, runbooks, tag-triggered release.**
  All 5 `package.json` + 2 `pyproject.toml` versions move LOCKSTEP to **0.4.0**
  (the first tagged version off `0.1.0`) — a distinct axis from the contracts
  `SCHEMA_VERSION` (sidecar **8**) and `APPROVAL_SCHEMA_VERSION` (**2**),
  documented in `RELEASING.md`. A zero-dependency CycloneDX 1.5 SBOM generator
  (`scripts/release/generate-sbom.mjs`) spans BOTH ecosystems — npm components
  resolved from the committed lockfiles (full transitive graph) plus the DIRECT
  python deps hand-built from each `pyproject.toml` `[project]` (transitive python
  deps are honestly NOT resolved — no committed python lockfile). `RUNBOOK.md`
  documents operate / deploy / rollback on the ADR-0004 localhost-first topology
  (honest non-prod note; git-checkout rollback). A tag-triggered
  (`v*`) `.github/workflows/release.yml` runs the already-tested node scripts and
  publishes a GitHub release attaching `bom.json` + the cockpit `openapi.json`.
  A `changelog-lint` contract test guards this flip (exactly one `[Unreleased]`;
  top released heading == package version 0.4.0; valid Keep-a-Changelog).

**Changed**

- **Docs: cross-vendor VIEWING label dropped.** Oversight is scoped to Claude Code
  only (the cockpit reads only `~/.claude`). ADR-0005 gains an "Amendment 2026-06-08
  (Phase 4)" resolving its open deferral (Status stays Accepted — a scoping
  refinement); DoD L3 row #1 commits to the dropped-label branch; the README and
  project `CLAUDE.md` viewing pitch drop the "(and Cursor/Codex)" parenthetical.
  Cross-vendor reach now lives explicitly in the opt-in **rails** adapters + the
  versioned vendor-neutral `harness status` **contract**, not the viewer. A repo-grep
  guard test (`apps/cockpit/server/tests/docs/cross-vendor-label.test.js`) fails if
  either front-door doc regresses to the unqualified cross-vendor viewing promise.

### Phase 3 — Adoptable (L2)

The four L2 release-gate criteria (`DOD-LADDER.md` L2) plus the locked trust-grant
fast-follow. All TDD-first; suites green at **1008 server / 545 client / 129 python
(6 parity skips without jq) / 24 Node hook tests**, both coverage gates passing.

**Added**

- **Pure-Node full-parity hooks.** All four Claude-adapter hooks ported to
  dependency-free Node (`.claude/hooks/{block-danger,require-mission,session-start-load-state,stop-session-note-reminder}.mjs`
  over a shared `_lib.mjs`). `JSON.parse` replaces `jq`, so a machine with neither
  `jq` NOR `bash` still enforces the rails. Behavior is proven identical to the
  shell hooks by `tests/test_hook_parity.py` (structural-JSON / trimmed-text +
  exit-code; skips unless bash+jq+node present) and a 24-case `node:test` suite.
  New `settings.node.json` wires the Node hooks; shell `settings.json` stays the
  committed default.
- **One-click in-cockpit rails adoption** (`POST /api/rails/adopt`,
  `GET /api/rails/adopt-candidates`). A pure-Node `lib/rails-installer.js`
  (`adoptRails`) copies the adapter wired to the Node hooks — **no python, bash, or
  jq, and no Claude session** (deterministic, council MED #6). New
  `getAdoptCandidates`/`isAdoptableTarget` allowlist helpers; an **Add rails**
  control (`AddRailsDialog`) in Mission Control. `install-claude-adapter.py` and
  `add-rails.mjs` gain `--hooks {shell|node|auto}` (auto = node when bash/jq absent).
- **Empty front-door welcome** (`WelcomeHero`): zero sessions now shows a guided
  Welcome + one-click "Start your first agent" (reuses the existing `NewSessionForm`
  spawn path) instead of a blank board, with a second step into the trust control
  (ADR-0005: advances the rails, not window-only).
- **In-cockpit per-folder trust grant** (`GET/POST/DELETE /api/trust` over
  `lib/trust-store.js`; `validateCwd`; a "Trusted folders" Security tab in Settings)
  — the locked Phase 2 reassessment decision.
- **CI coverage gate** (measure-then-floor): v8 thresholds in the server/client
  Vitest configs, run with `--coverage` in the cockpit CI job; `docs/ci.md`
  documents the ratchet policy and the manual branch-protection step to make
  `cockpit (Node)` + `cockpit e2e` required checks (blocking-e2e criterion).

### Phase 2 — Trustworthy loops + unified spine (L1)

The canonical phase contract becomes the **consumed** spine. All TDD-first; suites
green at 991 server / 529 client / 143 python (1 skip) / 2 gated e2e.

**Council follow-ups (hardening before Phase 3):**

- **CI now runs the new spine tests.** `.github/workflows/ci.yml` previously
  hard-listed only the pre-existing Python modules; it now also runs
  `test_pipelines`, `test_loop_halt`, `test_loop_e2e`, `test_cost_ledger`,
  `test_fleet_dispatch` — so the green signal actually covers Phase 2.
- **End-to-end loop test** (`tests/test_loop_e2e.py`): drives the real
  `run_next_mission_loop` with **real** gates + cost ledger (only the LLM edges
  mocked), proving a real unmet gate HALTs (exit 3) and a real cost ceiling aborts
  (exit 4) — not just stubbed wiring.
- **`scope_adherence` fail-open is now tested**: explicit regression tests assert
  the gate passes when git can't enumerate touched files (best-effort, documented).
- **No silent cost mis-config**: a present-but-invalid `run_ceiling_usd` /
  `per_phase_usd` (or env `HARNESS_RUN_CEILING_USD`) now **WARNs** and degrades
  instead of silently reading as unbounded.
- **`strategy: fleet` is staged/experimental**: the dispatch path is wired and
  tested, but no shipped pipeline invokes it yet — it is exercised by tests only
  until a real pipeline adopts it.

**Added**

- `SCHEMA_VERSION` → **7**. Relaxed `pipeline-phase.schema.json` so it validates
  real authored pipeline YAML (only `id`/`agent` hard-required; `gate`/`tier`/
  `strategy`/`goal` optional; authored `description`/`inputs`/`outputs`/`rules`/
  `checks`/`loop`/`no_*_reason` accepted; `additionalProperties:false` keeps typo
  guarding). Extended `harness-status.pipeline` with optional `goal`/`strategy`/
  `transitioned_at`.
- `harness_core/pipelines.py` now **consumes** the contract: `validate_phase`
  (lazy `jsonschema`, fail-open on tooling absence, fail-closed on real violation),
  `load_pipeline` validates phases, and `pipeline_phases` materializes the
  canonical object (default `strategy=single`, carry the pipeline goal, empty
  gate). `harness check` runs the same `validate_phase` (one definition).
- Gates **HALT** the loop on an unmet gate under strict mode (no advancing to
  dependent phases). Evidence gates check the report **verdict**, not mere file
  presence: `validation_recorded` parses the `(exit N)`/TIMEOUT lines,
  `review_recorded` parses the `## Mergeable?` answer (both fail closed). New
  `scope_adherence` gate diffs git-touched files vs the mission's Allowed/Forbidden
  globs (shared parser in `harness_core/missions.py`); wired into the `execute`
  phase of `next-mission-loop.yml`.
- Per-run **cost ledger** (`harness_core/cost.py`, `.harness/run-ledger.yml`) with a
  hard abort ceiling (`.harness/cost-policy.yml` `run_ceiling_usd` or
  `HARNESS_RUN_CEILING_USD`); distinct **exit 4** vs the gate-HALT exit 3. Absent
  ceiling = unbounded (unchanged behavior).
- **Fleet as a phase strategy**: a `strategy: fleet` phase dispatches OUT to the
  cockpit `/api/fleet` (`harness_orchestrator/fleet_dispatch.py`, stdlib urllib;
  verify defaults to the locked opt-in 1 verifier / 1 round), polls to terminal,
  accrues the real `spentUsd`, and writes the outcome back via the new
  `harness mission status <id> <state>` single-writer. Fails **closed** if the
  cockpit is unreachable (never silently runs single).
- Phase-transition surfacing: `set_pipeline_phase` writes `goal`/`strategy`/
  `transitioned_at`, flowing through `harness status --json` → the cockpit watcher's
  `harness_update` SSE → `HarnessDetail` (live phase goal + strategy hint). No
  polling added — the transport already existed.
- `apps/cockpit/server/lib/workflow-compile.js` — `compileWorkflowToPhase` compiles
  a cockpit workflow to a schema-valid single canonical phase (ADR-0006: a Workflow
  is a degenerate single-phase pipeline).

### Phase 0 (decisions/docs) and Phase 1 (hardening) on `feature/harness-scaffold`
(PR #5). All changes TDD-first; suites green at 981 server / 504 client / 77 python
(1 skip) / 2 gated e2e.

### Added

- Program ADRs `0004`–`0007` in `docs/adr/`: deployment topology (localhost-first,
  architect-for-team), moat + surface strategy (the "no window-only polish" rule),
  the canonical orchestration model (harness pipeline = spine, Fleet = a phase
  strategy, Workflow = a degenerate single-phase pipeline), and the
  core-vs-experimental scope split.
- Root `SCOPE.md` — CORE vs EXPERIMENTAL manifest with the freeze rule *no new tab
  without retiring an overlap*.
- Root `DOD-LADDER.md` — the L0→L3 definition-of-done ladder with testable exit
  criteria per rung.
- `packages/contracts/schema-version.json` — single canonical source for
  `SCHEMA_VERSION` and `APPROVAL_SCHEMA_VERSION`, read by both the Node `index.js`
  and the Python harness (no hand-copied literals).
- `packages/contracts/schemas/pipeline-phase.schema.json` — the ADR-0006 phase
  contract (`id`, `agent`, `tier`, optional `model`, `gate.required[]`, `strategy`
  single|fleet, `goal`); defined and exported but not yet consumed (Phase-2 spine).
- `apps/cockpit/server/lib/claude-format.js` — degrade layer (`makeDegraded`,
  `isDegraded`, `signalDegraded` → deduped `parser_degraded` SSE, `readClaudeJson`).
- `apps/cockpit/server/lib/trust-store.js` — persisted, default-DENY per-cwd trust
  store for the interactive front door (no UI/route to grant trust yet).
- Client `ParserDegradedBanner` + a `parser_degraded` channel in `useSSE`.
- Durable Fleet: `reconcileFleetRuns()` boot reconciler (wired in `index.js`), a
  global kill-switch at `/api/fleet/kill` (GET/POST/DELETE), and child `pid` capture
  via an `onSpawn` hook.
- Gated real-subprocess e2e lane (`RUN_E2E=1`, `server/vitest.e2e.config.js`):
  verify→reject→retry→synthesis plus a kill-and-restart durability test.

### Changed

- `apps/cockpit/server/claude-cli.js` `buildSpawn()` now always spawns with
  `shell:false`; `.cmd`/`.bat` route through `cmd.exe /d /s /c` and `.ps1` through
  `powershell -NoProfile -NonInteractive -File`, with arguments passed as discrete
  literal argv.
- `pty-session.js` `resolvePermissionArgs()` defaults to `--permission-mode
  acceptEdits` (GUARDED) instead of `--dangerously-skip-permissions`; skip-permissions
  is used only for a cwd in the trust store. An explicit valid `permissionMode` is
  still honored.
- Fleet harness-escalation branch calls `runHarnessApprove()` as a direct Python
  subprocess — no Claude session in the deterministic approval write path; the
  harness CLI remains the single writer.
- Fleet settle logic replaced the hand-counted pending counters with a pure
  predicate (`allChildrenSettled`) plus an idempotent `maybeFinalize`.
- `SCHEMA_VERSION` bumped to **6** (durable-Fleet `orphaned` status + `child.pid`);
  `APPROVAL_SCHEMA_VERSION` is **2**, versioned independently. `fleet-run.schema.json`
  extended with the terminal `orphaned` status and `child.pid`.
- Every `~/.claude` parser (sessions, config, hooks, session-discovery, mcp, memory,
  skills, plans, history, tasks, teams, conductor, messages) is now degrade-guarded:
  a present-but-unparseable file emits `parser_degraded` + a distinguishable marker
  instead of silently returning empty/null.
- Python harness `_SCHEMA_VERSION_FALLBACK` updated 5→6, with a parity test guarding
  fallback drift; `test_contract.py` now fails (not skips) when `jsonschema` is absent.
- `apps/cockpit/.prettierrc` gained `endOfLine:"auto"` so the pre-commit gate passes
  on Windows.
- `.gitignore` now ignores `apps/cockpit/server/data/fleet/` and
  `data/fleet-templates/` (`session-names.json` stays tracked).

### Fixed

- Fleet runs no longer wedge at `running` across a server restart — the boot
  reconciler cross-checks pid liveness and marks unrecoverable non-terminal runs
  `orphaned` (run + child).
- Parsers no longer misreport "nothing configured" when a `~/.claude` file is present
  but unparseable.

### Security

- Closed Windows `.cmd`/`.ps1` command injection in the spawn path (literal argv,
  `shell:false`).
- The interactive front door no longer disables permission prompts by default;
  choosing a cwd is not consent to skip permissions.
- Removed the Claude session from the deterministic `harness approve` write path.
