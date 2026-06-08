#!/usr/bin/env node
// Deterministic stub `claude` bin for the gated Fleet e2e lane (RUN_E2E=1).
//
// It is resolved into the real spawn pipeline via claude-bin.js `_setClaudeBin`,
// so it exercises runClaudeCancellable → buildSpawn → spawn exactly like the real
// CLI would, but emits CANNED stream-json instead of calling a model. No network,
// no API key, fully reproducible.
//
// Role is inferred from the -p prompt the runner builds:
//   - verifier : prompt contains "adversarial reviewer" — reads the worker's
//                result marker from cwd and emits approve/reject accordingly so a
//                KNOWN-BAD diff is REJECTED and a fixed diff is APPROVED.
//   - synthesis: prompt contains "Synthesize the results" — emits a summary.
//   - worker   : everything else. First pass writes a KNOWN-BAD marker; an
//                informed re-dispatch (prompt contains the reviewer's reasons,
//                i.e. "A prior reviewer rejected") writes a GOOD marker.
//
// The marker file lives in cwd and is shared between worker/verifier because the
// stub ignores --worktree and runs in the cwd it was handed — enough for a
// deterministic, diff-driven e2e without standing up real git worktrees.

import fs from 'fs'
import path from 'path'

const args = process.argv.slice(2)
const pIdx = args.indexOf('-p')
const prompt = pIdx !== -1 && args[pIdx + 1] ? args[pIdx + 1] : ''
const cwd = process.cwd()
const markerPath = path.join(cwd, 'fleet-e2e-result.txt')

function emitResult(resultText) {
  // Match the shape runner's extractResult() scans for: a {type:"result"} line.
  const line = JSON.stringify({ type: 'result', subtype: 'success', result: resultText })
  process.stdout.write(line + '\n')
}

function readMarker() {
  try {
    return fs.readFileSync(markerPath, 'utf8').trim()
  } catch {
    return null
  }
}

if (/adversarial reviewer/i.test(prompt)) {
  // VERIFIER — verdict is driven by the worker's actual on-disk diff/marker.
  const marker = readMarker()
  if (marker === 'GOOD') {
    emitResult(
      JSON.stringify({
        verdict: 'approve',
        reasons: [],
        rubricScores: { correctness: 1 },
      }),
    )
  } else {
    emitResult(
      JSON.stringify({
        verdict: 'reject',
        reasons: ['introduces a known regression', 'fails the correctness rubric'],
        rubricScores: { correctness: 0 },
      }),
    )
  }
  process.exit(0)
}

if (/Synthesize the results/i.test(prompt)) {
  // SYNTHESIS — read-only merged report.
  emitResult('Synthesis: all children settled; merged report produced.')
  process.exit(0)
}

// WORKER — first pass is the KNOWN-BAD diff; an informed retry produces the fix.
const isInformedRetry = /A prior reviewer rejected/i.test(prompt)
fs.writeFileSync(markerPath, isInformedRetry ? 'GOOD' : 'BAD')
emitResult(
  isInformedRetry ? 'Fixed the regression flagged by review.' : 'Implemented (with a bug).',
)
process.exit(0)
