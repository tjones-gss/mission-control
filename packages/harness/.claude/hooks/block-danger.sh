#!/usr/bin/env bash
# Harness PreToolUse hook: block dangerous Bash commands.
# Wired by .claude/settings.json on PreToolUse with matcher "Bash".
#
# Spec: https://docs.claude.com/en/docs/claude-code/hooks
# - Reads JSON event payload from stdin
# - On match, returns hookSpecificOutput.permissionDecision = "deny" with reason
# - On miss, exits 0 with no output (normal permission flow proceeds)
#
# v5.1 changes (hardening):
# - Loads blocked patterns from .harness/danger-zone.yml when present
# - Falls back to a safe built-in list if the YAML is missing or unreadable
# - Case-insensitive matching (e.g., "DROP TABLE" matches "drop table")
# - Whitespace normalization (multiple spaces / tabs collapsed for matching)
# - Denial message references the danger-zone policy file
#
# v5.3 changes (FAIL CLOSED + stronger matcher):
# - REMOVED the old "jq missing -> exit 0" pass-through. On a machine without
#   jq (the Windows default) the hook used to silently ALLOW every command,
#   including `rm -rf /` and `DROP TABLE`. It now enforces with or without jq.
# - Command extraction works without jq via a sed/grep fallback that reads the
#   ".tool_input.command" JSON string field (handles escaped quotes reasonably).
# - Deny-decision JSON is emitted without jq when jq is absent, using a small
#   bash JSON escaper. When jq is present the original jq-built JSON is kept.
# - If the command genuinely cannot be extracted from non-empty input, we DENY
#   (fail closed) instead of allowing. Well-formed non-matching commands still
#   pass through (exit 0) as before.
# - Added regex rules (DANGER_REGEXES) alongside the substring patterns to catch
#   common destructive VARIANTS: rm with -r AND -f in any order/spelling,
#   `find ... -delete`, `git clean -fd/-fx`, `> /dev/sd*`, `dd of=/dev/...`,
#   `mkfs`, `chmod -R 777 /`, and the classic fork bomb.
#
# HONEST SCOPE: this is best-effort ACCIDENT prevention, not an adversarial
# sandbox. A determined user can still obfuscate a command past these regexes
# (base64, variable indirection, here-docs, alternate binaries, etc.). The real
# control is OS-level sandboxing / least-privilege credentials. This hook exists
# to stop fat-finger mistakes and obvious foot-guns from a cooperating agent.
set -uo pipefail

INPUT="$(cat)"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
DANGER_YAML="${PROJECT_DIR}/.harness/danger-zone.yml"

HAVE_JQ=0
if command -v jq >/dev/null 2>&1; then
  HAVE_JQ=1
fi

# --- JSON string escaper (used only when jq is absent) ---------------------
# Escapes a string so it can be embedded inside a JSON double-quoted value.
# Handles backslash, double-quote, newline, carriage return, and tab. This is
# deliberately minimal but correct for the command/reason strings we emit.
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\t'/\\t}"
  s="${s//$'\r'/}"
  s="${s//$'\n'/\\n}"
  printf '%s' "$s"
}

