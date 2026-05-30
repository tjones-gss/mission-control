#!/usr/bin/env bash
# Harness PreToolUse hook: enforce mission scope on Edit/Write tool calls.
# Wired by .claude/settings.json on PreToolUse with matcher
# "Edit|Write|MultiEdit|NotebookEdit".
#
# Spec: https://docs.claude.com/en/docs/claude-code/hooks
#
# v5.1 changes (hardening):
# - Reads active mission from .harness/project-state.yml `current.mission`.
# - Resolves the mission file via .harness/mission-index.yml or by convention
#   (runs/missions/<id>*.md), and parses its `## Allowed Files` and
#   `## Forbidden Files` sections.
# - DENIES (hard block) edits matching Forbidden patterns.
# - DENIES app-code edits outside the mission's Allowed Files.
# - Harness-owned paths (.harness/, docs/, runs/, agents/, pipelines/, prompts/,
#   adapters/, tools/, cli/, .claude/, .github/, plus AGENTS.md / CLAUDE.md /
#   README.md / ARTIFACTS_MANIFEST.md / CHANGELOG.md) are:
#     - always ALLOWED when project mode is a bootstrap mode (idea-to-mvp or
#       existing-repo-retrofit) — the orchestrator must be able to write state.
#     - always ALLOWED when no mission is set — same reason.
#     - ASKED when a mission is set but does not list them in Allowed Files,
#       so the user can confirm a benign harness write inside a tight mission.
# - Glob-style patterns from the mission are supported (e.g. "src/**",
#   "package.json", "docs/specs/*.md"). Plain prefixes ("src/") and bare names
#   also work. Prose-only entries ("application source files") are skipped.
set -euo pipefail

INPUT="$(cat)"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"

normalize_slashes() {
  printf '%s' "$1" | tr '\\' '/'
}

normalize_drive_letter() {
  local p="$1" drive
  if [[ "$p" =~ ^/[a-zA-Z]/ ]]; then
    drive="$(printf '%s' "${p:1:1}" | tr '[:lower:]' '[:upper:]')"
    printf '%s:%s' "$drive" "${p:2}"
    return
  fi
  if [[ "$p" =~ ^[a-zA-Z]: ]]; then
    drive="$(printf '%s' "${p:0:1}" | tr '[:lower:]' '[:upper:]')"
    printf '%s:%s' "$drive" "${p:2}"
    return
  fi
  printf '%s' "$p"
}

if ! command -v jq >/dev/null 2>&1; then
  echo "harness require-mission.sh: jq not installed; passing through." >&2
  exit 0
fi

FILE_PATH="$(jq -r '.tool_input.file_path // .tool_input.notebook_path // ""' <<<"$INPUT")"

# No path → nothing to enforce.
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# Make the path relative to PROJECT_DIR for pattern matching.
PROJECT_DIR="$(normalize_drive_letter "$(normalize_slashes "$PROJECT_DIR")")"
REL_PATH="$(normalize_drive_letter "$(normalize_slashes "$FILE_PATH")")"
if [[ "$REL_PATH" == "$PROJECT_DIR"/* ]]; then
  REL_PATH="${REL_PATH#"$PROJECT_DIR"/}"
elif [[ "$REL_PATH" == "$PROJECT_DIR" ]]; then
  REL_PATH=""
fi

# ----- harness-owned paths (always candidates to allow) -----
HARNESS_PREFIXES=(
  ".harness/"
  ".claude/"
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

# ----- read project mode & current mission from project-state.yml -----
PROJECT_STATE="${PROJECT_DIR}/.harness/project-state.yml"

# Tolerant scalar reader. Walks a flat dotted key path without PyYAML.
# Usage: read_yaml_scalar <file> <top-key> <sub-key>
read_yaml_scalar() {
  local file="$1" top="$2" sub="$3"
  [[ -r "$file" ]] || return 1
  # v5.1.1: `sub` is a reserved word in mawk (the default awk on Debian/Ubuntu)
  # and cannot be used as a -v assignment. Pass the sub-key as `subkey` instead.
  # Without this rename the awk fallback silently produces no output on mawk,
  # which downgrades enforcement to ASK on every app-code edit when PyYAML is
  # unavailable.
  python3 - "$file" "$top" "$sub" <<'PY' 2>/dev/null || awk -v top="$top" -v subkey="$sub" '
    BEGIN { in_top = 0 }
    /^[A-Za-z_]/ { in_top = ($0 ~ "^" top ":") ? 1 : 0; next }
    in_top && $0 ~ "^[[:space:]]+" subkey ":" {
      val = $0
      sub("^[[:space:]]+" subkey ":[[:space:]]*", "", val)
      gsub(/^["'\'']|["'\'']$/, "", val)
      gsub(/[[:space:]]*#.*$/, "", val)
      print val
      exit
    }
  ' "$file"
import sys
path, top, sub = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    import yaml
    with open(path) as f:
        d = yaml.safe_load(f) or {}
    v = (d.get(top) or {}).get(sub)
    if v is not None:
        print(v)
except Exception:
    sys.exit(1)
PY
}

PROJECT_MODE="$(read_yaml_scalar "$PROJECT_STATE" "project" "mode" || true)"
CURRENT_MISSION="$(read_yaml_scalar "$PROJECT_STATE" "current" "mission" || true)"

# Normalize null/unset
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

# ----- locate the active mission file -----
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
        # Stop on a less-indented line that looks like a new key.
        if (indent_seen > 0 && cur_indent < indent_seen && $0 ~ /^[[:space:]]*[A-Za-z_][A-Za-z0-9_-]*:/) {
          in_m = 0; next
        }
        if ($0 ~ /^[[:space:]]+file:/) {
          val = $0
          sub(/^[[:space:]]+file:[[:space:]]*/, "", val)
          gsub(/^["'\'']|["'\'']$/, "", val)
          gsub(/[[:space:]]*#.*$/, "", val)
          print val; exit
        }
      }
    ' "$INDEX")"
    if [[ -n "$MISSION_FILE_REL" && -f "${PROJECT_DIR}/${MISSION_FILE_REL}" ]]; then
      MISSION_FILE="${PROJECT_DIR}/${MISSION_FILE_REL}"
    fi
  fi
  # Fallback by convention: runs/missions/<id>*.md
  if [[ -z "$MISSION_FILE" ]]; then
    for cand in "${PROJECT_DIR}/runs/missions/${CURRENT_MISSION}"*.md; do
      [[ -f "$cand" ]] && { MISSION_FILE="$cand"; break; }
    done
  fi
