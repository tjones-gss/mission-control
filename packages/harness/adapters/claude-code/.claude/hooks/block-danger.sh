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
set -euo pipefail

INPUT="$(cat)"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
DANGER_YAML="${PROJECT_DIR}/.harness/danger-zone.yml"

# Fail-open if jq is unavailable, but surface the gap clearly on stderr so it
# appears in the user-visible hook output. Better than silent pass-through.
if ! command -v jq >/dev/null 2>&1; then
  echo "harness block-danger.sh: jq not installed; passing through. Install jq to enable enforcement." >&2
  exit 0
fi

COMMAND="$(jq -r '.tool_input.command // ""' <<<"$INPUT")"

# Built-in fallback list. Kept in sync with .harness/danger-zone.yml so behavior
# is reasonable when the YAML file is missing, unreadable, or new patterns are
# being added. These are LOWERCASE — matching is case-insensitive.
FALLBACK_PATTERNS=(
  'rm -rf'
  'drop table'
  'drop database'
  'delete from'
  'truncate'
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

# Normalize the command for matching:
#  - lowercase
#  - collapse runs of whitespace (spaces/tabs) into a single space
CMD_LC="${COMMAND,,}"
CMD_NORM="$(printf '%s' "$CMD_LC" | tr -s '[:space:]' ' ')"

for pattern in "${PATTERNS[@]}"; do
  # Normalize pattern the same way for fair matching.
  PAT_NORM="$(printf '%s' "$pattern" | tr -s '[:space:]' ' ')"
  if [[ "$CMD_NORM" == *"$PAT_NORM"* ]]; then
    jq -n \
      --arg p "$pattern" \
      --arg c "$COMMAND" \
      --arg s "$SOURCE" \
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
    exit 0
  fi
done

exit 0
