#!/usr/bin/env bash
# tests/check_hooks.sh — syntax + functional smoke tests for the v5 hooks.
#
# Runs in any environment with bash + jq. Exits non-zero on any failure so it
# can wire into CI without further glue.
#
# Usage:
#   ./tests/check_hooks.sh            # run all
#   ./tests/check_hooks.sh --syntax   # syntax only (no jq required)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
CLAUDE_HOOK_DIR="$ROOT/adapters/claude-code/.claude/hooks"
CURSOR_HOOK_DIR="$ROOT/adapters/cursor/.cursor/hooks"
FIXTURES="$HERE/fixtures"

PASS=0; FAIL=0
ok()   { echo "  [ok]   $1"; PASS=$((PASS+1)); }
bad()  { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }

# -------- 1. Syntax checks (bash -n) --------
echo "Syntax (bash -n) — Claude hooks:"
for hook in "$CLAUDE_HOOK_DIR"/*.sh; do
  if bash -n "$hook" 2>/dev/null; then ok "$(basename "$hook")"; else bad "$(basename "$hook") — syntax error"; fi
done

echo "Syntax (bash -n) — Cursor hooks:"
for hook in "$CURSOR_HOOK_DIR"/*.sh; do
  if bash -n "$hook" 2>/dev/null; then ok "cursor/$(basename "$hook")"; else bad "cursor/$(basename "$hook") — syntax error"; fi
done

if [[ "${1:-}" == "--syntax" ]]; then
  echo
  echo "Syntax-only mode: $PASS passed, $FAIL failed."
  exit $((FAIL > 0))
fi

# -------- 2. jq present? --------
if ! command -v jq >/dev/null 2>&1; then
  echo
  echo "jq not installed — functional tests skipped. (Install jq to test hook behavior.)"
  echo "$PASS passed, $FAIL failed (functional skipped)."
  exit $((FAIL > 0))
fi

# -------- 3. Build a throwaway fixture project --------
TMP="$(mktemp -d -t harness-test-XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/.harness" "$TMP/runs/missions" "$TMP/runs/session-notes" "$TMP/src/auth" "$TMP/src/billing"

cp "$FIXTURES/project-state.yml"      "$TMP/.harness/"
cp "$FIXTURES/danger-zone.yml"        "$TMP/.harness/"
cp "$FIXTURES/mission-index.yml"      "$TMP/.harness/"
cp "$FIXTURES/MISSION-007-add-login.md" "$TMP/runs/missions/"

export CLAUDE_PROJECT_DIR="$TMP"

run_hook() {
  # run_hook <hook_dir> <hook> <stdin-json>  -> stdout
  echo "$3" | bash "$1/$2"
}

HOOK_DIR="$CLAUDE_HOOK_DIR"

# -------- 4. block-danger.sh --------
echo
echo "block-danger.sh:"

OUT="$(run_hook "$HOOK_DIR" block-danger.sh '{"tool_input":{"command":"rm -rf /tmp/x"}}')"
[[ "$OUT" == *'"permissionDecision": "deny"'* ]] && ok "rm -rf → deny" || bad "rm -rf not denied"

OUT="$(run_hook "$HOOK_DIR" block-danger.sh '{"tool_input":{"command":"DROP TABLE users"}}')"
[[ "$OUT" == *'"permissionDecision": "deny"'* ]] && ok "DROP TABLE → deny (case-insensitive)" || bad "DROP TABLE not denied"

OUT="$(run_hook "$HOOK_DIR" block-danger.sh '{"tool_input":{"command":"rm     -rf /tmp/x"}}')"
[[ "$OUT" == *'"permissionDecision": "deny"'* ]] && ok "rm    -rf (extra spaces) → deny" || bad "rm with extra whitespace not denied"

OUT="$(run_hook "$HOOK_DIR" block-danger.sh '{"tool_input":{"command":"ls -la"}}')"
[[ -z "$OUT" ]] && ok "ls -la → allow (empty)" || bad "ls -la produced output: $OUT"

# -------- 5. require-mission.sh --------
echo
echo "require-mission.sh:"

OUT="$(run_hook "$HOOK_DIR" require-mission.sh "{\"tool_input\":{\"file_path\":\"$TMP/src/billing/charge.ts\"}}")"
[[ "$OUT" == *'"permissionDecision": "deny"'* ]] && ok "forbidden file → deny" || bad "forbidden file not denied: $OUT"

OUT="$(run_hook "$HOOK_DIR" require-mission.sh "{\"tool_input\":{\"file_path\":\"$TMP/src/auth/login.ts\"}}")"
[[ -z "$OUT" ]] && ok "allowed file → allow (empty)" || bad "allowed file produced output: $OUT"

OUT="$(run_hook "$HOOK_DIR" require-mission.sh "{\"tool_input\":{\"file_path\":\"$TMP/src/unrelated/util.ts\"}}")"
[[ "$OUT" == *'"permissionDecision": "deny"'* ]] && ok "app code outside scope → deny" || bad "out-of-scope edit not denied"

OUT="$(run_hook "$HOOK_DIR" require-mission.sh "{\"tool_input\":{\"file_path\":\"$TMP/.harness/project-state.yml\"}}")"
[[ "$OUT" == *'"permissionDecision": "ask"'* ]] && ok "harness path w/ mission → ask" || bad "harness path didn't ask: $OUT"

# Bootstrap mode override
cp "$FIXTURES/project-state-bootstrap.yml" "$TMP/.harness/project-state.yml"
OUT="$(run_hook "$HOOK_DIR" require-mission.sh "{\"tool_input\":{\"file_path\":\"$TMP/.harness/project-state.yml\"}}")"
[[ -z "$OUT" ]] && ok "harness path in bootstrap mode → allow" || bad "bootstrap mode didn't allow: $OUT"

# -------- 6. stop-session-note-reminder.sh --------
echo
echo "stop-session-note-reminder.sh:"

# Restore the mission state
cp "$FIXTURES/project-state.yml" "$TMP/.harness/project-state.yml"

set +e
echo "" | bash "$HOOK_DIR/stop-session-note-reminder.sh" >/dev/null 2>&1; RC=$?
set -e
[[ $RC -eq 0 ]] && ok "advisory mode → exit 0 even with no note" || bad "advisory mode exited $RC"

set +e
echo "" | HARNESS_ENFORCE_SESSION_NOTE=1 bash "$HOOK_DIR/stop-session-note-reminder.sh" >/dev/null 2>&1; RC=$?
set -e
[[ $RC -eq 2 ]] && ok "enforce mode, no note → exit 2 (block stop)" || bad "enforce mode exited $RC (expected 2)"

# Write a matching note
echo "session for MISSION-007-add-login" > "$TMP/runs/session-notes/2026-05-25-MISSION-007-add-login.md"
set +e
echo "" | HARNESS_ENFORCE_SESSION_NOTE=1 bash "$HOOK_DIR/stop-session-note-reminder.sh" >/dev/null 2>&1; RC=$?
set -e
[[ $RC -eq 0 ]] && ok "enforce mode, matching note → exit 0" || bad "enforce mode with matching note exited $RC"

# -------- 7. v5.1.1 regression cases (path traversal + quoted entries) --------
echo
echo "v5.1.1 fix-ups:"

# B1: path traversal must be denied (was: ALLOWED through Allowed-prefix match)
OUT="$(run_hook "$HOOK_DIR" require-mission.sh "{\"tool_input\":{\"file_path\":\"$TMP/src/auth/../billing/charge.ts\"}}")"
[[ "$OUT" == *'"permissionDecision": "deny"'* ]] && ok "B1: src/auth/../billing/charge.ts → deny" \
  || bad "B1: src/auth/../billing/charge.ts not denied: $OUT"

# B1: traversal through harness prefix must also be denied (was: ASK)
OUT="$(run_hook "$HOOK_DIR" require-mission.sh "{\"tool_input\":{\"file_path\":\"$TMP/.harness/../src/billing/x.ts\"}}")"
[[ "$OUT" == *'"permissionDecision": "deny"'* ]] && ok "B1: .harness/../src/billing/x.ts → deny" \
  || bad "B1: .harness/../src/billing/x.ts not denied: $OUT"

# N3: quoted Allowed entries must match real files
QMISSION="$TMP/runs/missions/MISSION-Q01-quoted.md"
cat > "$QMISSION" <<'M'
# Mission: quoted-entries

## Allowed Files

- "src/auth/**"
- `src/components/Login.tsx`

## Forbidden Files

- "src/billing/**"
M
# Point the project state at this mission
cat > "$TMP/.harness/project-state.yml" <<'PS'
project:
  name: test-fixture
  mode: feature-development
  stage: implementation
current:
  mission: MISSION-Q01-quoted
PS
cat > "$TMP/.harness/mission-index.yml" <<'MI'
missions:
  MISSION-Q01-quoted:
    file: runs/missions/MISSION-Q01-quoted.md
    status: in-progress
MI
mkdir -p "$TMP/src/components"

OUT="$(run_hook "$HOOK_DIR" require-mission.sh "{\"tool_input\":{\"file_path\":\"$TMP/src/auth/login.ts\"}}")"
[[ -z "$OUT" ]] && ok "N3: quoted \"src/auth/**\" matches src/auth/login.ts" \
  || bad "N3: quoted pattern did not match: $OUT"

OUT="$(run_hook "$HOOK_DIR" require-mission.sh "{\"tool_input\":{\"file_path\":\"$TMP/src/components/Login.tsx\"}}")"
[[ -z "$OUT" ]] && ok "N3: backticked \`src/components/Login.tsx\` matches that file" \
  || bad "N3: backticked pattern did not match: $OUT"

OUT="$(run_hook "$HOOK_DIR" require-mission.sh "{\"tool_input\":{\"file_path\":\"$TMP/src/billing/charge.ts\"}}")"
[[ "$OUT" == *'"permissionDecision": "deny"'* ]] && ok "N3: quoted Forbidden still denies src/billing/charge.ts" \
  || bad "N3: quoted Forbidden didn't deny: $OUT"

# N1: awk fallback must parse under whatever awk is on PATH. Pull the -v
# assignment line out of the hook source itself so a regression to
# `-v sub="$sub"` reproduces here. Then exercise that exact awk variable
# choice against a real project-state.yml.
HOOK_SRC="$HOOK_DIR/require-mission.sh"
VARNAME="$(grep -oE 'awk -v top="\$top" -v [A-Za-z_]+="\$sub"' "$HOOK_SRC" \
            | grep -oE 'v [A-Za-z_]+="\$sub"' | head -1 | sed -E 's/v ([A-Za-z_]+)=.*/\1/')"
