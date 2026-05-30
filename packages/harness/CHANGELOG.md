# Changelog

All notable changes to the Adaptive Agentic Engineering Harness. The canonical
version timeline lives here. The older per-step changelogs (`CHANGELOG-v4-to-v5.md`
in the v5 patch) are preserved alongside this file for historical reference.

## [5.3.0] — 2026-05-28 — `mvp-sketch` mode restored + `harness setup` PyYAML bootstrap fix

Reinstates the prototype/spike lane that was present in v5.2.0 and dropped during the
v5.2.x reorg, and fixes the unreachable PyYAML auto-install path in `harness setup`.

### What's new

- **`mvp-sketch` pipeline** — timeboxed pre-MVP lane: sketch-intake → scope-slice →
  prototype-plan → prototype-build → sketch-validation → sketch-review → disposition.
  Disposition required: `disposable` (throwaway) or `promotable` (handoff to
  `idea-to-mvp`, not eligible to ship directly).
- **`prompts/bootstrap-mvp-sketch.md`** — orchestrator bootstrap prompt for the lane.
- **`docs/sketches/`** — README plus three templates: `sketch-brief`,
  `prototype-scope`, `prototype-plan`. Sketch artifacts live in
  `docs/sketches/<slug>/`.
- **`harness init mvp-sketch`** — CLI registers the new mode (first stage:
  `sketch-intake`).

### Fixed

- **`harness setup` now actually installs PyYAML on a fresh machine.** The
  top-level `import yaml` guard previously called `sys.exit(2)` before
  `cmd_setup` could run, so the documented bootstrap was unreachable. The guard
  now attempts `pip install pyyaml` first when the subcommand is `setup`. The
  now-dead `_ensure_pyyaml` helper inside `cmd_setup` is removed.

## [5.2.3] — 2026-05-27 — Workstation setup (agent-driven)

One-command and one-prompt setup for harness **core** only (no SDK/MCP).

### What's new

- **`harness setup`** — Cursor hooks (hooks-only) + Claude adapter + `harness check`
- **`prompts/setup-workstation.md`** — paste-to-agent bootstrap checklist
- **`docs/setup/quick-start.md`** — human quick start
- **`workstation-setup`** skill (Claude) — triggers on "set up the harness"
- **`tools/claude.ps1`** — defaults to `setup`
- README getting started leads with agent prompt + `harness setup`

## [5.2.2] — 2026-05-26 — Claude Code one-command install

Adds `harness install claude` and Windows helpers so the Claude Code adapter
can be wired at the project root without manual `cp` / `chmod`.

### What's new

- **`harness install claude`** — copies `adapters/claude-code/` to `.claude/` + `CLAUDE.md`
- **`tools/install-claude-adapter.py`** — cross-platform installer; on Windows wraps
  hook commands with explicit Git Bash (WSL-safe) and runs `chmod +x`
- **`tools/claude.ps1`** — PowerShell shortcut (`install` / `check`)
- **Root `.claude/` + `CLAUDE.md`** — installed copy for this repo (dogfooding)
- **Docs** — `docs/setup/claude-code.md` quick install + Git Bash explainer; README updated
- **Tests** — Windows Git Bash detection and settings patch tests in `tests/test_cli.py`
- **`.gitignore`** — exclude `__pycache__`, `*.egg-info`, `.env`

### Install

```bash
./tools/harness install claude
```

Windows PowerShell:

```powershell
.\tools\claude.ps1
```

## [5.2.1] — 2026-05-26 — SDK verification hardening

Production hardening and operational verification runbook for Cursor SDK integration.

### What's new

- **Strict gates** — live `run-loop` exits 3 when required gates fail; `--no-strict-gates` override
- **Install scripts** — `tools/install-cursor-adapter.sh`, `tools/install-cursor-adapter.ps1`
- **Verification runbook** — `docs/setup/cursor-sdk-verification.md`
- **Roadmap taxonomy** — milestones split into code-complete vs verified-live
- **CI fix** — `harness-mission.yml` installs `harness_core` + `sdk/python[cursor]`; sets `HARNESS_REPO_URL`
- **Live integration test** — `TestLiveSdk` in `sdk/python/tests/test_sdk.py` (skipped without `CURSOR_API_KEY`)
- **Windows docs** — Git Bash hook requirements in setup and adapter READMEs
- **`block-danger.sh` Windows fix** — always emit JSON; avoid bash 4 `,,` and `set -e` silent failures
- **Windows hooks** — `hooks.json` uses explicit Git Bash; shared `_common.sh`; `write-cursor-hooks-json.ps1`

