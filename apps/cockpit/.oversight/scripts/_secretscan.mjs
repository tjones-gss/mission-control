#!/usr/bin/env node
// Node bridge: runs server/utils/secretScanner.js over every git-tracked file
// in the repository and emits a JSON summary on stdout.
//
// Invoked by .oversight/scripts/eval_security.py. Standalone so the Python
// layer never has to import a JavaScript regex.
//
// Output shape (stdout):
//   {
//     "ok": true,
//     "files_scanned": 123,
//     "findings": [
//       { "path": "server/foo.js", "ruleId": "aws-access-key", "lineNumber": 42,
//         "description": "AWS Access Key ID" },
//       ...
//     ],
//     "env_files_tracked": ["some/.env"],   // .env* minus .env.example
//     "skipped": [ { "path": "...", "reason": "too-large" }, ... ]
//   }

import { execSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')

// Load the project's secret scanner. Use file:// URL for cross-platform.
const scannerPath = resolve(REPO_ROOT, 'server', 'utils', 'secretScanner.js')
const { scan } = await import(pathToFileURL(scannerPath).href)

// Files larger than this are skipped (secret scanner is O(lines * rules)).
const MAX_BYTES = 2 * 1024 * 1024 // 2 MB
// Binary-ish extensions to skip outright.
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz',
  '.tar', '.bz2', '.7z', '.exe', '.dll', '.so', '.dylib', '.woff', '.woff2',
  '.ttf', '.otf', '.mp3', '.mp4', '.mov', '.webm', '.avi', '.bin',
])

function listTracked() {
  try {
    const out = execSync('git ls-files', { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    return out.split('\n').map((s) => s.trim()).filter(Boolean)
  } catch (err) {
    console.error('git ls-files failed:', err.message)
    return []
  }
}

function ext(path) {
  const i = path.lastIndexOf('.')
  return i === -1 ? '' : path.slice(i).toLowerCase()
}

function isEnvLeak(path) {
  const base = path.split('/').pop() || ''
  if (!/^\.env($|\.)/.test(base)) return false
  if (base === '.env.example') return false
  if (base === '.env.sample') return false
  return true
}

const files = listTracked()
const findings = []
const envFiles = []
const skipped = []
let scanned = 0

for (const rel of files) {
  if (isEnvLeak(rel)) envFiles.push(rel)

  if (BINARY_EXT.has(ext(rel))) {
    skipped.push({ path: rel, reason: 'binary-ext' })
    continue
  }
  const abs = resolve(REPO_ROOT, rel)
  let size = 0
  try {
    size = statSync(abs).size
  } catch (_) {
    skipped.push({ path: rel, reason: 'stat-failed' })
    continue
  }
  if (size > MAX_BYTES) {
    skipped.push({ path: rel, reason: 'too-large', bytes: size })
    continue
  }

  let text
  try {
    text = readFileSync(abs, 'utf8')
  } catch (_) {
    skipped.push({ path: rel, reason: 'read-failed' })
    continue
  }
  // Skip our own secret scanner source and tests (expected to contain patterns)
  if (rel === 'server/utils/secretScanner.js' || rel.includes('secretScanner.test')) {
    skipped.push({ path: rel, reason: 'scanner-self' })
    continue
  }
  // Skip our own eval scripts (we store regex examples)
  if (rel.startsWith('.oversight/scripts/')) {
    skipped.push({ path: rel, reason: 'oversight-self' })
    continue
  }

  scanned++
  let hits
  try {
    hits = scan(text)
  } catch (err) {
    skipped.push({ path: rel, reason: 'scan-error', error: String(err) })
    continue
  }
  for (const h of hits) {
    findings.push({ path: rel, ruleId: h.ruleId, description: h.description, lineNumber: h.lineNumber })
  }
}

const payload = {
  ok: findings.length === 0,
  files_scanned: scanned,
  files_listed: files.length,
  findings,
  env_files_tracked: envFiles,
  skipped: skipped.slice(0, 200),
  skipped_total: skipped.length,
}
process.stdout.write(JSON.stringify(payload))
