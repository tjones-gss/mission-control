#!/usr/bin/env bash
# Harness sessionStart hook: preload .harness/ state into Cursor session context.
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "${HOOK_DIR}/_common.sh"

PROJECT_DIR="$(resolve_project_dir)"

if [[ ! -d "${PROJECT_DIR}/.harness" ]]; then
  exit 0
fi

cat <<EOF
[Harness context — loaded by sessionStart hook]

You are operating inside the Adaptive Agentic Engineering Harness. Follow the
read order in AGENTS.md before any meaningful action. Current state files:

EOF

for f in project-state.yml pipeline-state.yml mission-index.yml; do
  P="${PROJECT_DIR}/.harness/${f}"
  if [[ -f "$P" ]]; then
    echo "=== .harness/${f} ==="
    cat "$P" || true
    echo
  fi
done

MISSION_DIR="${PROJECT_DIR}/runs/missions"
if [[ -d "$MISSION_DIR" ]]; then
  shopt -s nullglob 2>/dev/null || true
  missions=( "$MISSION_DIR"/MISSION-*.md )
  if (( ${#missions[@]} > 0 )); then
    echo "=== Mission files in runs/missions/ ==="
    for m in "${missions[@]}"; do
      echo "${m#"${PROJECT_DIR}/"}"
    done
  fi
fi

exit 0
