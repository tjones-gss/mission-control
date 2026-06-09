import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  repoRoot,
  PACKAGE_JSON_VERSION_SOURCES,
  PYPROJECT_VERSION_SOURCES,
  CONTRACTS_DISPLAY_SCHEMA_SOURCE,
  CONTRACTS_SIDECAR_SOURCE,
  SEMVER_RE,
  parsePyprojectVersion,
} from '../../../../../scripts/release/version-sources.js'

// SEMVER lockstep target for this phase (LOCKED: first tagged version off 0.1.0
// is 0.4.0). All 5 package.json + 2 pyproject.toml [project] versions agree.
const EXPECTED_VERSION = '0.4.0'

const ROOT = repoRoot()

function readJson(rel) {
  return JSON.parse(readFileSync(path.join(ROOT, rel), 'utf-8'))
}

describe('version single-sourcing (semver lockstep)', () => {
  it('enumerates exactly the 5 package.json + 2 pyproject version sources', () => {
    expect(PACKAGE_JSON_VERSION_SOURCES).toHaveLength(5)
    expect(PYPROJECT_VERSION_SOURCES).toHaveLength(2)
  })

  it('every package.json version is a valid semver', () => {
    for (const rel of PACKAGE_JSON_VERSION_SOURCES) {
      const { version } = readJson(rel)
      expect(typeof version, `${rel} missing version`).toBe('string')
      expect(SEMVER_RE.test(version), `${rel} version "${version}" is not valid semver`).toBe(true)
    }
  })

  it('every pyproject [project] version is a valid semver', () => {
    for (const rel of PYPROJECT_VERSION_SOURCES) {
      const version = parsePyprojectVersion(readFileSync(path.join(ROOT, rel), 'utf-8'))
      expect(typeof version, `${rel} missing [project] version`).toBe('string')
      expect(SEMVER_RE.test(version), `${rel} version "${version}" is not valid semver`).toBe(true)
    }
  })

  it('all 7 version sources agree on the same version', () => {
    const versions = new Set()
    for (const rel of PACKAGE_JSON_VERSION_SOURCES) {
      versions.add(readJson(rel).version)
    }
    for (const rel of PYPROJECT_VERSION_SOURCES) {
      versions.add(parsePyprojectVersion(readFileSync(path.join(ROOT, rel), 'utf-8')))
    }
    expect([...versions]).toEqual([EXPECTED_VERSION])
  })

  it('the agreed version is exactly 0.4.0 (LOCKED for this phase)', () => {
    expect(readJson('package.json').version).toBe(EXPECTED_VERSION)
  })
})

describe('contracts display schemaVersion matches the sidecar (single source of truth)', () => {
  it('the contracts package.json DISPLAY schemaVersion equals the sidecar schemaVersion', () => {
    const display = readJson(CONTRACTS_DISPLAY_SCHEMA_SOURCE).schemaVersion
    const sidecar = readJson(CONTRACTS_SIDECAR_SOURCE).schemaVersion
    expect(Number.isInteger(sidecar)).toBe(true)
    expect(display).toBe(sidecar)
  })

  it('the sidecar schemaVersion is 8 after the audit-event schema (S2)', () => {
    expect(readJson(CONTRACTS_SIDECAR_SOURCE).schemaVersion).toBe(8)
  })
})
