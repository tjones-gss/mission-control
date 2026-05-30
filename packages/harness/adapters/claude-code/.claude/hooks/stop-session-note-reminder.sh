#!/usr/bin/env bash
# Harness Stop hook: enforce a session note that's tied to the active mission.
#
# Spec: https://docs.claude.com/en/docs/claude-code/hooks
#
# v5.1 changes (hardening):
# - Reads active mission from .harness/project-state.yml `current.mission`.
# - If a mission is active, requires a note that references that mission, by
#   either filename (e.g., 2026-05-25-MISSION-007.md) or by content (the
#   mission ID appears anywhere in the note body).
# - If no mission is active, falls back to reminder-only mode (never a hard
#   block). Bootstrap and intake sessions legitimately produce no note tied to
#   a mission.
#
# Enforcement levels:
#   default      → advisory reminder to stderr; exit 0 (does not block stop)
#   HARNESS_ENFORCE_SESSION_NOTE=1 → exit 2 to block stop when a mission is
#                                    active and no matching note is found
set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
SESSION_DIR="${PROJECT_DIR}/runs/session-notes"
PROJECT_STATE="${PROJECT_DIR}/.harness/project-state.yml"

# --- locate current mission id (tolerant; no PyYAML dependency) ---
CURRENT_MISSION=""
if [[ -r "$PROJECT_STATE" ]]; then
  CURRENT_MISSION="$(awk '
    BEGIN { in_top = 0 }
    /^[A-Za-z_]/ { in_top = ($0 ~ /^current:/) ? 1 : 0; next }
    in_top && /^[[:space:]]+mission:/ {
      sub(/^[[:space:]]+mission:[[:space:]]*/, "")
      gsub(/^["'\'']|["'\'']$/, "")
      gsub(/[[:space:]]*#.*$/, "")
      print; exit
    }
  ' "$PROJECT_STATE" || true)"
fi
case "$CURRENT_MISSION" in
  ""|null|None|unset) CURRENT_MISSION="" ;;
esac

# --- find a session note from the last 10 minutes ---
RECENT_NOTE=""
if [[ -d "$SESSION_DIR" ]]; then
  RECENT_NOTE="$(find "$SESSION_DIR" -maxdepth 2 -name '*.md' -mmin -10 2>/dev/null | head -1 || true)"
fi

# --- decide whether the note is "tied to the mission" ---
matches_mission() {
  local note="$1" mid="$2"
  [[ -z "$note" || -z "$mid" ]] && return 1
  # By filename
  if [[ "$(basename "$note")" == *"$mid"* ]]; then return 0; fi
  # By content (case-insensitive, fast grep)
  if grep -qiF -- "$mid" "$note" 2>/dev/null; then return 0; fi
  return 1
}

if [[ -z "$CURRENT_MISSION" ]]; then
  # No active mission — reminder-only mode regardless of HARNESS_ENFORCE_SESSION_NOTE.
  if [[ -n "$RECENT_NOTE" ]]; then
    exit 0
  fi
  echo "[harness reminder] No session note in runs/session-notes/ from the last 10 minutes. If meaningful work happened, write one from runs/templates/session-note-template.md before stopping. (No mission active — this is advisory only.)"
  exit 0
fi

# Mission is active. We require a note that ties to it.
if [[ -n "$RECENT_NOTE" ]] && matches_mission "$RECENT_NOTE" "$CURRENT_MISSION"; then
  exit 0
fi

# Look further back — maybe the note was written earlier but still applies.
ANY_NOTE=""
if [[ -d "$SESSION_DIR" ]]; then
  while IFS= read -r f; do
    if matches_mission "$f" "$CURRENT_MISSION"; then ANY_NOTE="$f"; break; fi
  done < <(find "$SESSION_DIR" -maxdepth 2 -name '*.md' -mmin -120 2>/dev/null)
fi

if [[ -n "$ANY_NOTE" ]]; then
  exit 0
fi

REASON="Harness: no session note tied to mission $CURRENT_MISSION found in runs/session-notes/ (looked back 2h). Write one before stopping — filename or content should reference $CURRENT_MISSION. Use runs/templates/session-note-template.md or run 'tools/harness handoff' to scaffold."

if [[ "${HARNESS_ENFORCE_SESSION_NOTE:-0}" == "1" ]]; then
  echo "$REASON" >&2
  exit 2  # Blocks Claude from stopping; stderr is shown to Claude.
fi

echo "[harness reminder] $REASON"
exit 0
