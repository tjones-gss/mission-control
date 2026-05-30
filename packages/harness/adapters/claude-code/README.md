# Claude Code Adapter (v2)

Drop-in scaffolding to run the Adaptive Agentic Engineering Harness inside Claude Code with **actual enforcement**, not just advisory text.

## What's in this folder

```
adapters/claude-code/
├── README.md                          (this file)
├── CLAUDE.md                          (copy to project root — auto-loaded by Claude Code)
└── .claude/                           (copy entire dir to project root)
    ├── settings.json                  (wires hooks to events)
    ├── hooks/
    │   ├── session-start-load-state.sh    (SessionStart — preloads .harness state)
    │   ├── block-danger.sh                (PreToolUse Bash — denies dangerous commands)
    │   ├── require-mission.sh             (PreToolUse Edit/Write — gates app-code edits)
    │   └── stop-session-note-reminder.sh  (Stop — reminds to write session note)
    └── agents/
        ├── harness-orchestrator.md
        ├── harness-implementer.md
        ├── harness-reviewer.md
        └── harness-repo-analyzer.md
```

## Install

From the harness root, into a project that already has the harness control plane (`.harness/`, `AGENTS.md`, etc.) at its root:

```bash
PROJECT=/path/to/your-project
cp -R adapters/claude-code/.claude "$PROJECT/"
cp adapters/claude-code/CLAUDE.md "$PROJECT/"
chmod +x "$PROJECT"/.claude/hooks/*.sh
```

Then in Claude Code, verify:

- `/hooks` — should list 4 hook entries (1 SessionStart, 2 PreToolUse, 1 Stop)
- `/agents` — should list the 4 `harness-*` subagents

## Dependencies

- **`jq`** — used by hooks to parse JSON from stdin. Install:
  - macOS: `brew install jq`
  - Debian/Ubuntu: `sudo apt install jq`
  - Windows: `choco install jq` or use Git Bash + WSL
  - If `jq` is missing, the hooks degrade gracefully (pass-through with a stderr warning).
- **`bash`** — POSIX shell. On Windows use Git Bash or WSL.

## Hook reference

| Script | Event | Matcher | Behavior |
|---|---|---|---|
| `session-start-load-state.sh` | `SessionStart` | `startup\|resume\|clear` | Prints `.harness/project-state.yml`, `pipeline-state.yml`, and `mission-index.yml` into Claude's context |
| `block-danger.sh` | `PreToolUse` | `Bash` | Reads `tool_input.command`; on match against blocked patterns returns `permissionDecision: "deny"` with a reason |
| `require-mission.sh` | `PreToolUse` | `Edit\|Write\|MultiEdit\|NotebookEdit` | Allows edits under harness-owned paths; for app-code paths without an active mission, returns `permissionDecision: "ask"` |
| `stop-session-note-reminder.sh` | `Stop` | (none) | Advisory by default; set `HARNESS_ENFORCE_SESSION_NOTE=1` to block stops until a session note exists |

## Customization

- **Blocked Bash patterns**: edit `BLOCKED_PATTERNS` in `.claude/hooks/block-danger.sh`. Keep in sync with `.harness/danger-zone.yml:blocked_command_patterns`.
- **Allowed edit prefixes**: edit `ALLOWED_PREFIXES` in `.claude/hooks/require-mission.sh`.
- **Session note window**: change `-mmin -10` in `.claude/hooks/stop-session-note-reminder.sh`.
- **Subagent tools**: tighten or loosen the `tools:` line in each `.claude/agents/*.md` frontmatter. Omit `tools:` to inherit the main thread's tools.

## What changed from v1

The v1 Claude Code adapter looked correct but was non-functional. v2 fixes three spec-level bugs identified against [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks):

1. **Hooks read `$1` instead of stdin JSON.** Claude Code passes the event payload as JSON on stdin, not as positional arguments. All v2 scripts use `jq` against stdin.
2. **Hooks used `exit 1` to "block".** Only `exit 2` is blocking; `exit 1` is a non-blocking error and the action proceeds. v2 uses either `exit 2` (Stop strict mode) or the modern `hookSpecificOutput.permissionDecision` JSON output (PreToolUse), which is preferred because it gives reasons back to Claude and lets users override with "ask".
3. **No `settings.json` shipped.** Without it, hook scripts never fired. v2 ships a complete `settings.json` keyed to `${CLAUDE_PROJECT_DIR}` so it works regardless of working directory.

The v1 subagents lacked the required YAML frontmatter (`name`, `description`, optional `tools` and `model`) and lived in `adapters/claude-code/subagents/`, which is not on Claude Code's discovery path. v2 fixes the frontmatter (with `PROACTIVELY` / `MUST BE USED` keywords for auto-invocation), assigns least-privilege tool sets, and locates them in `.claude/agents/` where `/agents` finds them.

## Testing the install

Quick smoke test after install:

```bash
# 1. Try a blocked command — should be denied
echo '{"tool_input":{"command":"rm -rf /tmp/test"}}' | .claude/hooks/block-danger.sh

# 2. Try a safe command — should exit 0 silently
echo '{"tool_input":{"command":"ls -la"}}' | .claude/hooks/block-danger.sh

# 3. Try editing an app file with no mission — should "ask"
echo '{"tool_input":{"file_path":"'$PWD'/src/app.ts"}}' | .claude/hooks/require-mission.sh

# 4. Try editing a harness file — should exit 0 silently
echo '{"tool_input":{"file_path":"'$PWD'/.harness/project-state.yml"}}' | CLAUDE_PROJECT_DIR=$PWD .claude/hooks/require-mission.sh
```