## [5.2.0] — 2026-05-26 — Cursor SDK integration

Programmatic harness orchestration via Cursor SDK, Cursor hook parity with
Claude Code, shared `harness_core` library, and CI workflows.

### What's new

- **Cursor adapter hooks** — `adapters/cursor/.cursor/hooks/` + `hooks.json`
  (mission scope, danger zone, session notes, sessionStart state preload)
- **`harness_core/`** — shared YAML, mission selection, gate evaluators (ADR-002)
- **`sdk/python/harness_orchestrator`** — `run-loop`, `preflight`, cloud/local
  runtime, `--resume`, `--dry-run`
- **`sdk/mcp/harness-mcp-server`** — MCP tools wrapping harness CLI
- **`sdk/typescript/examples`** — thin CI wrapper
- **CI** — `.github/workflows/harness-check.yml`, `harness-mission.yml`
- **Docs** — `docs/roadmap/cursor-sdk-roadmap.md`, `docs/setup/cursor-sdk.md`,
  `docs/specs/SPEC-003-sdk-state-fields.md`
- **`harness check`** — validates Cursor adapter and runs Cursor hook smoke tests
- **SDK state fields** — `current.agent_id`, `last_run_id`, `runtime` in project-state

### Install

```bash
cp -r adapters/cursor/.cursor .
pip install -e harness_core
pip install -e "sdk/python[cursor,dev]"
python -m harness_orchestrator run-loop --cwd . --dry-run
```

## [5.1.2] — 2026-05-25 — Local HTML dashboard

Adds a single command, `harness dashboard`, that renders a static HTML
page summarizing the project state already on disk. Read-only,
dependency-free beyond what `tools/harness` already needs (PyYAML),
no network, no source-of-truth migration.

### What's new

- **`harness dashboard`** subcommand in `tools/harness`. Writes
  `runs/dashboard/index.html`. Flags: `--output PATH`, `--open`.
- **Eleven panels**, each reading a single harness file and hiding
  itself when that file is empty: Project header, Current Mission
  (with acceptance progress), Next Recommended Action, Readiness
  (per-category + overall), MVP Checklist (grouped by domain),
  Mission Board, Risks, Open Questions, Recent Session Notes,
  Friction & Improvements, Validation / Tests.
- **Optional config** at `.harness/dashboard-config.yml` — toggle
  panels, swap theme (dark / light), set output path, cap recent
  notes. Missing config = defaults; unknown keys ignored.
- **Setup docs** at `docs/setup/dashboard.md`.

### What it deliberately does not do

- Edit, infer, or supplement harness state. Every value on the page
  traces back to one file under `.harness/` or `runs/`.
- Add new dependencies. PyYAML is already required by `tools/harness`;
  everything else is Python stdlib.
- Fetch anything over the network. All CSS is inlined; no fonts,
  scripts, or images are loaded from a CDN. The page opens offline.
- Re-run `harness check` or `harness validate` on its own. It surfaces
  the newest report under `runs/test-reports/` if one exists.

### Constraints honored

- No redesign, no new pipelines, no new agents.
- No application code touched (there is none in this repo, and the
  dashboard never reads outside `.harness/`, `runs/`, or the optional
  config it owns).
- No gates weakened. `block-danger.sh`, the danger-zone YAML, the
  human-approval policy, and the require-mission hook are all
  byte-identical to v5.1.1.
- `harness check --strict` exit code unchanged.

### Files changed

- `tools/harness` — added `cmd_dashboard` and helpers, wired into argparse.
- `CHANGELOG.md` — this entry.

### Files added

- `.harness/dashboard-config.yml` — optional config template.
- `docs/setup/dashboard.md` — setup and reference.

---

## [5.1.1] — 2026-05-25 — Hardening fix-ups

Fixes four issues surfaced by an internal security review of the v5.1 patch.
No redesign, no new files, no schema changes. Two implementation files
modified, plus tests and changelog.

### `adapters/claude-code/.claude/hooks/require-mission.sh`

- **Path-traversal reject (B1).** The hook does substring/glob matching on
  the raw `file_path` without canonicalization. A path like
  `src/auth/../billing/charge.ts` previously matched an Allowed `src/auth/**`
  pattern while actually targeting a Forbidden file. A new `case` statement
  before the Forbidden-loop denies any `REL_PATH` containing `..` as a path
  segment (`..`, `../*`, `*/..`, `*/../*`). Non-traversal `..` inside a
  filename (e.g. `weird..name.ts`) is unaffected. No GNU `realpath`
  dependency — works on macOS/BSD.