# --- Command extraction ----------------------------------------------------
# With jq: read .tool_input.command. Without jq: a tolerant sed/grep extractor
# for the "command" string under "tool_input". Returns non-zero ONLY when the
# field is genuinely absent/unparseable (so the caller can fail closed); an
# explicitly empty command ("command":"") returns 0 with an empty string.
extract_command() {
  local input="$1"
  if (( HAVE_JQ )); then
    local out
    out="$(jq -er '.tool_input.command // empty' <<<"$input" 2>/dev/null)"
    local rc=$?
    if (( rc == 0 )); then
      printf '%s' "$out"
      return 0
    fi
    # jq parsed but field missing/null OR JSON was invalid. Distinguish:
    if jq -e . >/dev/null 2>&1 <<<"$input"; then
      # Valid JSON, field simply absent or null/empty -> empty command.
      printf '%s'
      return 0
    fi
    return 1
  fi

  # --- jq-free path -------------------------------------------------------
  # Pull the value of the "command" key (the one nested under tool_input).
  # We match: "command" : "<value with escaped chars>"
  # The value regex allows escaped quotes (\") and any non-quote char.
  local raw
  raw="$(printf '%s' "$input" \
    | tr -d '\n' \
    | grep -oE '"command"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' \
    | tail -n1)"
  if [[ -z "$raw" ]]; then
    # No "command" field found at all. If the input is empty/whitespace or not
    # JSON-ish, treat as unparseable so the caller fails closed.
    return 1
  fi
  # Strip the   "command" : "   prefix and trailing quote.
  local val="${raw#*:}"
  val="${val#"${val%%[![:space:]]*}"}"   # ltrim
  val="${val#\"}"                         # leading quote
  val="${val%\"}"                         # trailing quote
  # Unescape the common JSON escapes back to literal characters for matching.
  val="${val//\\\"/\"}"
  val="${val//\\n/$'\n'}"
  val="${val//\\t/$'\t'}"
  val="${val//\\\//\/}"
  val="${val//\\\\/\\}"
  printf '%s' "$val"
  return 0
}

# --- Deny emission ---------------------------------------------------------
emit_deny() {
  local pattern="$1" command="$2" source="$3"
  if (( HAVE_JQ )); then
    jq -n \
      --arg p "$pattern" \
      --arg c "$command" \
      --arg s "$source" \
    '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: (
          "Blocked by harness danger-zone policy (source: " + $s + ").\n" +
          "Matched pattern: \"" + $p + "\"\n" +
          "Command was: " + $c + "\n" +
          "If this operation is intentional and approved, follow .harness/human-approval-policy.yml: request explicit human approval and retry in an interactive turn. Do not bypass this hook silently."
        )
      }
    }'
  else
    local reason
    reason="Blocked by harness danger-zone policy (source: ${source}).\nMatched pattern: \"${pattern}\"\nCommand was: ${command}\nIf this operation is intentional and approved, follow .harness/human-approval-policy.yml: request explicit human approval and retry in an interactive turn. Do not bypass this hook silently."
    printf '{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "%s" } }\n' \
      "$(json_escape "$reason")"
  fi
}

# Built-in fallback list. Kept in sync with .harness/danger-zone.yml so behavior
# is reasonable when the YAML file is missing, unreadable, or new patterns are
# being added. These are LOWERCASE — matching is case-insensitive.
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
# lowercased command IN ADDITION to the substring patterns above. These catch
# common destructive VARIANTS that a flat substring list misses. Each entry is
# "label|regex"; the regex is an ERE evaluated by bash [[ =~ ]].
#
# NOTE: best-effort only — easily bypassed by obfuscation. OS sandboxing is the
# real control. See the file header.
DANGER_REGEXES=(
  # rm with BOTH recursive and force in any order/spelling:
  #   rm -rf | rm -fr | rm -r -f | rm -f -r | rm -R ... -f | --recursive --force
  'rm: recursive+force rm|(^|[^a-z])rm([[:space:]]+-[a-z]*r[a-z]*[[:space:]]+-[a-z]*f|[[:space:]]+-[a-z]*f[a-z]*[[:space:]]+-[a-z]*r|[[:space:]]+-[a-z]*(rf|fr)[a-z]*|[[:space:]].*(--recursive|--force).*(--force|--recursive))'
  # find ... -delete
  'find -delete|(^|[^a-z])find([[:space:]]+.*)?[[:space:]]-delete([[:space:]]|$)'
  # git clean with force AND (dirs or ignored): -fd, -fdx, -f -d, --force -d ...
  'git clean -f+dirs|(^|[^a-z])git[[:space:]]+clean([[:space:]]+.*)?[[:space:]]-([a-z]*f[a-z]*[dx]|[dx][a-z]*f)([[:space:]]|$)'
  'git clean --force|(^|[^a-z])git[[:space:]]+clean([[:space:]]+.*)?(--force).*(-d|-x|--ignored)'
  # redirect into a raw block device: > /dev/sd*, /dev/nvme*, /dev/disk*
  'overwrite block device|>[[:space:]]*/dev/(sd[a-z]|nvme[0-9]|disk[0-9]|hd[a-z]|vd[a-z])'
  # dd writing to a device
  'dd to device|(^|[^a-z])dd[[:space:]].*of=[[:space:]]*/dev/'
  # making a filesystem (destroys the target)
  'mkfs|(^|[^a-z])mkfs(\.[a-z0-9]+)?[[:space:]]'
  # recursive chmod 777 on a root-ish path
  'chmod -R 777 root|(^|[^a-z])chmod[[:space:]]+(-[a-z]*r[a-z]*[[:space:]]+)?(--recursive[[:space:]]+)?0?777[[:space:]]+/($|[[:space:]])'
  # classic bash fork bomb  :(){ :|:& };:
  'fork bomb|:\(\)[[:space:]]*\{[[:space:]]*:[[:space:]]*\|[[:space:]]*:[[:space:]]*&[[:space:]]*\}[[:space:]]*;[[:space:]]*:'
)

