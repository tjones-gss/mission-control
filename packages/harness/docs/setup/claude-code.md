# Claude Code Setup Guide

How to wire the Adaptive Agentic Engineering Harness into a project so Claude
Code picks up the hooks, subagents, and CLAUDE.md.

The harness ships the Claude Code adapter under `adapters/claude-code/`. That
directory is a **template** — its contents need to be copied (or symlinked)
to your project root so Claude Code's discovery paths find them.

## What gets installed

```
your-project/
├── .claude/
│   ├── settings.json              ← wires the hooks
│   ├── hooks/
│   │   ├── session-start-load-state.sh
│   │   ├── block-danger.sh
│   │   ├── require-mission.sh
│   │   └── stop-session-note-reminder.sh
│   ├── agents/                    ← subagents (discovered by /agents)
│   │   ├── harness-orchestrator.md
│   │   ├── harness-implementer.md
│   │   ├── harness-reviewer.md
│   │   └── harness-repo-analyzer.md
│   └── skills/
│       └── ... (5 skill folders)
└── CLAUDE.md                      ← Claude Code's auto-loaded context
```

The `.harness/` directory and everything else stay where they are at the repo
root — they're tool-neutral.

## Quick install (all platforms)

From the project root:

```bash
./tools/harness install claude
```

On Windows PowerShell:

```powershell
.\tools\claude.ps1
```

Then verify in Claude Code with `/hooks`.

## macOS / Linux (manual)

```bash
# From your project root, with the harness checked out at ./harness/
cp -r harness/adapters/claude-code/.claude .
cp    harness/adapters/claude-code/CLAUDE.md .

# Make hooks executable. THIS IS REQUIRED — Claude Code will skip hooks that
# don't have the +x bit and you'll get a silent enforcement gap.
chmod +x .claude/hooks/*.sh

# Verify
./harness/tools/harness check
```

A clean install reports `HEALTHY` or `DEGRADED` (warnings only). `BROKEN`
means hooks aren't wired correctly — re-run the steps above.

## Windows

Claude Code's hooks are bash scripts. Windows users have two supported paths:

### What is Git Bash?

