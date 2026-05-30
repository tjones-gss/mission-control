# Project Conventions (Claude Code)

This project uses the **Adaptive Agentic Engineering Harness**. The cross-tool prime directive lives in `AGENTS.md`; this file is the Claude Code entry point.

## Required read order

Before any meaningful action, read in this order:

1. `AGENTS.md` — prime directive and operating modes
2. `.harness/project-state.yml` — mode, stack, current artifacts
3. `.harness/pipeline-state.yml` — phase, gate, allowed transitions
4. `.harness/context-manifest.yml` — what to read per mode
5. `.harness/quality-gates.yml` — what must be true before edits/review/PR/deploy
6. `.harness/danger-zone.yml` — operations that require human approval

The **SessionStart hook** preloads (1)–(3) into context automatically, so you start each session aware of the state. The hook is wired in `.claude/settings.json`.

## Subagents

Available via `/agents` or auto-delegation:

- **`harness-orchestrator`** — Use first. Routes work to the right pipeline stage. Never edits code.
- **`harness-implementer`** — Executes one mission. Strict scope adherence.
- **`harness-reviewer`** — Read-only PR review. Use after every change.
- **`harness-repo-analyzer`** — Observe-before-edit inspection for existing repos.

## Enforcement (via hooks)

The `.claude/settings.json` wires three hooks that enforce harness rules:

- **Dangerous Bash commands** (`rm -rf`, destructive SQL, prod deploys, etc.) are denied at the `PreToolUse` event with a reason fed back to the model.
- **Edits to application code** require a mission file in `runs/missions/`. Edits to harness-owned paths (`.harness/`, `docs/`, `runs/`, `pipelines/`, etc.) are always allowed so the orchestrator can update state. App-code edits without a mission trigger an "ask" permission prompt.
- **Session notes** are reminded on Stop. Set `HARNESS_ENFORCE_SESSION_NOTE=1` in your environment to make this blocking instead of advisory.

To verify hook wiring, run `/hooks` in Claude Code.

## Validation commands

This is a template. Replace with this project's actual commands in your missions:

```bash
# npm test && npm run lint && npm run typecheck && npm run build
```

For COBOL/ERP and other non-Node stacks, use the project's actual build/test invocation in `runs/missions/MISSION-*.md` under `## Validation Commands`.
