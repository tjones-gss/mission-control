#!/usr/bin/env node
// Harness PreToolUse hook (Bash): block dangerous commands. Pure-Node port of
// block-danger.sh — needs neither jq nor bash. Wired by settings.node.json.
//
// FAIL CLOSED: unparseable non-empty input is denied, not allowed. Best-effort
// accident prevention only — OS sandboxing is the real control.
import {
  readStdin,
  extractCommand,
  loadDangerPatterns,
  matchDanger,
  denyReason,
  preToolUseDecision,
  emitDecision,
} from './_lib.mjs'

const input = await readStdin()
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
const { patterns, source } = loadDangerPatterns(projectDir)

const ex = extractCommand(input)
if (!ex.ok) {
  // Could not parse a command from non-empty/empty input → deny (fail closed).
  emitDecision(
    preToolUseDecision(
      'deny',
      denyReason(
        '<unparseable hook input>',
        input || '<empty>',
        'fail-closed (could not extract command)',
      ),
    ),
  )
  process.exit(0)
}

const match = matchDanger(ex.command, patterns, source)
if (match) {
  emitDecision(preToolUseDecision('deny', denyReason(match.label, ex.command, match.source)))
  process.exit(0)
}

// No match — emit nothing; normal permission flow proceeds.
process.exit(0)
