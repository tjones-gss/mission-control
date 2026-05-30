#!/usr/bin/env bash
# Harness preToolUse hook: enforce mission scope on file edits (Cursor adapter).
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "${HOOK_DIR}/_common.sh"

INPUT="$(read_hook_input)"
PROJECT_DIR="$(resolve_project_dir)"

if ! command -v jq >/dev/null 2>&1; then
  echo "harness require-mission.sh: jq not installed; passing through." >&2
  emit_allow
  exit 0
fi

FILE_PATH="$(jq -r '
  .tool_input.file_path //
  .tool_input.notebook_path //
  .filePath //
  .path //
  .file_path //
  ""
' <<<"$INPUT" 2>/dev/null || echo "")"

if [[ -z "$FILE_PATH" ]]; then
  emit_allow
  exit 0
fi

REL_PATH="$(rel_path_from_project "$FILE_PATH" "$PROJECT_DIR")"

HARNESS_PREFIXES=(
  ".harness/"
  ".claude/"
  ".cursor/"
  ".github/"
  "docs/"
  "runs/"
  "agents/"
  "pipelines/"
  "prompts/"
  "adapters/"
  "tools/"
  "cli/"
  "tests/"
  "sdk/"
)
HARNESS_FILES=(
  "AGENTS.md"
  "CLAUDE.md"
  "README.md"
  "ARTIFACTS_MANIFEST.md"
  "CHANGELOG.md"
)

is_harness_path() {
  local p="$1"
  for pre in "${HARNESS_PREFIXES[@]}"; do
    if [[ "$p" == "$pre"* ]]; then return 0; fi
  done
  for f in "${HARNESS_FILES[@]}"; do
    if [[ "$p" == "$f" ]]; then return 0; fi
  done
  return 1
}

PROJECT_STATE="${PROJECT_DIR}/.harness/project-state.yml"

PROJECT_MODE="$(read_yaml_scalar "$PROJECT_STATE" "project" "mode" 2>/dev/null || true)"
CURRENT_MISSION="$(read_yaml_scalar "$PROJECT_STATE" "current" "mission" 2>/dev/null || true)"

case "$CURRENT_MISSION" in
  ""|null|None|unset) CURRENT_MISSION="" ;;
esac
case "$PROJECT_MODE" in
  null|None|"") PROJECT_MODE="unset" ;;
esac

BOOTSTRAP_MODE=0
case "$PROJECT_MODE" in
  idea-to-mvp|existing-repo-retrofit) BOOTSTRAP_MODE=1 ;;
esac

MISSION_FILE=""
if [[ -n "$CURRENT_MISSION" ]]; then
  INDEX="${PROJECT_DIR}/.harness/mission-index.yml"
  if [[ -r "$INDEX" ]]; then
    MISSION_FILE_REL="$(awk -v mid="$CURRENT_MISSION" '
      $0 ~ "^[[:space:]]*" mid ":[[:space:]]*$" { in_m = 1; indent_seen = 0; next }
      in_m {
        if (match($0, /^[[:space:]]*/) == 0) next
        cur_indent = RLENGTH
        if (indent_seen == 0 && cur_indent > 0) indent_seen = cur_indent
        if (indent_seen > 0 && cur_indent < indent_seen && $0 ~ /^[[:space:]]*[A-Za-z_][A-Za-z0-9_-]*:/) {
          in_m = 0; next
        }
        if ($0 ~ /^[[:space:]]+file:/) {
          val = $0
          sub(/^[[:space:]]+file:[[:space:]]*/, "", val)
          gsub(/^["'\''"]|["'\''"]$/, "", val)
          gsub(/[[:space:]]*#.*$/, "", val)
          print val; exit
        }
      }
    ' "$INDEX")"
    if [[ -n "$MISSION_FILE_REL" && -f "${PROJECT_DIR}/${MISSION_FILE_REL}" ]]; then
      MISSION_FILE="${PROJECT_DIR}/${MISSION_FILE_REL}"
    fi
  fi
  if [[ -z "$MISSION_FILE" ]]; then
    for cand in "${PROJECT_DIR}/runs/missions/${CURRENT_MISSION}"*.md; do
      [[ -f "$cand" ]] && { MISSION_FILE="$cand"; break; }
    done
  fi
fi

ALLOWED=()
FORBIDDEN=()

parse_mission_section() {
  local file="$1" header="$2"
  awk -v hdr="$header" '
    /^##[[:space:]]/ {
      if ($0 ~ hdr) { in_sec = 1; next }
      else if (in_sec) { in_sec = 0 }
    }
    in_sec && /^-[[:space:]]/ {
      sub(/^-[[:space:]]+/, "")
      sub(/[[:space:]]+$/, "")
      sub(/^["'\''`]/, "")
      sub(/["'\''`]$/, "")
      if (length($0) > 0) print
    }
  ' "$file"
}

if [[ -n "$MISSION_FILE" && -r "$MISSION_FILE" ]]; then
  while IFS= read -r line; do ALLOWED+=("$line"); done < <(parse_mission_section "$MISSION_FILE" "^##[[:space:]]+Allowed Files")
  while IFS= read -r line; do FORBIDDEN+=("$line"); done < <(parse_mission_section "$MISSION_FILE" "^##[[:space:]]+Forbidden Files")
fi

match_pattern() {
  local path="$1" pat="$2"
  if [[ "$pat" == *" "* && "$pat" != */* && "$pat" != *.* ]]; then
    return 1
  fi
  shopt -s globstar nullglob extglob 2>/dev/null || true
  if [[ "$path" == "$pat" ]]; then return 0; fi
  if [[ "$pat" == */ ]]; then
    if [[ "$path" == "$pat"* ]]; then return 0; fi
    return 1
  fi
  if [[ "$pat" == *'/**' ]]; then
    local prefix="${pat%/**}/"
    if [[ "$path" == "$prefix"* ]]; then return 0; fi
    return 1
  fi
  if [[ "$path" == $pat ]]; then return 0; fi
  return 1
}

case "$REL_PATH" in
  ..|../*|*/..|*/../*)
    emit_deny "Blocked: \"$REL_PATH\" contains '..' — use a canonical path."
    exit 0
    ;;
esac

for pat in "${FORBIDDEN[@]}"; do
  if match_pattern "$REL_PATH" "$pat"; then
    emit_deny "Blocked: \"$REL_PATH\" matches Forbidden entry \"$pat\" in mission $CURRENT_MISSION."
    exit 0
  fi
done

if (( ${#ALLOWED[@]} > 0 )); then
  for pat in "${ALLOWED[@]}"; do
    if match_pattern "$REL_PATH" "$pat"; then
      emit_allow
      exit 0
    fi
  done
fi

if is_harness_path "$REL_PATH"; then
  if [[ -z "$CURRENT_MISSION" || $BOOTSTRAP_MODE -eq 1 ]]; then
    emit_allow
    exit 0
  fi
  emit_ask "Harness path \"$REL_PATH\" not in mission $CURRENT_MISSION Allowed Files. Confirm intentional."
  exit 0
fi

if [[ -z "$CURRENT_MISSION" ]]; then
  emit_ask "No current mission set. App code edit: \"$REL_PATH\". Create a mission first or confirm."
  exit 0
fi

emit_deny "Blocked: \"$REL_PATH\" not in mission $CURRENT_MISSION Allowed Files."
exit 0