- **mawk fallback (N1).** `read_yaml_scalar` passed `-v sub="$sub"` to awk.
  `sub` is a reserved word in mawk (the default awk on Debian/Ubuntu);
  mawk rejects the assignment with "cannot command line assign to sub —
  type clash or keyword" and the script silently produces no output,
  downgrading enforcement to ASK on every app-code edit when PyYAML is
  unavailable. Renamed the awk variable to `subkey` and updated the two
  body references. Bash `local sub` and the Python branch unchanged.
- **Quoted/backticked mission entries (N3).** `parse_mission_section`
  previously preserved surrounding `"`, `'`, or `` ` `` literally, so a
  mission listing `- "src/auth/**"` or ``- `src/components/Login.tsx` ``
  never matched real files. Two `sub()` calls now strip a single
  surrounding quote/backtick. Applies to both Allowed Files and Forbidden
  Files (same parser, two call sites).

### `tools/harness`

- **Catch-all Allowed lint (N4).** When a mission's Allowed Files list
  contains `*` or `**` alone (after quote-stripping), `harness check` now
  emits a warning so authors either tighten the glob or acknowledge the
  scope. Warning, not failure — Forbidden Files still apply and the
  existing `--strict` escalation rules cover it.

### `tests/check_hooks.sh`

Six new behavioral cases (22 total): path-traversal denies via Allowed
prefix and via harness-path prefix; quoted and backticked Allowed entries
match; the awk fallback's variable name parses cleanly under whatever
awk is on PATH.

### Constraints honored

- No redesign, no new pipelines, no new architecture.
- No relaxed danger-zone rules.
- No removed human-approval requirements.
- No quality gate changes.
- Two implementation files modified, plus tests and changelog.

### Remaining known limitations (unchanged from 5.1)

- Glob `**` still behaves like `*` inside bash `[[ == ]]`; missions that
  legitimately need deep-glob semantics rely on `find` or other tooling
  upstream. The new N4 lint catches the bare `**` catch-all but does not
  validate deeper glob semantics.
- `block-danger.sh` is substring-matched on raw command text. Command
  obfuscation (quoting splits like `r''m -rf`, `$(echo rm)`, base64 →
  `sh`, flag-order swaps like `rm -fR`) bypasses by design. Defense in
  depth via `.harness/human-approval-policy.yml` is the second layer.
- On Windows, hooks require Git Bash or WSL. PowerShell-launched hook
  invocations silently fail (documented in `docs/setup/claude-code.md`).

---

## [5.1] — 2026-05-25 — Hardening pass

v5.1 does not redesign anything. It tightens enforcement, plugs validation
gaps, and adds the test/setup scaffolding that v5 left implicit.

### Consolidation

- The harness now ships as **one zip** instead of three layered patches. v4
  base + v4.1 self-improvement layer + v5 Claude Code adapter are merged into
  a single tree rooted at `adaptive-agentic-engineering-harness-v5.1/`. The
  prior layered drops are kept as inputs for anyone diffing version-to-version.
- Two empty literal-brace directories that came out of the v5 patch zip
  (`docs/{specs,product}/` and `adapters/claude-code/.claude/skills/{harness-bootstrap,...}/`)
  have been removed. They were packaging artifacts, not real content.

### Hooks — `adapters/claude-code/.claude/hooks/`

**`block-danger.sh`**
- Loads `blocked_command_patterns` from `.harness/danger-zone.yml` at runtime.
  Previous behavior hard-coded the list in the script, which drifted from the
  policy file the docs pointed at.
- Falls back to a built-in pattern list when the YAML is missing or
  unreadable. Enforcement is never silently disabled.
- Case-insensitive matching — `DROP TABLE` and `drop table` both blocked.
- Whitespace normalization — `rm     -rf` matches `rm -rf`.
- Denial messages name the source (`.harness/danger-zone.yml` vs `built-in
  fallback`) and reference the human-approval policy.

**`require-mission.sh`**
- Reads `current.mission` from `.harness/project-state.yml`.
- Resolves the mission file via `.harness/mission-index.yml` or by convention
  (`runs/missions/<id>*.md`).
- Parses `## Allowed Files` and `## Forbidden Files` from the mission
  markdown. Supports glob patterns (`src/**`, `*.ts`), prefix patterns
  (`tests/auth/`), and exact files (`package.json`). Prose-only entries
  (`application source files`) are skipped — they exist as comments, not
  matchers.
