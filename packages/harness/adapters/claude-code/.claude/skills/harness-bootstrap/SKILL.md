---
name: harness-bootstrap
description: Use when initializing the harness for a new or existing project. Triggers on "bootstrap the harness", "initialize harness", "set up the harness for this repo", or when .harness/project-state.yml has fields set to "unset". Walks through the mode-specific bootstrap (idea-to-mvp or existing-repo-retrofit), fills in project-state.yml with concrete values, and recommends the first agent and action.
---

# Harness Bootstrap

Initialize the harness control plane for a project so the orchestrator can route work.

## When to use

- A new project has the harness files copied in but `.harness/project-state.yml` still has `unset` values
- An existing repo is being retrofitted and needs a state file
- The user says "bootstrap the harness" or "set this project up"

## Decide the mode

Ask the user (or infer from context) which mode applies:

| Mode | When |
|---|---|
| `idea-to-mvp` | New project from a raw idea |
| `existing-repo-retrofit` | Existing codebase being onboarded |
| `feature-development` | Existing harness-equipped project, adding a feature |
| `bugfix` | Existing harness-equipped project, fixing a bug |
| `refactor` | Existing harness-equipped project, restructuring code |
| `release-readiness` | Pre-release gate |

For `idea-to-mvp` and `existing-repo-retrofit`, this skill does full bootstrap. For the others, this skill just sets `mode` in `project-state.yml` and hands off to the orchestrator.

## Required inputs

Always:
- The user's intent for what they're trying to do
- The current working directory

For `idea-to-mvp`:
- Product idea (one paragraph)
- Target user (one sentence)
- Primary workflow (one sentence)

For `existing-repo-retrofit`:
- Confirmation that no application code may be edited until `controlled-implementation` phase
- The repo's package manifest(s), if any

## Process

### Step 1 — Stack detection (existing-repo-retrofit only)

Detect stack by reading manifest files. Do not run anything that installs dependencies.

```
package.json     → Node/JS stack
pyproject.toml   → Python
go.mod           → Go
Cargo.toml       → Rust
pom.xml          → Java/Maven
build.gradle     → Java/Gradle
*.cbl, *.cob     → COBOL
Gemfile          → Ruby
composer.json    → PHP
```

Record findings under `stack:` in `project-state.yml`. Use `unknown` (not a guess) where evidence is absent.

### Step 2 — Fill project-state.yml

Replace every `unset` value with a real value or `unknown` (only if genuinely unknown). Required fields:

- `project.name` — repo name or product name
- `project.mode` — one of the modes above
- `project.stage` — `intake` for new, `repo-discovery` for retrofit
- `project.owner` — user identifier
- `project.created_at` — today's ISO date
- `stack.*` — detected or `unknown`
- `repo.exists` — `true` / `false`
- `next.recommended_agent` — first agent for this mode
- `next.recommended_action` — first action

### Step 3 — Set pipeline-state.yml

- `pipeline.active` — the pipeline filename (without `.yml`)
- `pipeline.phase` — the first phase id from that pipeline
- `pipeline.gate` — that phase's gate name

### Step 4 — Stop and report

Print:

- What mode is now active
- What pipeline applies
- What's the recommended next action
- What agent should run next (the orchestrator, usually)

## Output

Updated `.harness/project-state.yml` and `.harness/pipeline-state.yml`, plus a one-screen summary the user can act on. Do not start the next phase yourself — that's the orchestrator's job. Stop after bootstrap.

## Hard rules

- Do not invent values. If the user hasn't told you the target user, ask or mark `unknown`.
- Do not edit application code during bootstrap.
- For retrofit mode, do not install dependencies, run migrations, or change behavior.
