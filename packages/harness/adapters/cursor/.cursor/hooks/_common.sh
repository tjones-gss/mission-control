#!/usr/bin/env bash
# Shared helpers for Cursor harness hooks (Git Bash / macOS / Linux).
# Source from hook scripts: source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

set -uo pipefail

emit_allow() {
  echo '{ "permission": "allow" }'
}

emit_deny() {
  local reason="$1"
  if command -v jq >/dev/null 2>&1; then
    jq -n --arg r "$reason" '{
      permission: "deny",
      user_message: $r,
      agent_message: $r
    }'
  else
    printf '{ "permission": "deny", "user_message": %s, "agent_message": %s }\n' \
      "$(json_escape "$reason")" "$(json_escape "$reason")"
  fi
}

emit_ask() {
  local reason="$1"
  if command -v jq >/dev/null 2>&1; then
    jq -n --arg r "$reason" '{
      permission: "ask",
      user_message: $r,
      agent_message: $r
    }'
  else
    printf '{ "permission": "ask", "user_message": %s, "agent_message": %s }\n' \
      "$(json_escape "$reason")" "$(json_escape "$reason")"
  fi
}

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/}"
  printf '"%s"' "$s"
}

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

resolve_project_dir() {
  local raw="${CURSOR_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-${PWD:-.}}}"
  raw="$(normalize_slashes "$raw")"
  if [[ ! -d "$raw" ]]; then
    printf '%s' "$(normalize_drive_letter "$raw")"
    return
  fi
  # Cursor on Windows may pass native C:/... paths; keep that form so native
  # file paths from tool input can be relativized against the same prefix.
  if [[ -n "${CURSOR_PROJECT_DIR:-}${CLAUDE_PROJECT_DIR:-}" && "$raw" =~ ^[a-zA-Z]: ]]; then
    printf '%s' "$(normalize_drive_letter "$raw")"
    return
  fi
  # When env var is set with a POSIX path, keep POSIX form (matches hook tests).
  if [[ -n "${CURSOR_PROJECT_DIR:-}${CLAUDE_PROJECT_DIR:-}" ]]; then
    (cd "$raw" && pwd)
    return
  fi
  # Fallback: Windows-native path for local Cursor when only PWD is available.
  (cd "$raw" && pwd -W 2>/dev/null) || (cd "$raw" && pwd)
}

# Strip project root prefix; accepts Windows or POSIX paths from Cursor.
rel_path_from_project() {
  local file_path="$1"
  local project_dir="$2"
  local rel file_norm proj_norm alt_proj

  file_norm="$(normalize_drive_letter "$(normalize_slashes "$file_path")")"
  proj_norm="$(normalize_drive_letter "$(normalize_slashes "$project_dir")")"
  alt_proj="$proj_norm"

  rel="$file_norm"
  for proj in "$proj_norm" "$alt_proj"; do
    [[ -z "$proj" ]] && continue
    if [[ "$rel" == "$proj"/* ]]; then
      rel="${rel#"$proj"/}"
      break
    fi
    if [[ "$rel" == "$proj" ]]; then
      rel=""
      break
    fi
  done

  rel="${rel#./}"
  printf '%s' "$rel"
}

read_hook_input() {
  local input=""
  input="$(cat 2>/dev/null || true)"
  if [[ -z "$input" ]]; then
    input="{}"
  fi
  printf '%s' "$input"
}

python_cmd() {
  if command -v python3 >/dev/null 2>&1; then
    echo python3
  elif command -v python >/dev/null 2>&1; then
    echo python
  else
    return 1
  fi
}

read_yaml_scalar() {
  local file="$1" top="$2" sub="$3"
  [[ -r "$file" ]] || return 1

  local py
  if py="$(python_cmd 2>/dev/null)"; then
    "$py" - "$file" "$top" "$sub" <<'PY' 2>/dev/null && return 0
import sys
path, top, sub = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    import yaml
    with open(path, encoding="utf-8") as f:
        d = yaml.safe_load(f) or {}
    v = (d.get(top) or {}).get(sub)
    if v is not None:
        print(v)
except Exception:
    sys.exit(1)
PY
  fi

  awk -v top="$top" -v subkey="$sub" '
    BEGIN { in_top = 0 }
    /^[A-Za-z_]/ { in_top = ($0 ~ "^" top ":") ? 1 : 0; next }
    in_top && $0 ~ "^[[:space:]]+" subkey ":" {
      val = $0
      sub("^[[:space:]]+" subkey ":[[:space:]]*", "", val)
      gsub(/^["'\''"]|["'\''"]$/, "", val)
      gsub(/[[:space:]]*#.*$/, "", val)
      print val
      exit
    }
  ' "$file"
}