- **DENIES** edits matching Forbidden patterns (was: not enforced).
- **DENIES** app-code edits outside the mission's Allowed Files (was: only
  blocked when *no* mission existed at all).
- Bootstrap-mode override: `idea-to-mvp` and `existing-repo-retrofit` projects
  always allow harness-owned paths regardless of mission. The orchestrator
  needs to write state during setup.
- Harness-owned paths under a tight mission → **ASK** (not deny). Gives the
  user a one-click approval for legitimate harness writes.
- App-code edits with no mission set → **ASK** (unchanged from v5).

**`stop-session-note-reminder.sh`**
- Requires the session note to be **tied to the active mission**, not just
  "any note from the last 10 minutes." Matches by filename containing the
  mission ID or by content containing the mission ID.
- Looks back 2 hours instead of 10 minutes for matching notes.
- If no mission is active, reminder-only mode regardless of
  `HARNESS_ENFORCE_SESSION_NOTE`. Bootstrap and intake sessions can't be tied
  to a mission, so hard-blocking them is wrong.

### CLI — `tools/harness check`

Four new validators, on top of the existing control-plane and adapter checks:

1. **Phase schema escape hatches**. A phase may now declare `no_outputs_reason:
   <why>` instead of `outputs:` and `no_gate_reason: <why>` instead of `gate:`.
   This lets analysis-only phases and terminal phases conform to the schema
   without misleading boilerplate.
2. **Agent reference resolution**. Every `agent:` field in every pipeline file
   must resolve to one of:
   - `agents/roles/<name>.md`
   - `adapters/claude-code/.claude/agents/<name>.md`
   - an explicit alias in `.harness/agent-registry.yml`
   Unresolved agents warn (fail under `--strict`).
3. **`current.mission` integrity**. When `project-state.yml` has a mission ID
   set, the check requires a matching `.harness/mission-index.yml` entry with
   a `file:` field pointing to a real path on disk.
4. **Mission-index file links**. Every mission listed in `mission-index.yml`
   must point at a file that exists. Stale entries warn.
5. **Danger-zone health**. `.harness/danger-zone.yml` must be readable, have a
   non-empty `blocked_command_patterns` list, and a non-empty
   `dangerous_operations.require_human_approval` list. Missing means
   `block-danger.sh` falls back to the built-in list — a warning, not silent.

`--strict` already existed; it now covers all of the above warnings.

### Pipeline schema fixes (surfaced by the new check)

- **`pipelines/harness-retrospective.yml`**: three phases (`gather_evidence`,
  `identify_patterns`, `classify_safety`, `stop`) used to lack `outputs` or
  `gate` fields. Each now has either a proper `outputs:` + `gate:` block or
  an explicit `no_outputs_reason:` / `no_gate_reason:` explaining why.
- **`pipelines/lightweight-change.yml`**: previously a policy file misfiled
  as a pipeline (no `phases:`). Now has three phases (`scope-check`,
  `change`, `summary`) wrapping the original policy fields. Original
  `eligible:` / `not_eligible:` / `escalate_to_standard_pipeline_if:` lists
  preserved.

### New files

```
.harness/agent-registry.yml        Optional alias map for agent references
docs/setup/claude-code.md          Install guide (macOS/Linux + Windows)
tests/check_hooks.sh               Hook syntax + behavior tests (16 cases)
tests/test_cli.py                  CLI behavior tests (8 cases, unittest only)
tests/fixtures/                    Sample mission + project-state + danger-zone
tests/README.md                    How to run and extend the suites
CHANGELOG.md                       This file
```

### Constraints honored

- No new pipelines (only schema fixes to existing ones).
- No relaxed danger-zone rules.
- No removed human-approval requirements.
- No production-operation capabilities introduced.
- No expanded folder taxonomy — every new file fits an existing directory.

### Known limitations

- The hook YAML parsers are tolerant awk/grep (no PyYAML dependency in
  hooks). Flow-style YAML in `project-state.yml` or `mission-index.yml` won't
  parse — block style is required. Documented in `docs/setup/claude-code.md`.
- Glob support in `require-mission.sh` uses bash `[[ == ]]` matching. `**`
  behaves like `*` rather than the deep-glob semantics globstar provides. For
  typical patterns (`src/**`, `*.ts`, `tests/auth/**`) this works because bash
  matches `*` across path separators inside `[[ == ]]`. Edge cases like
  `**/foo.ts` may not match every directory depth correctly.
