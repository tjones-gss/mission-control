import { execFileSync } from 'child_process'
import fs from 'fs'

// Resolve the absolute path of the Claude CLI binary.
// Order matters: native-installer users get `claude.exe`, npm-shim users get
// `claude.cmd`. Passing the absolute path to spawn/pty.spawn avoids two
// Windows traps at once: Node's CVE-2024-27980 EINVAL for bare .cmd spawns,
// and node-pty's "File not found:" when the name can't be PATH-resolved.
export function resolveClaudeBin() {
  const isWin = process.platform === 'win32'
  const candidates = isWin ? ['claude.exe', 'claude.cmd', 'claude.ps1'] : ['claude']
  const locator = isWin ? 'where.exe' : 'which'

  for (const name of candidates) {
    try {
      const out = execFileSync(locator, [name], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const first = out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find(Boolean)
      if (first && fs.existsSync(first)) return first
    } catch {
      // `where`/`which` exits non-zero when the name isn't found — try next candidate.
    }
  }

  throw new Error(
    'Claude CLI not found on PATH. Install via npm (`npm i -g @anthropic-ai/claude-code`) ' +
      'or the native installer from https://claude.ai/download.',
  )
}

// Resolve lazily and memoize. Module import must not crash the server when
// the claude CLI is missing — routes fail with a 503 at call time instead,
// which surfaces a clean install-guidance error in the dashboard.
let cachedBin = null

export function getClaudeBin() {
  if (cachedBin) return cachedBin
  cachedBin = resolveClaudeBin()
  return cachedBin
}

// Test-only: reset the memoized binary so tests can re-exercise resolution.
export function _resetClaudeBinCache() {
  cachedBin = null
}

// Test-only: pin getClaudeBin to a specific absolute path WITHOUT touching PATH.
// The gated e2e lane (RUN_E2E=1) uses this to point the real spawn pipeline at a
// deterministic stub `claude` bin so a Fleet can be driven through a full
// verify→reject→retry→synthesis cycle without a network/API key. Passing null
// clears the override and re-enables normal PATH resolution. This is the
// `getClaudeBin` override the e2e durability/reject specs depend on.
export function _setClaudeBin(absPath) {
  cachedBin = absPath || null
}

export function isShellScript(binPath) {
  const p = binPath.toLowerCase()
  return p.endsWith('.cmd') || p.endsWith('.bat') || p.endsWith('.ps1')
}
