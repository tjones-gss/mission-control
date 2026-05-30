#!/usr/bin/env bash
# Harness beforeShellExecution hook: block dangerous shell commands.
# Cursor format: returns { "permission": "deny|allow", ... }
#
# v5.3 changes (FAIL CLOSED + stronger matcher):
# - REMOVED the old "jq missing -> emit_allow" pass-through. On a machine
#   without jq (the Windows default) the hook used to silently ALLOW every
#   command, including `rm -rf /` and `DROP TABLE`. It now enforces with or
#   without jq, using the jq-free helpers in _common.sh (emit_deny/emit_allow
#   already construct valid JSON via json_escape when jq is absent).
# - Command extraction works without jq via a sed/grep fallback that reads the
#   "command" / ".tool_input.command" JSON string field (handles escaped quotes
#   reasonably). jq is used when present.
# - If the command genuinely cannot be extracted from non-empty input, we DENY
#   (fail closed). Well-formed non-matching commands still get an allow.
# - Added regex rules (DANGER_REGEXES) alongside the substring patterns to catch
#   common destructive VARIANTS: rm with -r AND -f in any order/spelling,
#   `find ... -delete`, `git clean -fd/-fx`, `> /dev/sd*`, `dd of=/dev/...`,
#   `mkfs`, `chmod -R 777 /`, and the classic fork bomb.
#
# HONEST SCOPE: best-effort ACCIDENT prevention, not an adversarial sandbox. A
# determined user can obfuscate past these regexes (base64, indirection, alt
# binaries). The real control is OS-level sandboxing / least-privilege creds.
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
# Fail closed if the shared helpers cannot be loaded. Without this guard a missing
# or unreadable _common.sh would leave emit_deny/emit_allow undefined and the
# script would fall through to the implicit allow at end of file (fail OPEN).
if ! source "${HOOK_DIR}/_common.sh" 2>/dev/null; then
  printf '{ "permission": "deny", "user_message": "harness block-danger hook init failed: could not load _common.sh; denying to fail closed.", "agent_message": "harness block-danger hook init failed: could not load _common.sh; denying to fail closed." }\n'
  exit 0
fi

INPUT="$(read_hook_input)"
PROJECT_DIR="$(resolve_project_dir)"
DANGER_YAML="${PROJECT_DIR}/.harness/danger-zone.yml"

HAVE_JQ=0
if command -v jq >/dev/null 2>&1; then
  HAVE_JQ=1
fi

# --- Command extraction ----------------------------------------------------
# With jq: read .command, falling back to .tool_input.command. Without jq: a
# tolerant grep extractor for the "command" string field (handles escaped
# quotes). Returns non-zero ONLY when no command field exists at all, so the
# caller can fail closed; an explicitly empty command returns 0 + empty string.
extract_command() {
  local input="$1"
  if (( HAVE_JQ )); then
    local out
    out="$(jq -er '.command // .tool_input.command // empty' <<<"$input" 2>/dev/null)"
    if (( $? == 0 )); then
      printf '%s' "$out"
      return 0
    fi
    if jq -e . >/dev/null 2>&1 <<<"$input"; then
      printf '%s'   # valid JSON, field absent -> empty command
      return 0
    fi
    return 1
  fi

  # --- jq-free path -------------------------------------------------------
  local raw
  raw="$(printf '%s' "$input" \
    | tr -d '\n' \
    | grep -oE '"command"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' \
    | tail -n1)"
  if [[ -z "$raw" ]]; then
    return 1
  fi
  local val="${raw#*:}"
  val="${val#"${val%%[![:space:]]*}"}"   # ltrim
  val="${val#\"}"
  val="${val%\"}"
  # Unescape common JSON escapes back to literal characters for matching.
  val="${val//\\\"/\"}"
  val="${val//\\n/$'\n'}"
  val="${val//\\t/$'\t'}"
  val="${val//\\\//\/}"
  val="${val//\\\\/\\}"
  printf '%s' "$val"
  return 0
}

FALLBACK_PATTERNS=(
  'rm -rf'
  'drop table'
  'drop database'
  'delete from'
  'truncate table'
  'terraform apply'
  'terraform destroy'
  'kubectl delete'
  'vercel --prod'
  'railway down'
  'stripe live'
  'firebase deploy --only hosting:prod'
  'aws s3 rb'
  'gcloud sql instances delete'
)

