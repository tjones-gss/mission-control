# Changelog — v4 → v5

The control plane design from v4 is preserved. Three layers of execution were broken or missing and have been repaired.

## Claude Code adapter (repaired)

**The v4 hooks did not work.** Three spec-level bugs, verified against [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks):

| v4 | v5 |
|---|---|
| Hook scripts read `COMMAND="$1"` | Read JSON from stdin with `jq -r '.tool_input.command'` |
| Scripts used `exit 1` to "block" (non-blocking error per spec) | Use `exit 2` or `hookSpecificOutput.permissionDecision` |
| No `.claude/settings.json` shipped — hooks orphaned | Complete `settings.json` wires every hook to the right event with proper matchers |
| Subagents had no YAML frontmatter — invisible to `/agents` | Proper frontmatter: `name`, `description` (with PROACTIVELY/MUST BE USED triggers), `tools` (least-privilege), `model` |
| Subagents lived in `adapters/claude-code/subagents/` (not on discovery path) | `.claude/agents/` per Claude Code spec |
| No `CLAUDE.md` — Claude Code's auto-load path empty | Thin `CLAUDE.md` pointer to AGENTS.md + subagent/hook overview |
| `SessionStart` not used — orchestrator had to chase state every turn | `session-start-load-state.sh` preloads `.harness/project-state.yml` + `pipeline-state.yml` + `mission-index.yml` into context |
| `require-mission.sh` would block ALL edits | Smart filter — allows edits under `.harness/`, `docs/`, `runs/`, etc. so the orchestrator can update state; only app-code edits trigger the "ask" prompt |

The Stop hook is advisory by default; `HARNESS_ENFORCE_SESSION_NOTE=1` upgrades to blocking via `exit 2`.

## Pipelines (normalized)

All 7 pipeline files now follow one schema, defined in `docs/specs/SPEC-002-pipeline-schema.md`.

| File | v4 | v5 |
|---|---|---|
| `idea-to-mvp.yml` | rich (canonical) | rich (extended with `loop` for build phase) |
| `existing-repo-retrofit.yml` | rich (canonical) | rich (added Claude Code wiring to harness-writing outputs) |
| `feature-development.yml` | **bare strings** | rich, 8 phases with gates |
| `bugfix.yml` | **bare strings** | rich, 7 phases with gates |
| `refactor.yml` | rules + bare strings | rich, 8 phases with gates |
| `next-mission-loop.yml` | `algorithm:` list | rich, 7 phases with gates |
| `release-readiness.yml` | **bare strings** | rich, 5 phases with gates |

Every phase now has `id`, `agent`, `outputs`, `gate.required`. The CLI's `harness check` validates this on every run.

## Skills layer (new)

`adapters/claude-code/.claude/skills/` ships five Anthropic-format skills (folder + `SKILL.md` with YAML frontmatter). Each has a rich `description` field for auto-invocation:

| Skill | Trigger |
|---|---|
| `harness-bootstrap` | New project setup or first-time retrofit |
| `mission-writer` | "Write a mission for X" / slicing a spec |
| `adr-writer` | New architecture decision or backfill |
| `session-note-writer` | End-of-session handoff |
| `harness-check` | Troubleshooting hook firing / install verification |

These complement the four subagents (which take separate context windows for bigger jobs). Skills run in the main thread for short procedures.

## Harness CLI (new — was spec-only in v4)

`tools/harness` — single-file Python script, ~600 lines, depends only on PyYAML.

| Command | Purpose |
|---|---|
| `harness status` | Read-only project summary (human + `--json`) |
| `harness check` | Verify install across control plane, adapter, hooks, pipelines |
| `harness next` | Apply selection policy, recommend next mission |
| `harness init <mode>` | Bootstrap `project-state.yml` + `pipeline-state.yml` |
| `harness validate` | Run mission's validation commands, write report |
| `harness handoff` | Generate session note skeleton (pre-filled from git) |

Exit codes are scripting-friendly (`0` = success, `1` = command-specific failure, `2` = usage error).

## Files added in v5

```
docs/specs/SPEC-002-pipeline-schema.md
pipelines/{bugfix,feature-development,refactor,release-readiness,next-mission-loop}.yml  (rewritten)
pipelines/{idea-to-mvp,existing-repo-retrofit}.yml  (extended)
adapters/claude-code/.claude/settings.json
adapters/claude-code/.claude/hooks/{session-start-load-state,block-danger,require-mission,stop-session-note-reminder}.sh
adapters/claude-code/.claude/agents/{harness-orchestrator,harness-implementer,harness-reviewer,harness-repo-analyzer}.md
adapters/claude-code/.claude/skills/{harness-bootstrap,mission-writer,adr-writer,session-note-writer,harness-check}/SKILL.md
adapters/claude-code/CLAUDE.md
adapters/claude-code/README.md  (rewritten)
tools/harness                   (new — executable CLI)
tools/README.md                 (new)
```

## Files removed / deprecated

```
adapters/claude-code/subagents/  → replaced by .claude/agents/ with frontmatter
adapters/claude-code/hooks/      → replaced by .claude/hooks/ with corrected spec
```

Keep the originals in your repo until you've verified v5 works on your project, then delete.

## Migration

```bash
# 1. Drop in the new adapter:
rm -rf adapters/claude-code/{subagents,hooks}
cp -R v5/adapters/claude-code/.claude .
cp v5/adapters/claude-code/CLAUDE.md .

# 2. Drop in the new pipelines:
cp v5/pipelines/*.yml pipelines/

# 3. Install the CLI:
cp v5/tools/harness /usr/local/bin/harness
chmod +x /usr/local/bin/harness

# 4. Verify:
harness check
```

If `harness check` prints `HEALTHY`, the migration is complete.

## Known follow-ups (not in this release)

- The harness CLI is Python-only. A `harness.ps1` for Windows-without-WSL is a future addition.
- The blocked-Bash patterns in `block-danger.sh` are hardcoded; v6 should load them from `.harness/danger-zone.yml` directly (avoiding the duplication).
- The Codex adapter (`adapters/codex/`) was not touched in v5 — `skills` there are in a different format and should be revisited.
- Cursor adapter (`adapters/cursor/`) was not touched.
- No CI workflow is shipped — recommend adding a GitHub Actions job that runs `harness check --strict` on every PR touching `.harness/` or `pipelines/`.
