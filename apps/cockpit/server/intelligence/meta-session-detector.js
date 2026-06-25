// Phase S1 — Oversight watches its own build.
//
// A session is "meta" when its working directory is the Oversight repo root (or
// a directory inside it): the agent in that session is building Oversight, so
// Oversight can observe — and steer — its own construction. Pure + deterministic
// (no LLM, UNIVERSAL CONSTRAINT #4): meta-ness is a path comparison, and the
// steer prompt is a fixed string.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// intelligence/ → server → cockpit → apps → repo root. Resolved once at import.
export const OVERSIGHT_REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')

// The pre-composed message the "Steer build" quick action sends — nudges a
// wandering build agent to self-verify rather than waiting for a human.
export const STEER_BUILD_MESSAGE =
  'Review your last 3 commits, run `npm run test:cockpit`, and report what is failing.'

// Normalise a path for cross-platform comparison: forward slashes, no trailing
// slash, lower-case (Windows is case-insensitive; macOS often is too).
function norm(p) {
  return String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

// True when `cwd` is the repo root or a descendant of it. The trailing-slash
// guard stops a sibling like `mission-control-fork` from matching `mission-control`.
export function isMetaSession(cwd, repoRoot = OVERSIGHT_REPO_ROOT) {
  if (!cwd) return false
  const c = norm(cwd)
  const r = norm(repoRoot)
  if (!c || !r) return false
  return c === r || c.startsWith(r + '/')
}