# Regex rules (best-effort accident prevention) applied to the normalized,
# lowercased command IN ADDITION to the substring patterns. Each entry is
# "label|regex"; the regex is an ERE evaluated by bash [[ =~ ]]. Best-effort
# only — easily bypassed by obfuscation. OS sandboxing is the real control.
DANGER_REGEXES=(
  'rm: recursive+force rm|(^|[^a-z])rm([[:space:]]+-[a-z]*r[a-z]*[[:space:]]+-[a-z]*f|[[:space:]]+-[a-z]*f[a-z]*[[:space:]]+-[a-z]*r|[[:space:]]+-[a-z]*(rf|fr)[a-z]*|[[:space:]].*(--recursive|--force).*(--force|--recursive))'
  'find -delete|(^|[^a-z])find([[:space:]]+.*)?[[:space:]]-delete([[:space:]]|$)'
  'git clean -f+dirs|(^|[^a-z])git[[:space:]]+clean([[:space:]]+.*)?[[:space:]]-([a-z]*f[a-z]*[dx]|[dx][a-z]*f)([[:space:]]|$)'
  'git clean --force|(^|[^a-z])git[[:space:]]+clean([[:space:]]+.*)?(--force).*(-d|-x|--ignored)'
  'overwrite block device|>[[:space:]]*/dev/(sd[a-z]|nvme[0-9]|disk[0-9]|hd[a-z]|vd[a-z])'
  'dd to device|(^|[^a-z])dd[[:space:]].*of=[[:space:]]*/dev/'
  'mkfs|(^|[^a-z])mkfs(\.[a-z0-9]+)?[[:space:]]'
  'chmod -R 777 root|(^|[^a-z])chmod[[:space:]]+(-[a-z]*r[a-z]*[[:space:]]+)?(--recursive[[:space:]]+)?0?777[[:space:]]+/($|[[:space:]])'
  'fork bomb|:\(\)[[:space:]]*\{[[:space:]]*:[[:space:]]*\|[[:space:]]*:[[:space:]]*&[[:space:]]*\}[[:space:]]*;[[:space:]]*:'
)

PATTERNS=()
load_patterns_from_yaml() {
  [[ -r "$DANGER_YAML" ]] || return 1
  local in_block=0 line stripped val
  while IFS= read -r line; do
    line="${line%$'\r'}"   # tolerate CRLF line endings (Windows default)
    if [[ "$line" =~ ^blocked_command_patterns: ]]; then
      in_block=1
      continue
    fi
    if (( in_block )); then
      if [[ "$line" =~ ^[a-zA-Z_] ]]; then
        break
      fi
      stripped="${line#"${line%%[![:space:]]*}"}"
      if [[ "$stripped" =~ ^-[[:space:]]*(.+)$ ]]; then
        val="${BASH_REMATCH[1]}"
        val="${val#\"}"; val="${val%\"}"
        val="${val#\'}"; val="${val%\'}"
        val="$(printf '%s' "$val" | tr '[:upper:]' '[:lower:]')"
        PATTERNS+=("$val")
      fi
    fi
  done < "$DANGER_YAML"
  [[ ${#PATTERNS[@]} -gt 0 ]]
}

if ! load_patterns_from_yaml; then
  PATTERNS=("${FALLBACK_PATTERNS[@]}")
  SOURCE="built-in fallback (danger-zone.yml unreadable)"
else
  SOURCE=".harness/danger-zone.yml"
fi

# --- Extract the command (FAIL CLOSED on unparseable non-empty input) ------
if ! COMMAND="$(extract_command "$INPUT")"; then
  emit_deny "Blocked by harness danger-zone policy: could not parse the command from the hook payload, denying to fail closed (source: ${SOURCE})."
  exit 0
fi

CMD_LC="$(printf '%s' "$COMMAND" | tr '[:upper:]' '[:lower:]')"
CMD_NORM="$(printf '%s' "$CMD_LC" | tr -s '[:space:]' ' ')"

deny_with() {
  local pattern="$1" source="$2"
  if (( HAVE_JQ )); then
    jq -n \
      --arg p "$pattern" \
      --arg c "$COMMAND" \
      --arg s "$source" \
    '{
      permission: "deny",
      user_message: (
        "Blocked by harness danger-zone policy (source: " + $s + "). " +
        "Matched pattern: \"" + $p + "\". Command: " + $c
      ),
      agent_message: (
        "Blocked by harness danger-zone policy (source: " + $s + ").\n" +
        "Matched pattern: \"" + $p + "\"\n" +
        "Command was: " + $c + "\n" +
        "If intentional and approved, follow .harness/human-approval-policy.yml."
      )
    }' 2>/dev/null || emit_deny "Blocked by harness danger-zone policy (matched: ${pattern})."
  else
    emit_deny "Blocked by harness danger-zone policy (source: ${source}). Matched pattern: \"${pattern}\". Command was: ${COMMAND}. If intentional and approved, follow .harness/human-approval-policy.yml."
  fi
}

# 1) Substring patterns (literal, case-insensitive, whitespace-normalized).
for pattern in "${PATTERNS[@]}"; do
  PAT_NORM="$(printf '%s' "$pattern" | tr -s '[:space:]' ' ')"
  if [[ "$CMD_NORM" == *"$PAT_NORM"* ]]; then
    deny_with "$pattern" "$SOURCE"
    exit 0
  fi
done

# 2) Regex rules (destructive variants). Best-effort accident prevention.
for rule in "${DANGER_REGEXES[@]}"; do
  label="${rule%%|*}"
  regex="${rule#*|}"
  if [[ "$CMD_NORM" =~ $regex ]]; then
    deny_with "$label" "$SOURCE (regex rule)"
    exit 0
  fi
done

emit_allow
exit 0