if [[ -z "$VARNAME" ]]; then
  bad "N1: could not locate awk -v variable name in require-mission.sh"
elif awk -v top="current" -v "$VARNAME=mission" "
  BEGIN { in_top = 0 }
  /^[A-Za-z_]/ { in_top = (\$0 ~ \"^\" top \":\") ? 1 : 0; next }
  in_top && \$0 ~ \"^[[:space:]]+\" $VARNAME \":\" {
    val = \$0
    sub(\"^[[:space:]]+\" $VARNAME \":[[:space:]]*\", \"\", val)
    print val; exit
  }
" "$TMP/.harness/project-state.yml" >/dev/null 2>&1; then
  ok "N1: hook awk var '$VARNAME' parses under $(awk -W version 2>&1 | head -1 || awk --version 2>&1 | head -1 || echo "awk on PATH")"
else
  bad "N1: hook awk var '$VARNAME' errored — likely a reserved-word collision (e.g. 'sub' under mawk)"
fi

export CURSOR_PROJECT_DIR="$TMP"

# -------- 8. Cursor hooks (Cursor JSON format) --------
echo
echo "Cursor block-danger.sh:"
OUT="$(run_hook "$CURSOR_HOOK_DIR" block-danger.sh '{"command":"rm -rf /tmp/x"}')"
[[ "$OUT" == *'"permission": "deny"'* ]] && ok "cursor rm -rf → deny" || bad "cursor rm -rf not denied"

OUT="$(run_hook "$CURSOR_HOOK_DIR" block-danger.sh '{"command":"ls -la"}')"
[[ "$OUT" == *'"permission": "allow"'* ]] && ok "cursor ls -la → allow" || bad "cursor ls -la: $OUT"

echo
echo "Cursor require-mission.sh:"
cp "$FIXTURES/project-state.yml" "$TMP/.harness/project-state.yml"
OUT="$(run_hook "$CURSOR_HOOK_DIR" require-mission.sh "{\"tool_input\":{\"file_path\":\"$TMP/src/billing/charge.ts\"}}")"
[[ "$OUT" == *'"permission": "deny"'* ]] && ok "cursor forbidden → deny" || bad "cursor forbidden: $OUT"

OUT="$(run_hook "$CURSOR_HOOK_DIR" require-mission.sh "{\"tool_input\":{\"file_path\":\"$TMP/src/auth/login.ts\"}}")"
[[ "$OUT" == *'"permission": "allow"'* ]] && ok "cursor allowed → allow" || bad "cursor allowed: $OUT"

# -------- 9. v5.2 path normalization + recursive patterns --------
echo
echo "v5.2 path fixes:"

REL_OUT="$(bash -c "source '$CURSOR_HOOK_DIR/_common.sh'; rel_path_from_project 'c:/tmp/proj/docs/setup/x.md' 'C:/tmp/proj'")"
[[ "$REL_OUT" == "docs/setup/x.md" ]] && ok "W1: lowercase Windows drive relativizes" \
  || bad "W1: expected docs/setup/x.md, got: $REL_OUT"

HMISSION="$TMP/runs/missions/MISSION-H01-harness-paths.md"
cat > "$HMISSION" <<'M'
# Mission: harness paths

## Allowed Files

- docs/**
- .harness/**

## Forbidden Files

- application source files
M
cat > "$TMP/.harness/project-state.yml" <<'PS'
project:
  name: test-fixture
  mode: feature-development
  stage: implementation
current:
  mission: MISSION-H01-harness-paths
PS
cat > "$TMP/.harness/mission-index.yml" <<'MI'
missions:
  MISSION-H01-harness-paths:
    file: runs/missions/MISSION-H01-harness-paths.md
    status: in-progress
MI
mkdir -p "$TMP/docs/setup/nested"

OUT="$(run_hook "$CLAUDE_HOOK_DIR" require-mission.sh "{\"tool_input\":{\"file_path\":\"$TMP/docs/setup/nested/x.md\"}}")"
[[ -z "$OUT" ]] && ok "G1: Claude docs/** allows nested docs path" \
  || bad "G1: Claude docs/** did not allow nested docs path: $OUT"

OUT="$(run_hook "$CURSOR_HOOK_DIR" require-mission.sh "{\"tool_input\":{\"file_path\":\"$TMP/docs/setup/nested/x.md\"}}")"
[[ "$OUT" == *'"permission": "allow"'* ]] && ok "G1: Cursor docs/** allows nested docs path" \
  || bad "G1: Cursor docs/** did not allow nested docs path: $OUT"

OUT="$(run_hook "$CLAUDE_HOOK_DIR" require-mission.sh "{\"tool_input\":{\"file_path\":\"$TMP/.harness/quality-gates.yml\"}}")"
[[ -z "$OUT" ]] && ok "G2: Claude .harness/** allows nested harness path" \
  || bad "G2: Claude .harness/** did not allow nested harness path: $OUT"

OUT="$(run_hook "$CURSOR_HOOK_DIR" require-mission.sh "{\"tool_input\":{\"file_path\":\"$TMP/.harness/quality-gates.yml\"}}")"
[[ "$OUT" == *'"permission": "allow"'* ]] && ok "G2: Cursor .harness/** allows nested harness path" \
  || bad "G2: Cursor .harness/** did not allow nested harness path: $OUT"

if WIN_TMP="$(cd "$TMP" && pwd -W 2>/dev/null)"; then
  export CURSOR_PROJECT_DIR="$WIN_TMP"
  WIN_FILE="$(printf '%s/docs/setup/nested/x.md' "$WIN_TMP" | sed -E 's#^([A-Z]):#\L\1:#')"
  OUT="$(run_hook "$CURSOR_HOOK_DIR" require-mission.sh "{\"tool_input\":{\"file_path\":\"$WIN_FILE\"}}")"
  [[ "$OUT" == *'"permission": "allow"'* ]] && ok "W2: Cursor mixed-case Windows drive allows scoped docs path" \
    || bad "W2: Cursor mixed-case Windows drive did not allow scoped docs path: $OUT"
else
  ok "W2: skipped mixed-case Windows drive hook smoke (pwd -W unavailable)"
fi
export CURSOR_PROJECT_DIR="$TMP"

# -------- summary --------
echo
echo "$PASS passed, $FAIL failed."
exit $((FAIL > 0))
