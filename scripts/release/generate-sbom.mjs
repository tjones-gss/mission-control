#!/usr/bin/env node
// CycloneDX 1.5 SBOM generator for the mission-control monorepo. Lives under
// scripts/release/ — OUTSIDE the server coverage include globs — so it does not
// move the coverage floor. Zero external deps (stdlib only): CI / release can run
// it without an extra install.
//
// SCOPE / HONESTY:
//   - NODE: resolved from the committed npm lockfiles (root + cockpit server +
//     cockpit client). lockfileVersion 3 `packages` map = the fully-resolved
//     transitive graph, so the npm side is a complete, offline, pinned BOM.
//   - PYTHON: hand-built DIRECT-dependency list from each pyproject.toml
//     `[project].dependencies`. Python has NO committed lockfile here, so the
//     transitive python graph is NOT resolved. This is recorded honestly in a
//     metadata property (`mission-control:python-deps = direct-only ...`) so a
//     consumer never mistakes this for a full python dependency tree.
//
// Usage:  node scripts/release/generate-sbom.mjs [outPath]   (default: bom.json)
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

import {
  repoRoot,
  PYPROJECT_VERSION_SOURCES,
  parsePyprojectVersion,
} from './version-sources.js'

const ROOT = repoRoot()

// The committed npm lockfiles spanning the node side of the monorepo. The
// apps/cockpit workspace lock and the root lock overlap; dedupe by name@version
// handles that.
const NODE_LOCKFILES = [
  'package-lock.json',
  'apps/cockpit/package-lock.json',
  'apps/cockpit/server/package-lock.json',
  'apps/cockpit/client/package-lock.json',
]

function readJson(rel) {
  return JSON.parse(readFileSync(path.join(ROOT, rel), 'utf-8'))
}

function readTextSafe(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf-8')
}

// Extract the package name from a lockfile-v3 `packages` key like
// "node_modules/express" or "node_modules/a/node_modules/b" (nested dep).
// Returns null for the root/self entries ("" and workspace link paths).
function packageNameFromKey(key) {
  const marker = 'node_modules/'
  const idx = key.lastIndexOf(marker)
  if (idx === -1) return null
  const name = key.slice(idx + marker.length)
  return name.length > 0 ? name : null
}

// Build the npm component list from all node lockfiles (lockfileVersion 3).
export function collectNpmComponents() {
  const byPurl = new Map()
  for (const rel of NODE_LOCKFILES) {
    let lock
    try {
      lock = readJson(rel)
    } catch (err) {
      throw new Error(`generate-sbom: failed to read node lockfile ${rel}: ${err.message}`)
    }
    const packages = lock.packages || {}
    for (const [key, meta] of Object.entries(packages)) {
      const name = packageNameFromKey(key)
      if (!name) continue // root or workspace self-link
      const version = meta && meta.version
      if (typeof version !== 'string' || version.length === 0) continue
      // file:/link: workspace members carry no real version pin worth shipping.
      if (meta.link === true) continue
      const purl = `pkg:npm/${encodeURIComponent(name)}@${version}`
      if (byPurl.has(purl)) continue
      const component = {
        type: 'library',
        name,
        version,
        purl,
      }
      const integrity = meta.integrity
      if (typeof integrity === 'string' && integrity.includes('-')) {
        const [alg, b64] = integrity.split('-', 2)
        const algMap = { sha512: 'SHA-512', sha256: 'SHA-256', sha1: 'SHA-1' }
        if (algMap[alg] && b64) {
          component.hashes = [
            { alg: algMap[alg], content: Buffer.from(b64, 'base64').toString('hex') },
          ]
        }
      }
      byPurl.set(purl, component)
    }
  }
  return [...byPurl.values()].sort((a, b) => a.purl.localeCompare(b.purl))
}

// Parse the `[project].dependencies` array from raw pyproject.toml text. Minimal
// (no TOML dependency): finds the `dependencies = [ ... ]` array inside the
// `[project]` table and extracts each quoted requirement string. Returns an
// array of { name, version } where version is the requirement specifier's lower
// bound (e.g. "pyyaml>=6.0" -> { name: "pyyaml", version: ">=6.0" }).
export function parsePyprojectDependencies(tomlText) {
  if (typeof tomlText !== 'string') return []
  const lines = tomlText.split(/\r?\n/)
  let inProject = false
  let inDeps = false
  let buffer = ''
  for (const line of lines) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/)
    if (header) {
      inProject = header[1].trim() === 'project'
      inDeps = false
      continue
    }
    if (!inProject) continue
    if (!inDeps) {
      const start = line.match(/^\s*dependencies\s*=\s*\[(.*)$/)
      if (start) {
        inDeps = true
        buffer = start[1]
        if (buffer.includes(']')) {
          buffer = buffer.slice(0, buffer.indexOf(']'))
          inDeps = false
        }
        // single-line array fully captured below if closed
        if (!inDeps) return parseRequirementList(buffer)
      }
      continue
    }
    // multi-line dependencies array
    if (line.includes(']')) {
      buffer += '\n' + line.slice(0, line.indexOf(']'))
      return parseRequirementList(buffer)
    }
    buffer += '\n' + line
  }
  return []
}

