# Adaptive Agentic Engineering Harness v5.3.0

A control plane for AI coding agents. It gives the agent clear rails — what to
read, what to write, when to stop, when to ask a human — without dictating
*how* to write code.

v5.1 is a hardening pass on v5. It does not redesign anything. It tightens
enforcement, plugs validation gaps, and ships the test/setup scaffolding v5
left implicit. See `CHANGELOG.md` for the full history; this README covers
what the harness is and how to use it.

## What it does

```
Observe → Plan → Implement → Validate → Review → Note → Stop
                    ↑                                    ↓
                    └──────────── one mission ───────────┘
```

The harness enforces five things:

1. **Mission scope**. App-code edits require an active mission with explicit
   Allowed/Forbidden file lists. Edits outside scope are denied at the hook
   layer before the model sees them succeed.
2. **Dangerous commands**. A configurable block-list (rm -rf, DROP TABLE,
   prod deploys, etc.) denies destructive shell commands case-insensitively,
   with the policy file named in the denial message.
3. **Quality gates**. Every phase of every pipeline has explicit `required`
   conditions before transitioning. The CLI validates the schema; the
   reviewer subagent validates the work.
4. **Human approval**. Production operations, schema-breaking changes, and
   safety-weakening edits all require explicit human approval via
   `.harness/human-approval-policy.yml`.
5. **Session memory**. Each meaningful session ends with a note tied to the
   active mission, scaffolded by `tools/harness handoff`.

## Layout

```
.harness/             Control-plane state (YAML files Claude reads first)
agents/roles/         Cross-tool role definitions (orchestrator, reviewer, ...)
pipelines/            7 named workflows (idea-to-mvp, bugfix, refactor, ...)
docs/                 ADRs, specs, architecture, governance, runbooks
runs/                 Missions, reviews, test reports, session notes
adapters/             Tool-specific wrappers (claude-code, cursor, codex, github)
prompts/              Bootstrap and loop entry points
tools/harness         CLI — status, check, next, init, validate, handoff
tests/                Hook + CLI test suites
AGENTS.md             Prime directive for AI agents (read first)
CLAUDE.md             Claude Code entry point (lives at root after install)
```

## Modes

Pick the right pipeline by setting `project.mode` in `.harness/project-state.yml`
or running `./tools/harness init <mode>`:

| Mode                       | When to use                                   |
| -------------------------- | --------------------------------------------- |
| `idea-to-mvp`              | Greenfield project, no code yet               |
| `existing-repo-retrofit`   | Wrapping an existing repo without changing it |
| `feature-development`      | Adding a feature with proper specs            |
| `bugfix`                   | Reproducing and fixing a bug                  |
| `refactor`                 | Behavior-preserving changes                   |
| `release-readiness`        | Pre-deploy review and rollback planning       |

Plus `lightweight-change` for low-risk docs/typo work (with explicit
escalation rules) and `harness-retrospective` for periodic self-improvement.

## Getting started

### Simplest: tell your agent

Clone this repo, open it in Cursor or Claude Code, and paste:

```text
Set up the Adaptive Agentic Engineering Harness on this machine — core control plane only, not the experimental SDK/MCP stack. Follow prompts/setup-workstation.md exactly, run the commands yourself, and give me a short pass/fail report.
```

### Or one command

```bash
git clone https://github.com/tjones-gss/adaptive-agentic-engineering-harness.git
cd adaptive-agentic-engineering-harness
python tools/harness setup
```

Windows: `.\tools\claude.ps1` (defaults to `setup`). See `docs/setup/quick-start.md`.

### Using the harness on another project

```bash
cp -r adaptive-agentic-engineering-harness/. your-project/
cd your-project
python tools/harness setup
python tools/harness init feature-development   # pick your mode
```

SDK / MCP / `run-loop` are optional — see `docs/setup/cursor-sdk.md`, not required for missions and hooks.

## CLI quick reference

```bash
./tools/harness setup               # wire this machine (Cursor + Claude hooks)
./tools/harness status              # what mode, what phase, what mission
./tools/harness check               # validate the install
./tools/harness check --strict      # warnings become failures
./tools/harness next                # apply selection policy, recommend next mission
./tools/harness init <mode>         # bootstrap project-state + pipeline-state
./tools/harness install cursor      # Cursor hooks + SDK pip packages
./tools/harness init <mode> --skip-cursor  # init without Cursor hooks
./tools/harness validate            # run mission's validation commands, write report
./tools/harness handoff             # generate session-note skeleton (pre-filled from git)
```

JSON output available on `status` and `next` with `--json`.

## Claude Code hooks

The Claude Code adapter ships four hooks that enforce harness rules at the
tool-call boundary:

| Hook                              | Event       | What it does                            |
| --------------------------------- | ----------- | --------------------------------------- |
| `session-start-load-state.sh`     | SessionStart | Preloads `.harness/` state into context |
| `block-danger.sh`                 | PreToolUse (Bash) | Denies dangerous commands         |
| `require-mission.sh`              | PreToolUse (Edit/Write) | Enforces mission scope     |
| `stop-session-note-reminder.sh`   | Stop        | Requires/reminds session note           |

The hooks read JSON from stdin per the Claude Code spec, emit
`permissionDecision: "deny" | "ask" | "allow"` via stdout, and fail-open with
a stderr warning when `jq` is missing.

Set `HARNESS_ENFORCE_SESSION_NOTE=1` in your environment to upgrade the Stop
hook from advisory to blocking (exit 2).

## Quality gates and human approval

What requires human approval lives in `.harness/human-approval-policy.yml`.
What can never happen automatically lives in `.harness/danger-zone.yml`. The
harness's self-improvement layer (v4.1) can propose changes to either, but
applying them requires explicit human approval per
`docs/governance/harness-change-policy.md`.

The Stop hook, the danger-zone hook, and the mission hook are the **three
layers that catch most failure modes**. They are not the only line of defense
— the reviewer subagent (`harness-reviewer`) does a strict PR-grade review
before any mission completes — but they're the cheapest layer to enforce
mechanically.

## Self-improvement (v4.1 layer)

The harness can learn from real usage without silently weakening itself.

```yaml
# .harness/learning-policy.yml
off                       # no learning
assisted                  # log and propose only (default)
auto_propose              # actively generate improvement proposals
auto_apply_safe_only      # only apply safe doc clarifications
```

After 5–10 missions, or after a painful session, run:

```bash
# Trigger the retrospective pipeline
cat prompts/run-harness-retrospective.md | your-agent
```

It produces a `runs/retrospectives/YYYY-MM-DD-harness-retrospective.md` file
and proposes changes in `.harness/improvement-backlog.yml`. Nothing applies
without your approval.

## Testing

The harness ships its own test suites:

```bash
./tests/check_hooks.sh      # 16 hook tests (syntax + behavior)
python3 tests/test_cli.py   # 8 CLI tests (exit codes + state changes)
```

See `tests/README.md` for what's covered and how to add cases.

## Cursor SDK

Run one mission loop programmatically (local or cloud):

```bash
# Install adapter + packages (see docs/setup/cursor-sdk.md)
./tools/install-cursor-adapter.sh          # or .\tools\install-cursor-adapter.ps1 on Windows
python -m harness_orchestrator run-loop --cwd . --dry-run
```

See [sdk/README.md](sdk/README.md), [docs/setup/cursor-sdk.md](docs/setup/cursor-sdk.md),
[docs/setup/cursor-sdk-verification.md](docs/setup/cursor-sdk-verification.md),
and [docs/roadmap/cursor-sdk-roadmap.md](docs/roadmap/cursor-sdk-roadmap.md).

## Compatibility

| Adapter      | Status        | Path                                    |
| ------------ | ------------- | --------------------------------------- |
| Claude Code  | First-class   | `adapters/claude-code/`                 |
| Cursor       | Hooks + rules | `adapters/cursor/` (see `docs/setup/cursor-sdk.md`) |
| Codex        | Skills-based  | `adapters/codex/skills/`                |
| GitHub       | PR templates  | `adapters/github/`                      |

The harness state (`.harness/`, `agents/roles/`, `pipelines/`, `docs/`,
`runs/`) is tool-neutral. Adapters wire the same control plane into each
agent's discovery surface.

## Core principles

- **Move fast inside clear rails.** The harness should make work safer, not
  slower.
- **Evidence over assertion.** Every non-trivial claim in an output is
  labeled fact / inference / assumption.
- **One mission, one session.** Sessions end when the mission ends.
  Long-running sessions are an antipattern.
- **Stop on uncertainty.** If scope is unclear, context is missing, or
  approval is needed, the agent stops and surfaces it.
- **Reviewable units.** Every change is small enough to be reviewed in one
  sitting.
- **No silent safety drift.** Rules can be relaxed; doing so always requires
  human approval.

## Where to start reading

| If you want to…                          | Start at                              |
| ----------------------------------------- | ------------------------------------- |
| Understand the agent's contract          | `AGENTS.md`                           |
| Wire it into Claude Code                 | `docs/setup/claude-code.md`           |
| Wire it into Cursor                    | `docs/setup/cursor-sdk.md`            |
| Run SDK orchestrator                   | `sdk/README.md`                       |
| See the full version history             | `CHANGELOG.md`                        |
| Understand the pipeline schema           | `docs/specs/SPEC-002-pipeline-schema.md` |
| Tweak quality gates                      | `.harness/quality-gates.yml`          |
| Configure dangerous-command blocking     | `.harness/danger-zone.yml`            |
| Run the harness CLI                      | `tools/README.md`                     |