- The new agent-resolution check warns rather than fails by default — flip to
  failure under `--strict`. This is intentional; the harness ships with
  cross-tool role files and Claude-Code-specific subagents whose names don't
  always align 1:1.

### Recommended next hardening pass

1. Consolidate the awk-based YAML scalar readers in the hooks into a single
   `tools/harness-yaml` shim that exits cleanly on parse failure, so all
   hooks share one parser.
2. Add `harness doctor --fix` that auto-creates missing optional files
   (e.g. an empty `agent-registry.yml`) instead of just warning.
3. Promote `tests/check_hooks.sh` and `tests/test_cli.py` into a GitHub Action
   under `adapters/github/`.

---

## [5] — Earlier on 2026-05-25 — Claude Code adapter + CLI

The v4 control plane design was preserved. Three layers of execution were
broken or missing and got repaired. Summarized here; original
`CHANGELOG-v4-to-v5.md` is preserved for the detailed table.

### Claude Code adapter (repaired)

The v4 hooks did not work. Five spec-level bugs verified against the Claude
Code hooks reference. v5 ships:

- Hook scripts that read JSON from stdin via `jq` (was: `$1`).
- Proper `permissionDecision` JSON output (was: `exit 1`, which doesn't
  block).
- A real `.claude/settings.json` wiring every hook to the right event.
- Subagents with YAML frontmatter at `.claude/agents/` (was: bare files at a
  non-discovery path).
- `CLAUDE.md` pointer at project root.
- `SessionStart` hook that preloads `project-state.yml` + `pipeline-state.yml`
  + `mission-index.yml`.

### Pipelines (normalized)

All 7 pipeline files now follow one schema defined in
`docs/specs/SPEC-002-pipeline-schema.md`. Every phase has `id`, `agent`,
`outputs`, `gate.required`. (v5.1 added escape hatches to the `outputs` /
`gate` requirement — see above.)

### Skills layer (new)

`adapters/claude-code/.claude/skills/` ships five Anthropic-format skills
(`harness-bootstrap`, `mission-writer`, `adr-writer`, `session-note-writer`,
`harness-check`).

### Harness CLI (new — was spec-only in v4)

`tools/harness` — single-file Python script, ~600 lines, depends only on
PyYAML. Subcommands: `status`, `check`, `next`, `init`, `validate`, `handoff`.

---

## [4.1] — Earlier — Controlled self-improvement layer

Added an Observe → Log → Measure → Propose → Approve → Improve loop on top of
v4. The harness may learn automatically and propose improvements
automatically, but may only weaken rules with human approval. New files:

- `.harness/learning-policy.yml` — off / assisted / auto_propose /
  auto_apply_safe_only. Default: `assisted`.
- `.harness/metrics.yml`, `.harness/friction-log.yml`,
  `.harness/improvement-backlog.yml`, `.harness/experiments.yml`.
- `.harness/lightweight-mode-policy.yml` — recommends when to drop ceremony.
- `pipelines/harness-retrospective.yml`, `pipelines/lightweight-change.yml`.
- `agents/roles/harness-retrospective.md`,
  `agents/roles/harness-improvement-writer.md`.
- `docs/governance/harness-change-policy.md` — what requires approval.
- Templates for retrospectives, post-mission feedback, improvement
  proposals.

(v5.1 fixed the pipeline-schema conformance of the two v4.1 pipelines —
see above.)

---

## [4] — Baseline

The base control plane:

- `.harness/` state files (`project-state.yml`, `pipeline-state.yml`,
  `mission-index.yml`, `artifact-index.yml`, `context-manifest.yml`,
  `quality-gates.yml`, `danger-zone.yml`, `human-approval-policy.yml`,
  `anti-patterns.yml`, `readiness-score.yml`, `mvp-checklist.yml`).
- 7 pipelines (idea-to-mvp, existing-repo-retrofit, feature-development,
  bugfix, refactor, release-readiness, next-mission-loop). v4 had several as
  bare-string sketches; v5 normalized them.
- `agents/roles/` with cross-tool role definitions.
- `docs/` scaffolding (ADRs, specs, architecture, product, governance,
  testing, security, risks, checklists, runbooks).
- `runs/` for missions, reviews, test reports, session notes,
  retrospectives.
- `adapters/` for cursor, claude-code, codex, github. (v4's claude-code
  adapter was broken — v5 rewrote it.)
- `cli/harness-cli-spec.md` — spec-only in v4; v5 shipped the implementation
  as `tools/harness`.
- `prompts/` for bootstrap and loop entry points.
