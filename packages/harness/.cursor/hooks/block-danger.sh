#!/usr/bin/env bash
# Harness beforeShellExecution hook: block dangerous shell commands.
# Cursor format: returns { "permission": "deny|allow", ... }
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "${HOOK_DIR}/_common.sh"

INPUT="$(read_hook_input)"
PROJECT_DIR="$(resolve_project_dir)"
DANGER_YAML="${PROJECT_DIR}/.harness/danger-zone.yml"

if ! command -v jq >/dev/null 2>&1; then
  echo "harness block-danger.sh: jq not installed; passing through." >&2
  emit_allow
  exit 0
fi

COMMAND="$(jq -r '.command // .tool_input.command // ""' <<<"$INPUT" 2>/dev/null || echo "")"

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

PATTERNS=()
load_patterns_from_yaml() {
  [[ -r "$DANGER_YAML" ]] || return 1
  local in_block=0 line stripped val
  while IFS= read -r line; do
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

CMD_LC="$(printf '%s' "$COMMAND" | tr '[:upper:]' '[:lower:]')"
CMD_NORM="$(printf '%s' "$CMD_LC" | tr -s '[:space:]' ' ')"

for pattern in "${PATTERNS[@]}"; do
  PAT_NORM="$(printf '%s' "$pattern" | tr -s '[:space:]' ' ')"
  if [[ "$CMD_NORM" == *"$PAT_NORM"* ]]; then
    jq -n \
      --arg p "$pattern" \
      --arg c "$COMMAND" \
      --arg s "$SOURCE" \
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
    }' 2>/dev/null || emit_deny "Blocked by harness danger-zone policy."
    exit 0
  fi
done

emit_allow
exit 0