# Try to read blocked_command_patterns from the YAML. Tolerant parser: grep the
# block (no PyYAML dependency for a hook). If it fails for any reason we fall
# back to FALLBACK_PATTERNS — never silently disable enforcement.
PATTERNS=()
load_patterns_from_yaml() {
  [[ -r "$DANGER_YAML" ]] || return 1
  # Extract list items under blocked_command_patterns: until next top-level key.
  # Matches lines like:  - "rm -rf"   or   - rm -rf
  local in_block=0 line stripped val
  while IFS= read -r line; do
    line="${line%$'\r'}"   # tolerate CRLF line endings (Windows default)
    if [[ "$line" =~ ^blocked_command_patterns: ]]; then
      in_block=1
      continue
    fi
    if (( in_block )); then
      # Stop if we hit another top-level key (no leading whitespace, ends with ':')
      if [[ "$line" =~ ^[a-zA-Z_] ]]; then
        break
      fi
      stripped="${line#"${line%%[![:space:]]*}"}"   # ltrim
      if [[ "$stripped" =~ ^-[[:space:]]*(.+)$ ]]; then
        val="${BASH_REMATCH[1]}"
        # Strip surrounding quotes
        val="${val#\"}"; val="${val%\"}"
        val="${val#\'}"; val="${val%\'}"
        # Lowercase for case-insensitive matching
        val="${val,,}"
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
  # We received input we could not parse into a command. Rather than allow it
  # (the old fail-open behavior), deny so a malformed/unknown payload cannot
  # slip a dangerous command past us.
  emit_deny "<unparseable hook input>" "${INPUT:-<empty>}" "fail-closed (could not extract command)"
  exit 0
fi

# Normalize the command for matching:
#  - lowercase
#  - collapse runs of whitespace (spaces/tabs) into a single space
CMD_LC="${COMMAND,,}"
CMD_NORM="$(printf '%s' "$CMD_LC" | tr -s '[:space:]' ' ')"

# 1) Substring patterns (literal, case-insensitive, whitespace-normalized).
for pattern in "${PATTERNS[@]}"; do
  PAT_NORM="$(printf '%s' "$pattern" | tr -s '[:space:]' ' ')"
  if [[ "$CMD_NORM" == *"$PAT_NORM"* ]]; then
    emit_deny "$pattern" "$COMMAND" "$SOURCE"
    exit 0
  fi
done

# 2) Regex rules (destructive variants). Best-effort accident prevention.
for rule in "${DANGER_REGEXES[@]}"; do
  label="${rule%%|*}"
  regex="${rule#*|}"
  if [[ "$CMD_NORM" =~ $regex ]]; then
    emit_deny "$label" "$COMMAND" "$SOURCE (regex rule)"
    exit 0
  fi
done

exit 0
