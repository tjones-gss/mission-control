# Handoff — Mission Control

The **L0–L3 ladder is complete AND released**: `v0.4.0` is a real GitHub release
(tag → `release.yml` → `bom.json` + `openapi.json` attached — the literal L3
proof artifact). On top of it, **the policy-plane pivot shipped** (this session,
all merged to `main` via PRs #9–#13): the strategic reframe is that the *viewer*
is commoditized (Anthropic shipped native Agent View May 2026 and Agent Teams
are absorbing fan-out), so investment concentrates on the **policy plane** —
runtime governance, risk-typed approvals, and the rails as a vendor-neutral MCP
surface. Read this first.

> **Policy plane — SHIPPED this session (merged: PRs #9 #10 #11 #12 #13):**
> - **`v0.4.0` released** — tag cut at the Phase-4 merge; release published with
>   SBOM + OpenAPI attached. CHANGELOG dated 2026-06-09.
> - **Redesign slice 1 merged** (#9) — `--mc-*` token layer, `useTheme` +
>   Appearance tab, TriageView as default Agents view. (The "see and steer"
>   phrase in CLAUDE.md is load-bearing — `cross-vendor-label.test.js` guards it.)
> - **Audit log v2 — control-state capture** (#10, contracts **v9**, breaking):
>   `audit-event.controlState` records policies in force, `gateType`
>   (hard|soft|policy), `decisionMaker` (human|auto), permissionMode/model
>   snapshot. REQUIRED on approval events (schema conditional + the writer's
>   schema-derived fail-closed check). All 7 emit sites record real control
>   state. This is the EU-AI-Act-Art.12 / NIST-shaped artifact — enforcement
>   and audit as the same act.
> - **ADR-0006 amendment** (#10): native Agent Teams absorb spawning; Fleet's
>   identity is the GOVERNANCE layer; `strategy: fleet` gains a native-team
>   dispatch substrate when teams exit experimental. No new engine.
> - **Risk-typed approvals** (#11): the `commandClassifier` result is stored ON
>   the approval, surfaced in `getQueryStatus`, joined onto session summaries
>   (`riskLevel`/`riskDescription`/`pendingApprovalCount`, worst-pending wins;
>   pending approval forces `needsInput`), rendered as TriageView risk badges
>   (Destructive / Runs code / Needs review), and carried on tool-approval
>   audit events. Null when unclassified — never fabricated.
> - **Harness MCP server** (#12): `harness mcp` — READ-ONLY stdio JSON-RPC
>   (stdlib-only). Tools: `harness_status` (single-sourced with
>   `status --json` via `harness_core/status.py`), `get_policy_context`,
>   `get_pending_approvals`. **Deliberately no approve/decide tool** (agent
>   self-approval is the hole the rails close; a test pins the surface).
>   This is the realistic second-adopter wedge: Cursor/Copilot users can
>   consume the rails without the cockpit.
> - **Theme cascade** (#13): tailwind `gray`/`indigo` resolve through
>   `--mc-*-rgb` channel vars — all ~850 utility usages (incl. 43
>   alpha-modifier forms) follow the theme; classic pixel-identical
>   (`theme-cascade.test.js`, 24 cases).
>
> **Suites at head:** server **1099** / client **594** / python **155** (6
> skips) — all green, every PR through CI.
>
> **Open next-steps (in priority order):**
> 1. **SelectionBar — fold Dispatch into triage** (the unfinished half of the
>    cascade workstream): collapse `DispatchDrawer.jsx`/`DispatchSignal.jsx`
>    into a multi-select SelectionBar on TriageView (broadcast / set mode /
>    approve N safe / snooze) — retires a surface per the freeze rule. The
>    design-handoff `triage.jsx` SelectionBar is the UX spec. "Approve N safe"
>    is now honest — riskLevel exists on summaries.
> 2. **Read-only Pipeline spine (slice 2) — BLOCKED on contracts-first:**
>    the harness must emit the ordered phase list in `harness status --json`
>    (today: only current `pipeline.{phase,gate}`). Then render the
>    Research→Ship spine as a mode inside Runs. Do not parse YAML in the
>    cockpit.
> 3. **Audit v2 follow-through:** the harness-side writer gap still stands
>    (decisions made against the rails CLI directly are not audited) — now
>    more visible since the MCP server advertises pending approvals.
> 4. **Adoption tripwire still UNFIRED** — Composer + broad reskin stay gated
>    until one external human retains the rails a week. The MCP server is the
>    cheapest tripwire experiment: package `harness mcp` setup for a
>    Cursor/Copilot user and get ONE external adopter. **Stop building before
>    firing this.**
>
> **Tripwire RELAXED (2026-06-10, owner decision — personal-tool focus):**
> Mission Control is not gearing for a market release; the goal is a personal
> major tool (the "epicenter" plan, `~/.claude/plans/elegant-watching-lightning.md`).
> The adoption tripwire is therefore relaxed for **personal-value work** — the
> ADR-0008 lane (SQLite read-cache → full-text search → ⌘K palette → AFK
> notify → cost analytics → knowledge surfacing) builds without waiting for an
> external adopter. The tripwire still gates **market-facing polish only**
> (Composer + broad reskin, item 4 above). Do not re-apply the old blanket
> gate to the personal-value lane.
>
> **Phase 4 done (this session) — L3 standard, branch `feature/phase-4-l3-standard`.**
> Closed the L3 release gate across five workstreams: (A) dropped the cross-vendor
> VIEWING label (docs + grep-guard); (B) published the versioned vendor-neutral
> `harness status` contract (`packages/contracts/SPEC.md` + dedicated contracts
> CHANGELOG, sidecar schema **8**); (C) served the cockpit's OWN OpenAPI surface at
> `GET /api/docs` (+ `npm run openapi:export`, CI artifact); (D) append-only audit
> log (**cockpit sole writer**, JSONL via atomic-rename, validated against the new
> `audit-event` schema) + env-gated (`OTEL_ENABLED`, OFF by default) OTel + the
> exported `buildApp()` app factory; (E) release engineering — all 5 `package.json`
> + 2 `pyproject.toml` to **lockstep 0.4.0**, the CHANGELOG `[Unreleased] → [0.4.0]`
> flip, `RELEASING.md` (the THREE axes: package semver vs contracts `SCHEMA_VERSION`
> vs `APPROVAL_SCHEMA_VERSION`), `RUNBOOK.md` (operate/deploy/rollback on the
> ADR-0004 localhost-first topology), a zero-dep CycloneDX SBOM generator spanning
> npm lockfiles + direct python deps, and a tag-triggered (`v*`) `release.yml`.
> All TDD-first; new gates: `changelog-lint`, `sbom.smoke`, `version-consistency`,
> `spec-generator`, audit/otel/openapi suites.
>
> **THE one human-cut step that remains** (cannot be a file): tag `v0.4.0` and push
> it to trigger `release.yml`, producing the real GitHub release with `bom.json` +
> `openapi.json` attached — the literal L3 proof artifact. See `RELEASING.md`. (The
> separate out-of-repo branch-protection step from Phase 3 — marking the CI checks
> *required* on `main` — also still stands; see `docs/ci.md`.)

> **Phase 3 done (this session).** All four L2 release-gate criteria
> (`DOD-LADDER.md` L2) plus the locked trust-grant fast-follow landed, TDD-first:
> (1) **empty front-door welcome** + one-click first agent (`WelcomeHero`, reusing
> the existing spawn path); (2) **one-click in-cockpit rails adoption** via a
> **pure-Node** installer + `POST /api/rails/adopt` — needs neither python, bash,
> nor jq — backed by a **full-parity pure-Node port of all four hooks** (`.mjs`,
> proven identical to the shell hooks by `test_hook_parity.py` + a 24-case
> `node:test` suite); (3) **CI coverage gate** (measure-then-floor v8 thresholds run
> with `--coverage`) + the blocking-e2e doc; (4) **in-cockpit per-folder trust
> button** (`/api/trust` + a Settings "Trusted folders" tab). Suites: **1008 server
> / 545 client / 129 python (6 parity skips w/o jq) / 24 Node hook tests**, both
> coverage gates green. Branch: `feature/phase-3-l2-adoptable`.
>
> **One out-of-repo step remains** (cannot be a file): a repo admin must mark
> `cockpit (Node)` + `cockpit e2e (Fleet + Playwright)` as **required status checks**
> on `main` so the coverage gate and e2e actually block merge — see `docs/ci.md`.

> **Phase 2 done + council-hardened (this session).** The `pipeline-phase` contract
> is now the *consumed* spine (schema v7): the harness loader validates every
> authored phase and materializes canonical defaults; gates HALT on unmet evidence
> (incl. the new `scope_adherence` gate and verdict-parsing validation/review
> gates); a per-run cost ledger hard-aborts (exit 4); a `strategy: fleet` phase
> dispatches to the cockpit Fleet and writes outcomes back via `harness mission
> status`; phase transitions surface goal/strategy live through `harness status
> --json`. Suites: **991 server / 529 client / 143 python (1 skip) / 2 gated e2e**,
> all green.
>
> A five-lens **council** (engineering / contracts / security / product / red-team)
> reviewed it and caught a real gap: CI hard-listed its Python tests and did **not**
> run the new spine tests, and there was no end-to-end loop test (every loop test
> mocked the thing under test). Both are now fixed — CI runs all new modules, a
> real-gates+real-cost `test_loop_e2e.py` was added, `scope_adherence` fail-open is
> tested, and bad cost-policy values WARN instead of silently going unbounded. The
> council report is at `council-phase2-l1-*.html` (gitignored). See the CHANGELOG
> `[Unreleased] → Phase 2` section for the full list.
>
> **Known-staged:** `strategy: fleet` is wired + tested but **no shipped pipeline
> uses it yet** — treat it as experimental until a real pipeline adopts it.

## 1. Current state

- **Branch:** `feature/phase-4-l3-standard`. Phases 0–4 (L0–L3) are **committed**
  through `606f7ed`; the UI/UX redesign slice above is **uncommitted** on top.
- **What's committed:** the full L0–L3 ladder — Phase 0 (ADRs 0004–0007, `SCOPE.md`,
  `DOD-LADDER.md`), Phase 1 hardening (1a–1g), Phase 2 (consumed spine, L1), Phase 3
  (adoptable, L2), Phase 4 (standard, L3: contract spec, OpenAPI, audit/OTel, release
  eng) — all TDD-first, every commit through the pre-commit gate.
- **What's uncommitted (redesign slice):** the `--mc-*` token layer, `useTheme` +
  `AppearanceTab`, and `TriageView` (+ tests) — see the redesign block above.
- **Suites — all green:** **client 567** (Vitest; +22 from the redesign slice — the
  only suite this slice touched). Server + Python suites are unchanged by the redesign
  (client-only) and green at the committed L3 state. Lint (prettier) + `vite build`
  pass.
- **Contract boundary intact:** the cockpit still shells out to `harness status
  --json` and renders the structured output — it never reparses harness YAML. (This
  is exactly why the read-only Pipeline spine is blocked: the phase list must be
  *emitted* by the harness, not parsed in the cockpit — see redesign next-step 3.)

## 2. What shipped

### Phase 0 — decisions and docs

| Artifact | What it pins down |
|---|---|
| `docs/adr/0004-deployment-topology.md` | Localhost-first, architect-for-team deployment topology |
| `docs/adr/0005-moat-and-surface-strategy.md` | Moat thesis + the "no window-only polish" rule |
| `docs/adr/0006-canonical-orchestration-model.md` | Harness pipeline is the SPINE; Fleet is a phase STRATEGY; Workflow is a degenerate single-phase pipeline |
| `docs/adr/0007-core-vs-experimental-scope.md` | CORE vs EXPERIMENTAL scope split |
| `SCOPE.md` | CORE vs EXPERIMENTAL manifest + the freeze rule: *no new tab without retiring an overlap* |
| `DOD-LADDER.md` | L0 honest → L1 trustworthy → L2 adoptable → L3 standard, each rung a release gate with testable exit criteria |
| `apps/cockpit/.prettierrc` | `endOfLine:"auto"` so the pre-commit gate passes on Windows |

### Phase 1 — hardening (council gaps closed)

| Item | What it does | Closes | Key files |
|---|---|---|---|
| **1a** | `buildSpawn()` always `shell:false`; `.cmd`/`.bat` via `cmd.exe /d /s /c <bin> <args>`, `.ps1` via `powershell -NoProfile -NonInteractive -File <bin> <args>`, args passed as discrete literal argv — closes Windows `.cmd`/`.ps1` command injection | HIGH #4(a) | `server/claude-cli.js`, `server/lib/claude-bin.js` (`isShellScript`) |
| **1b** | `resolvePermissionArgs()`: the interactive front door no longer defaults to `--dangerously-skip-permissions`; defaults to `--permission-mode acceptEdits` (GUARDED), escalates to skip only for a cwd in the new default-DENY per-cwd trust store. An explicit valid `permissionMode` is still honored | HIGH #4(b) | `server/pty-session.js`, `server/lib/trust-store.js` |
| **1c** | Fleet harness-escalation branch calls `runHarnessApprove()` as a DIRECT python subprocess — no Claude session in the deterministic approval write path; `isKnownHarnessRoot` gate preserved; harness CLI stays the single writer | MED #6 | `server/fleet/fleet-runner.js`, `server/parsers/harness.js` |
| **1d** | Single canonical `packages/contracts/schema-version.json`; `index.js` derives `SCHEMA_VERSION` (now **6**) and `APPROVAL_SCHEMA_VERSION` (**2**) as DISTINCT concepts; python `_resolve_schema_versions()` reads the same sidecar; cross-language parity test reds on drift. New `pipeline-phase.schema.json` — DEFINED + exported but NOT YET consumed (the Phase-2 spine contract) | MED #7 | `packages/contracts/{index.js,schema-version.json,schemas/pipeline-phase.schema.json}`, `packages/harness/tools/harness`, `packages/harness/tests/test_contract.py` |
| **1e** | New `claude-format.js` degrade layer (`makeDegraded`/`isDegraded`, `signalDegraded` → deduped `parser_degraded` SSE, `readClaudeJson`). EVERY `~/.claude` parser is now degrade-guarded — a present-but-unparseable file emits `parser_degraded` + a distinguishable marker instead of silently returning empty/null. Client: `ParserDegradedBanner` + a `parser_degraded` channel in `useSSE` | HIGH #1 | `server/lib/claude-format.js`, all `server/parsers/*` + `server/lib/session-discovery.js`, client `ParserDegradedBanner` + `useSSE` |
| **1f/1g** | Durable Fleet: `reconcileFleetRuns()` boot reconciler (wired in `index.js`) cross-checks pid liveness and marks unrecoverable non-terminal runs the new terminal status `orphaned`. Settle is now a pure predicate (`allChildrenSettled`) + idempotent `maybeFinalize`; `child.pid` captured via an `onSpawn` hook. Global kill-switch at `/api/fleet/kill` (GET/POST/DELETE). `fleet-run.schema.json` adds `orphaned` + `child.pid`; `schemaVersion` → **6** | HIGH #2 | `server/fleet/fleet-runner.js`, `server/index.js`, `server/routes/fleet.js`, `packages/contracts/schemas/fleet-run.schema.json` |

**Loose ends also landed:** real-child e2e Fleet test (verify→reject→retry→synthesis,
closes HIGH #3) + the kill-and-restart durability test, both in the gated lane;
python `_SCHEMA_VERSION_FALLBACK` 5→6 with a parity test guarding fallback drift;
`.gitignore` now ignores `apps/cockpit/server/data/fleet/` and `data/fleet-templates/`
(`session-names.json` stays tracked); `test_contract.py` now **fails** (not skips)
when `jsonschema` is absent.

## 3. How to run / verify

**Install topology — root `npm install` is not enough.** The cockpit manages its
own `server/` and `client/` via `cd` scripts; both need their own installs before
tests will run.

```
npm install                                   # root: cockpit + contracts workspaces
npm --prefix apps/cockpit/server install       # server deps
npm --prefix apps/cockpit/client install       # client deps
```

Tests, per subproject:

```
# Server (Vitest) — 991
cd apps/cockpit/server && npx vitest run

# Client (Vitest) — 529
cd apps/cockpit/client && npx vitest run

# Both at once (from apps/cockpit)
npm --prefix apps/cockpit test

# Python harness (pytest) — 143 (1 skip)
cd packages/harness && pytest

# Gated e2e — 2 real-subprocess tests, opt-in
cd apps/cockpit/server && RUN_E2E=1 npx vitest run --config vitest.e2e.config.js
```

Without `RUN_E2E=1` the e2e include set is empty and the lane exits 0 (clean
no-op). The gated lane drives a real verify→reject→retry→synthesis cycle plus the
kill-and-restart durability test.

## 4. What's next — Phases 3 & 4 (re-plan)

The three reassessment-gate decisions are **resolved** (locked at the start of the
Phase 2 session):

1. **Verification cost ceiling → opt-in, 1 verifier / 1 round.** Verify is off by
   default; when on, defaults to a single authorship-blind verifier and one round.
   Applied in the Fleet-dispatch policy default (`fleet_dispatch.build_request`).
2. **Cross-vendor scope → drop the label.** *EXECUTED (Phase 4):* ADR-0005 (Amendment
   2026-06-08) and DoD L3 now scope oversight to Claude Code only — the VIEWING label
   is dropped, cross-vendor lives in the rails + the contract, not the viewer; no
   Cursor/Codex reader shipped. README + project CLAUDE.md viewing pitch corrected, a
   repo-grep guard test prevents regression. Phase 4 is now contract-publishing +
   OpenAPI + OTel/audit-log + release-eng.
3. **Trust-grant UX → in-cockpit per-folder button.** *Recorded, executes in
   Phase 3 (possible fast-follow):* wire `GET/POST/DELETE /api/trust` to
   `lib/trust-store.js::trustCwd()` and add a "Trust this folder" control. Store is
   already write-capable; only route + UI remain.

**Phase 3 (adoptable, L2): DONE** (branch `feature/phase-3-l2-adoptable`). Delivered
the four L2 gate criteria + the trust-grant button: empty-front-door welcome +
one-click first agent; one-click in-cockpit rails adoption with a full-parity
pure-Node hook fallback; CI coverage gate (measure-then-floor) + the blocking-e2e
doc. **Consciously deferred** (per the scope decision — not L2 gate criteria, now
fast-follow): the SCOPE.md UI *collapses* (Conductor/MissionControl/Runs → one hero
job; Kanban/AgentTree merge) and the *audit-log / SBOM / opt-in-telemetry* seed
(mostly L3). The trust-grant button shipped (see above).

**Phase 4 (standard, L3):** drop the cross-vendor label (decision 2) — **DONE**;
publish the versioned vendor-neutral `harness status` contract; serve OpenAPI at
`/api/docs`; OTel tracing + append-only audit log; release engineering (semver,
CHANGELOG, runbook, SBOM).

**Deferred features (conscious, not forgotten):**

- Trust-grant UI/route — decision locked (in-cockpit button); store ready, route+UI
  pending (Phase 3 / fast-follow).
- `/api/fleet/kill` exists server-side; the `orphaned` UI badge is not built.
- `parser_recovered` self-clear SSE event (banner currently does not auto-clear).
- Real-key nightly e2e (the gated lane uses stubbed subprocesses by default).

## 5. Pointers

- **ADRs:** `docs/adr/` (0004–0007, plus `0000-template.md` and `README.md`).
- **Scope manifest:** `SCOPE.md`. **DoD ladder:** `DOD-LADDER.md`.
- **Full plan:** `~/.claude/plans/do-what-you-need-ticklish-flamingo.md`.
- **Council + premortem artifacts** are retained locally and **gitignored**
  (`council-*.{md,html,json}` at repo root).
- **Contract boundary reminder:** if the dashboard needs new data, the harness
  emits it via `harness status --json` and the cockpit consumes it — never duplicate
  harness parsing in the cockpit.