**Git Bash** is the terminal that ships with [Git for Windows](https://git-scm.com/download/win).
It runs `bash` and Unix-style shell scripts (like the harness hooks) on Windows.
You do **not** run the Claude Code desktop app *inside* Git Bash — Claude stays a
normal GUI app. What matters is that **Claude Code can find `bash` on your PATH**
when it runs hook scripts. The easiest fix on Windows:

1. Install Git for Windows (if missing).
2. Add `C:\Program Files\Git\bin` to your **user** PATH (Settings → Environment Variables).
3. Restart Claude Code and open this project.

Optional: open a Git Bash window to run `harness check` or the `claude` CLI — same PATH idea.

### Option A: Git Bash (recommended for most)

Git for Windows ships a `bash.exe` that Claude Code can invoke. Use Git Bash
as your terminal:

```bash
# In Git Bash, from project root:
cp -r harness/adapters/claude-code/.claude .
cp    harness/adapters/claude-code/CLAUDE.md .
chmod +x .claude/hooks/*.sh
./harness/tools/harness check
```

`chmod +x` works under Git Bash via the `core.fileMode` git config. If git was
installed with the default settings, the +x bit will be tracked correctly.

### Option B: WSL (Windows Subsystem for Linux)

If your project lives under WSL, treat it as the macOS/Linux flow above. Claude
Code installed on Windows can use WSL paths when launched from a WSL terminal.

### What does *not* work on plain Windows PowerShell

- `cmd.exe` / `powershell.exe` cannot execute `.sh` files directly.
- Hooks invoked from a native Windows shell will silently fail (Claude Code
  treats a non-zero-from-shell-loader the same as "no hook ran").

If you must operate from PowerShell, you can still copy the files:

```powershell
# From project root in PowerShell:
Copy-Item -Recurse -Force .\harness\adapters\claude-code\.claude .
Copy-Item -Force .\harness\adapters\claude-code\CLAUDE.md .
```

But the hooks won't fire unless Claude Code can find bash. Make sure your
`PATH` includes `C:\Program Files\Git\bin\` (Git Bash) before launching
Claude Code, or run Claude Code from inside Git Bash / WSL.

## What the hooks need to run

| Dependency | Purpose                          | If missing                          |
| ---------- | -------------------------------- | ----------------------------------- |
| `bash` 4+  | Hook execution                   | No enforcement; Claude Code logs a hook-not-found error |
| `jq`       | Parse Claude Code's JSON payload | Hook prints a warning to stderr and exits 0 (fail-open — see below) |
| `python3`  | Optional fallback YAML parsing in `require-mission.sh` | Falls back to awk; still works for block-style YAML |
| `awk`      | Tolerant YAML scalar reads in hooks | The hook can't read project-state; treats all paths as "no mission set" |

### Installing `jq`

- **macOS**: `brew install jq`
- **Debian/Ubuntu**: `sudo apt-get install jq`
- **Windows (Git Bash)**: `choco install jq` or download from <https://jqlang.org/download/>

### Fail-open behavior

When `jq` is unavailable, every hook prints a one-line warning to stderr and
exits 0. This is intentional — **a missing tool should never silently block
Claude Code's normal flow** — but it does mean enforcement is off. Run
`./tools/harness check` after install; it surfaces the missing-jq case as a
warning in the "Claude Code adapter" section.

If you need strict-by-default enforcement (CI, regulated environments), make
`jq` a hard requirement in your project setup script and gate Claude Code
launches on its presence.

## Verifying the install

Run the harness check from your project root:

```bash
./tools/harness check
```

You should see four sections of green checks:

```
Control plane           [ok] all .harness/*.yml parse
Claude Code adapter     [ok] settings.json + 4 hooks + 4 subagents
Functional smoke tests  [ok] block-danger denies / allows
Pipelines               [ok] all *.yml files have valid phase schemas
Agent references        [ok] every pipeline agent resolves
```

For end-to-end verification, run the hook test suite:

```bash
./tests/check_hooks.sh
```

This builds a throwaway fixture project and exercises every hook through 12
behavioral scenarios. See `tests/README.md`.

## Updating the harness

When a new harness version drops, re-copy the adapter and verify:

```bash
# Backup project-specific changes first
cp .claude/settings.json .claude/settings.json.bak

# Pull new version, re-copy adapter
cp -r harness-new/adapters/claude-code/.claude/* .claude/
cp harness-new/adapters/claude-code/CLAUDE.md .

# Re-apply executable bit (cp may strip it)
chmod +x .claude/hooks/*.sh

# Re-verify
./tools/harness check
```

If you've customized `.claude/settings.json` (e.g. added project-specific
hooks), merge those changes back from the `.bak` file. The harness's
`settings.json` is designed to be a minimal starting point — extending it is
expected.

## Troubleshooting

**Hooks don't fire**: Run `/hooks` inside Claude Code to see what's wired. If
your hooks show up but don't trigger, check `chmod +x` on each. If they don't
show up at all, `.claude/settings.json` isn't at your project root — copy it.

**Hook fires but always allows**: Almost always means `jq` isn't installed.
Run `./tools/harness check` — it explicitly reports missing jq.

**`require-mission.sh` blocks something it shouldn't**: The hook reads
`current.mission` from `.harness/project-state.yml` and parses `## Allowed
Files` / `## Forbidden Files` from the mission file. Verify both with:

```bash
cat .harness/project-state.yml | grep -A1 '^current:'
cat runs/missions/MISSION-*.md | grep -A10 '## Allowed Files'
```

If `current.mission` is set but the file or its sections are missing/typo'd,
the hook will treat the project as "mission set, no Allowed Files" and deny
all app-code edits. Fix the mission file.

**Session-note enforcement is too aggressive**: Default is advisory (exits 0,
prints reminder). Hard enforcement requires `HARNESS_ENFORCE_SESSION_NOTE=1`
in the environment Claude Code runs from. Unset it to fall back to advisory.

**Windows path issues in hooks**: Hooks treat `CLAUDE_PROJECT_DIR` as a Unix
path internally. Under Git Bash this is handled transparently; under WSL it
should be a `/mnt/c/...` path. If you see paths like `C:\Users\...` in hook
output, you're running hooks from cmd/powershell directly — switch to Git
Bash or WSL.
