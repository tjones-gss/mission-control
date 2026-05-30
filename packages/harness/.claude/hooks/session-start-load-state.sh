#!/usr/bin/env bash
# Harness SessionStart hook: load project-state, pipeline-state, mission-index
# into Claude's context so the orchestrator doesn't have to fetch them turn 1.
#
# Per docs: SessionStart stdout is appended to the conversation as context.
# https://code.claude.com/docs/en/hooks#sessionstart
set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"

# Bail silently if the harness isn't initialized in this project.
if [[ ! -d "${PROJECT_DIR}/.harness" ]]; then
  exit 0
fi

cat <<EOF
[Harness context — loaded by SessionStart hook]

You are operating inside the Adaptive Agentic Engineering Harness. Follow the
read order in AGENTS.md before any meaningful action. Current state files:

EOF

for f in project-state.yml pipeline-state.yml mission-index.yml; do
  P="${PROJECT_DIR}/.harness/${f}"
  if [[ -f "$P" ]]; then
    echo "=== .harness/${f} ==="
    cat "$P"
    echo
  fi
done

# Surface ready missions explicitly (mission-index.yml may be empty on first run)
MISSION_DIR="${PROJECT_DIR}/runs/missions"
if [[ -d "$MISSION_DIR" ]]; then
  if ls "$MISSION_DIR"/MISSION-*.md >/dev/null 2>&1; then
    echo "=== Mission files in runs/missions/ ==="
    ls -1 "$MISSION_DIR"/MISSION-*.md | sed "s|${PROJECT_DIR}/||"
  fi
fi

exit 0