fi

# ----- parse Allowed / Forbidden Files from the mission markdown -----
ALLOWED=()
FORBIDDEN=()

parse_mission_section() {
  # parse_mission_section <file> <section-header-regex>
  local file="$1" header="$2"
  awk -v hdr="$header" '
    /^##[[:space:]]/ {
      if ($0 ~ hdr) { in_sec = 1; next }
      else if (in_sec) { in_sec = 0 }
    }
    in_sec && /^-[[:space:]]/ {
      sub(/^-[[:space:]]+/, "")
      sub(/[[:space:]]+$/, "")
      # v5.1.1: strip a single surrounding quote or backtick so quoted entries
      # match (see require-mission.sh CHANGELOG for examples).
      sub(/^["'\''`]/, "")
      sub(/["'\''`]$/, "")
      if (length($0) > 0) print
    }
  ' "$file"
}

if [[ -n "$MISSION_FILE" && -r "$MISSION_FILE" ]]; then
  mapfile -t ALLOWED   < <(parse_mission_section "$MISSION_FILE" "^##[[:space:]]+Allowed Files")
  mapfile -t FORBIDDEN < <(parse_mission_section "$MISSION_FILE" "^##[[:space:]]+Forbidden Files")
fi

# ----- pattern matching -----
match_pattern() {
  # match_pattern <relpath> <pattern>
  local path="$1" pat="$2"
  # Skip prose-only entries (no slash, no dot, contains space). These are
  # descriptive English ("application source files") and must never match.
  if [[ "$pat" == *" "* && "$pat" != */* && "$pat" != *.* ]]; then
    return 1
  fi
  # Enable globstar for ** patterns.
  shopt -s globstar nullglob extglob
  # Exact match
  if [[ "$path" == "$pat" ]]; then return 0; fi
  # Prefix-style: pattern ends with /
  if [[ "$pat" == */ ]]; then
    if [[ "$path" == "$pat"* ]]; then return 0; fi
    return 1
  fi
  if [[ "$pat" == *'/**' ]]; then
    local prefix="${pat%/**}/"
    if [[ "$path" == "$prefix"* ]]; then return 0; fi
    return 1
  fi
  # Glob match using bash [[ == ]] (supports * and ?; ** treated as *)
  # shellcheck disable=SC2053
  if [[ "$path" == $pat ]]; then return 0; fi
  return 1
}

deny() {
  local reason="$1"
  jq -n --arg r "$reason" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $r
    }
  }'
}

ask() {
  local reason="$1"
  jq -n --arg r "$reason" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: $r
    }
  }'
}

# 0) Reject paths containing '..' as a path segment. The hook does
#    substring/glob matching without canonicalization, so a target like
#    "src/auth/../billing/x.ts" would match Allowed `src/auth/**` while
#    actually writing to a Forbidden file. Refuse and force the caller to
#    send a clean path; no Forbidden bypass via traversal.
case "$REL_PATH" in
  ..|../*|*/..|*/../*)
    deny "Blocked by harness path policy. Target \"$REL_PATH\" contains a '..' segment. The harness requires canonical paths because '..' can mask a Forbidden target behind an Allowed prefix. Resolve the path and retry."
    exit 0
    ;;
esac

# 1) Forbidden hard-block always wins (even for harness paths).
for pat in "${FORBIDDEN[@]}"; do
  if match_pattern "$REL_PATH" "$pat"; then
    deny "Blocked by mission scope. Target \"$REL_PATH\" matches a Forbidden Files entry (\"$pat\") in mission $CURRENT_MISSION. If this edit is genuinely required, stop and amend the mission's Forbidden Files list with human approval, then retry."
    exit 0
  fi
done

# 2) Allowed Files — if the mission lists them and the path matches, allow.
if (( ${#ALLOWED[@]} > 0 )); then
  for pat in "${ALLOWED[@]}"; do
    if match_pattern "$REL_PATH" "$pat"; then
      exit 0
    fi
  done
fi

# 3) Harness-owned path handling.
if is_harness_path "$REL_PATH"; then
  if [[ -z "$CURRENT_MISSION" || $BOOTSTRAP_MODE -eq 1 ]]; then
    exit 0
  fi
  ask "Harness-owned path \"$REL_PATH\" is not in mission $CURRENT_MISSION's Allowed Files. Confirm this write is intentional (e.g., session note, state update), or extend the mission."
  exit 0
fi

# 4) App code with no mission → ASK.
if [[ -z "$CURRENT_MISSION" ]]; then
  ask "Harness rule: no current mission set in .harness/project-state.yml. Application code edit requested: \"$REL_PATH\". Create a mission from agents/templates/mission-template.md and set current.mission, or confirm one-shot to proceed."
  exit 0
fi

# 5) App code with mission, no Allowed match → DENY.
deny "Blocked by mission scope. Target \"$REL_PATH\" is not in mission $CURRENT_MISSION's Allowed Files. If the change belongs in this mission, amend the Allowed Files list first; otherwise create a new mission."
exit 0
