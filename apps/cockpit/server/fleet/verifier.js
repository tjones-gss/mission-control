// Deterministic, LLM-free verification gate for Fleet diffs (L1-F).
//
// The adversarial-verifier flow in fleet-runner.js asks a fresh Claude session to
// judge a worker's diff — useful, but an LLM verdict is not a trust boundary. This
// module is the deterministic backstop: a pure scan of the candidate diff for
// known-bad patterns that must NEVER ship, so a bad diff halts at the verify phase
// (status 'rejected') instead of proceeding to synthesis. No model, no network —
// the same input always yields the same verdict, so "verification isn't theater".
//
// Scope is deliberately one rule (the security-fatal one): an ADDED line that
// reintroduces `shell: true` in spawn code — exactly the Windows command-injection
// vector buildSpawn (claude-cli.js) exists to close. Only added lines (`+`) count;
// removing `shell: true` is a fix, and an unchanged context line is not this diff's
// doing. RULES is a list so a later criterion can append more without reshaping the
// call site.

// Each rule: { id, test(addedLine) -> boolean, reason }. A diff is rejected if any
// ADDED line matches any rule.
export const RULES = [
  {
    id: 'shell-true-in-spawn',
    // `shell: true` or `shell:true` — the re-parse-through-a-shell injection vector.
    test: (line) => /shell\s*:\s*true/i.test(line),
    reason: 'introduces `shell: true` in spawn code (command-injection vector)',
  },
]

// Pull the ADDED lines out of a unified diff: lines starting with a single '+'
// that are NOT the '+++' file header. Context (' ') and removed ('-') lines are
// ignored — only what the diff INTRODUCES can violate a rule.
function addedLines(diff) {
  const out = []
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) out.push(line.slice(1))
  }
  return out
}

// Verify a candidate diff. Returns { status: 'approved' | 'rejected', reasons:[] }.
// A non-string / empty diff has nothing to reject (approved). Fail CLOSED only on a
// matched rule — there is no "unsure" verdict here, the rules are exact.
export function verifyDiff(diff) {
  if (typeof diff !== 'string' || !diff) return { status: 'approved', reasons: [] }
  const reasons = []
  for (const line of addedLines(diff)) {
    for (const rule of RULES) {
      if (rule.test(line)) reasons.push(rule.reason)
    }
  }
  // De-dupe so the same rule matching N lines reports once.
  const unique = [...new Set(reasons)]
  return { status: unique.length ? 'rejected' : 'approved', reasons: unique }
}