function parseRequirementList(buffer) {
  const reqs = []
  const re = /["']([^"']+)["']/g
  let m
  while ((m = re.exec(buffer)) !== null) {
    const req = m[1].trim()
    if (!req) continue
    // Split a PEP 508 requirement into name + specifier (lower bound shown).
    const nameMatch = req.match(/^([A-Za-z0-9._-]+)\s*(.*)$/)
    if (!nameMatch) continue
    const name = nameMatch[1]
    const spec = nameMatch[2].trim()
    reqs.push({ name, version: spec || '*' })
  }
  return reqs
}

// Build the python component list (DIRECT deps only) from the pyproject files.
export function collectPythonComponents() {
  const byPurl = new Map()
  for (const rel of PYPROJECT_VERSION_SOURCES) {
    const text = readTextSafe(rel)
    const projectVersion = parsePyprojectVersion(text)
    const deps = parsePyprojectDependencies(text)
    for (const dep of deps) {
      // Skip intra-monorepo deps (harness-core) — they are this repo, not a
      // third-party supply-chain component.
      if (/^harness-/i.test(dep.name)) continue
      const lower = dep.name.toLowerCase()
      const purl = `pkg:pypi/${lower}`
      if (byPurl.has(purl)) continue
      byPurl.set(purl, {
        type: 'library',
        name: dep.name,
        version: dep.version || projectVersion || '*',
        purl: `${purl}@${dep.version || '*'}`.replace(/@\*$/, '@unspecified'),
      })
    }
  }
  // Re-key sort by name for determinism.
  return [...byPurl.values()].sort((a, b) => a.purl.localeCompare(b.purl))
}

// Assemble the full CycloneDX 1.5 BOM. Deterministic except for the serial
// number / timestamp (which CycloneDX expects to be per-generation).
export function buildSbom() {
  const npm = collectNpmComponents()
  const python = collectPythonComponents()
  const components = [...npm, ...python]

  // Deterministic-ish serial number: a urn:uuid v4-shaped string derived so the
  // shape is valid CycloneDX (consumers only require a urn:uuid).
  const serial = `urn:uuid:${createHash('sha256')
    .update(components.map((c) => c.purl).join('|'))
    .digest('hex')
    .slice(0, 32)
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5')}`

  const rootVersion = readJson('package.json').version

  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: serial,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      component: {
        type: 'application',
        name: 'mission-control',
        version: rootVersion,
        purl: `pkg:generic/mission-control@${rootVersion}`,
      },
      properties: [
        {
          name: 'mission-control:node-deps',
          value: 'resolved from committed npm lockfiles (root + server + client)',
        },
        {
          name: 'mission-control:python-deps',
          value:
            'direct-only — hand-built from pyproject [project].dependencies; ' +
            'transitive python deps are NOT resolved (no committed python lockfile)',
        },
      ],
    },
    components,
  }
}

// CLI entry: write bom.json (or argv[2]) when run directly. Guarded so importing
// the module for tests never writes a file.
function isEntry() {
  if (!process.argv[1]) return false
  // Compare as file:// URLs so the comparison is platform-agnostic (Windows
  // drive letters and slash direction differ between argv and import.meta.url).
  return pathToFileURL(process.argv[1]).href === import.meta.url
}

if (isEntry()) {
  const outPath = process.argv[2] || 'bom.json'
  const bom = buildSbom()
  writeFileSync(outPath, JSON.stringify(bom, null, 2))
  const npmCount = bom.components.filter((c) => c.purl.startsWith('pkg:npm/')).length
  const pyCount = bom.components.filter((c) => c.purl.startsWith('pkg:pypi/')).length
  console.log(
    `generate-sbom: wrote ${bom.components.length} components ` +
      `(${npmCount} npm, ${pyCount} pypi direct) to ${outPath}`,
  )
}
