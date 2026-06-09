// Pure-Node rails adopter — the in-cockpit one-click "Add rails" path.
//
// Copies the harness Claude adapter (.claude/ + CLAUDE.md) into a target project
// and wires settings.json to the pure-Node hooks (settings.node.json). It needs
// NEITHER python NOR bash NOR jq — that is the whole point of the L2 "pure-Node
// hook fallback" criterion: a single-operator Windows box with no Git Bash and no
// jq can still adopt enforcing rails.
//
// Adapter-only by design (per the Phase 3 plan): it installs the hooks/agents/
// skills adapter, it does NOT scaffold .harness/ project state — that stays on the
// `harness scaffold` (POST /api/harness/create) + CLI path. With .harness absent
// the hooks still enforce: block-danger falls back to its built-in danger list and
// require-mission falls to ASK.
//
// Deterministic: no Claude session is spawned (council MED #6 — privileged writes
// never route through an LLM).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// apps/cockpit/server/lib/ → packages/harness/adapters/claude-code
const ADAPTER_ROOT = path.resolve(__dirname, '../../../../packages/harness/adapters/claude-code')

function existsAsDir(p) {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function existsAsFile(p) {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

// Install the Claude adapter into projectPath, wired to the pure-Node hooks.
// Synchronous + best-effort; never throws — every failure resolves to a
// machine-readable result the route maps to an HTTP status.
//
// Returns:
//   { ok: true, installed: [...], alreadyPresent: false }  — fresh install (→ 201)
//   { ok: true, alreadyPresent: true }                      — already adopted (→ 409)
//   { ok: false, error: '<code>' }                          — failure (→ 502)
export function adoptRails(projectPath) {
  if (typeof projectPath !== 'string' || !projectPath) {
    return { ok: false, error: 'invalid_target' }
  }
  if (!existsAsDir(projectPath)) {
    return { ok: false, error: 'target_missing' }
  }

  const srcClaude = path.join(ADAPTER_ROOT, '.claude')
  const srcClaudeMd = path.join(ADAPTER_ROOT, 'CLAUDE.md')
  const srcNodeSettings = path.join(srcClaude, 'settings.node.json')
  if (!existsAsDir(srcClaude) || !existsAsFile(srcClaudeMd) || !existsAsFile(srcNodeSettings)) {
    return { ok: false, error: 'adapter_missing' }
  }

  const destClaude = path.join(projectPath, '.claude')
  const destClaudeMd = path.join(projectPath, 'CLAUDE.md')
  const destSettings = path.join(destClaude, 'settings.json')

  // Idempotency: an existing wired adapter (settings.json present) is "already
  // present" — never clobber the operator's settings.
  if (existsAsFile(destSettings)) {
    return { ok: true, alreadyPresent: true }
  }

  try {
    // Recursively copy the WHOLE adapter tree (avoids file-list drift if the
    // adapter gains files). fs.cpSync recursive is available on Node 16.7+.
    fs.cpSync(srcClaude, destClaude, { recursive: true })
    fs.copyFileSync(srcClaudeMd, destClaudeMd)

    // Wire settings.json to the pure-Node hooks (the in-cockpit default).
    const nodeSettings = fs.readFileSync(srcNodeSettings, 'utf8')
    fs.writeFileSync(destSettings, nodeSettings)

    // Don't ship the hooks' own test file into the user's project.
    const testFile = path.join(destClaude, 'hooks', 'hooks.test.mjs')
    try {
      fs.rmSync(testFile, { force: true })
    } catch {
      /* best-effort cleanup */
    }

    return {
      ok: true,
      alreadyPresent: false,
      installed: ['.claude/', 'CLAUDE.md'],
      hooks: 'node',
    }
  } catch (err) {
    return { ok: false, error: err && err.code ? err.code : 'copy_failed' }
  }
}
