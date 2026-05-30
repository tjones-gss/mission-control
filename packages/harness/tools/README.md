# Harness CLI

Single-file Python script that exposes the harness control plane as commands.

## Install

The CLI is a self-contained script. Three options:

### Option 1 — Add to PATH

```bash
# From the harness root, copy to somewhere on PATH:
sudo cp tools/harness /usr/local/bin/harness
sudo chmod +x /usr/local/bin/harness
```

### Option 2 — Symlink into PATH

```bash
ln -s "$(pwd)/tools/harness" ~/.local/bin/harness
chmod +x tools/harness
```

### Option 3 — Run directly

```bash
chmod +x tools/harness
./tools/harness status
```

## Dependencies

- **Python 3.10+** — uses `str | None` type hints
- **PyYAML** — `pip install pyyaml` (most distros: `sudo apt install python3-yaml`)
- **jq** — only required by `harness check`'s functional smoke tests; install per the Claude Code adapter README
- **git** — `harness handoff` calls `git diff` and `git rev-parse` to fill in branch/files; missing git just leaves those fields blank

## Commands

### `harness status`

Read-only summary of the project. Prints project name, mode, pipeline, active mission, readiness score, blockers, and recommended next action.

```bash
harness status              # human-readable, colorized
harness status --json       # machine-readable for scripts
```

### `harness setup`

Wire **core harness** on this machine: PyYAML if needed, Cursor hooks (no SDK), Claude adapter, then `harness check`.

```bash
harness setup
harness setup --skip-claude    # Cursor only
harness setup --skip-cursor    # Claude only
```

Agent-oriented guide: `prompts/setup-workstation.md` · Human guide: `docs/setup/quick-start.md`

### `harness install claude`

Copy the Claude Code adapter (`.claude/` + `CLAUDE.md`) to the project root and make hooks executable. On Windows, uses Git Bash for `chmod`.

```bash
harness install claude
```

Windows shortcut:

```powershell
.\tools\claude.ps1          # install
.\tools\claude.ps1 check    # harness check
```

### `harness check`

Verify the harness is installed and wired correctly. Four layers:

1. **Control plane** — every `.harness/*.yml` exists and parses
2. **Claude Code adapter** — `.claude/settings.json` parses, all referenced hook scripts exist and are executable, subagents have valid frontmatter
3. **Functional smoke tests** — feeds sample stdin to each hook and asserts the right response
4. **Pipelines** — every `pipelines/*.yml` matches the canonical schema

Exit codes:
- `0` — healthy (or degraded with warnings only, unless `--strict`)
- `1` — broken (at least one failure) or degraded with `--strict`

```bash
harness check               # exit 0 unless there are failures
harness check --strict      # exit 1 on any warning too
```

### `harness next`

Apply the mission-index `selection_policy` and recommend the next mission to pick up. Does not modify state.

```bash
harness next                # human-readable
harness next --json         # machine-readable
```

### `harness init <mode>`

Bootstrap `project-state.yml` and `pipeline-state.yml` for a mode. Sets the active pipeline, the first phase, the first gate, and the recommended agent. Preserves existing fields that aren't "unset".

```bash
harness init idea-to-mvp
harness init existing-repo-retrofit
harness init feature-development
harness init bugfix
harness init refactor
harness init release-readiness

harness init bugfix --dry-run   # preview without writing
harness init bugfix --skip-cursor   # init without installing Cursor hooks
```

### `harness install cursor`

Install the Cursor adapter (copy `adapters/cursor/.cursor` into the project) and pip packages for the Cursor SDK (`harness_core`, `sdk/python[cursor,dev]`). Runs post-install checks and hook smoke tests when bash is available.

```bash
harness install cursor
```

### `harness validate`

Run the validation commands from the active mission file. Writes a markdown report to `runs/test-reports/<mission-id>.md`. Exit 1 if any command fails.

The active mission is taken from `project-state.yml:current.mission`. If that's unset and exactly one mission has status `ready`/`in-progress`/`review`, that one is used.

```bash
harness validate
```

### `harness handoff`

Generate a session note skeleton at `runs/session-notes/<date>-<mission-id>.md`. Pre-fills the branch and changed files from `git`. The rest is placeholders for the agent or human to fill in.

```bash
harness handoff
harness handoff --mission MISSION-014-checkout-flow
```

## Global flags

- `-C <path>` — run as if in `<path>` instead of the current directory
- `-h` — help

## Exit codes (summary)

| Code | Meaning |
|---|---|
| `0` | success |
| `1` | command-specific failure (validation failed, check broken, etc.) |
| `2` | usage error (missing input, bad mode, not in a harness project) |

## Testing the install

```bash
# After installing on a project with the harness control plane:
harness check        # should print HEALTHY
harness status       # should show project state
harness init idea-to-mvp --dry-run   # preview without committing
```
