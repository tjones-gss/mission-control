#!/usr/bin/env bash
# Harness stop hook: require session note tied to active mission (Cursor adapter).
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "${HOOK_DIR}/_common.sh"

PROJECT_DIR="$(resolve_project_dir)"
SESSION_DIR="${PROJECT_DIR}/runs/session-notes"
PROJECT_STATE="${PROJECT_DIR}/.harness/project-state.yml"

CURRENT_MISSION="$(read_yaml_scalar "$PROJECT_STATE" "current" "mission" 2>/dev/null || true)"
case "$CURRENT_MISSION" in
  ""|null|None|unset) CURRENT_MISSION="" ;;
esac

RECENT_NOTE=""
if [[ -d "$SESSION_DIR" ]]; then
  RECENT_NOTE="$(find "$SESSION_DIR" -maxdepth 2 -name '*.md' -mmin -10 2>/dev/null | head -1 || true)"
fi

matches_mission() {
  local note="$1" mid="$2"
  [[ -z "$note" || -z "$mid" ]] && return 1
  if [[ "$(basename "$note")" == *"$mid"* ]]; then return 0; fi
  if grep -qiF -- "$mid" "$note" 2>/dev/null; then return 0; fi
  return 1
}

if [[ -z "$CURRENT_MISSION" ]]; then
  if [[ -n "$RECENT_NOTE" ]]; then
    exit 0
  fi
  echo "[harness reminder] No session note in the last 10 minutes. Write one if meaningful work occurred."
  exit 0
fi

if [[ -n "$RECENT_NOTE" ]] && matches_mission "$RECENT_NOTE" "$CURRENT_MISSION"; then
  exit 0
fi

ANY_NOTE=""
if [[ -d "$SESSION_DIR" ]]; then
  while IFS= read -r f; do
    if matches_mission "$f" "$CURRENT_MISSION"; then ANY_NOTE="$f"; break; fi
  done < <(find "$SESSION_DIR" -maxdepth 2 -name '*.md' -mmin -120 2>/dev/null || true)
fi

if [[ -n "$ANY_NOTE" ]]; then
  exit 0
fi

REASON="Harness: no session note tied to mission $CURRENT_MISSION in runs/session-notes/. Run 'tools/harness handoff' to scaffold one."

if [[ "${HARNESS_ENFORCE_SESSION_NOTE:-0}" == "1" ]]; then
  echo "$REASON" >&2
  exit 2
fi

echo "[harness reminder] $REASON"
exit 0
