import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

import { buildOpenApiSpec, CORE_PATHS } from '../../lib/openapi.js'

// The server package version is the SINGLE source of the OpenAPI info.version
// (set to 0.4.0 by S3 — read, never hardcoded). Reading it here lets the test
// assert the spec tracks the package without pinning a literal that would rot.
const require = createRequire(import.meta.url)
const serverPkg = require('../../package.json')

describe('buildOpenApiSpec()', () => {
  it('returns an OpenAPI 3.x document', () => {
    const spec = buildOpenApiSpec()
    expect(typeof spec.openapi).toBe('string')
    expect(spec.openapi).toMatch(/^3\./)
  })

  it('sets info.title and reads info.version from the server package version', () => {
    const spec = buildOpenApiSpec()
    expect(spec.info.title).toBe('Mission Control Cockpit API')
    expect(spec.info.version).toBe(serverPkg.version)
  })

  it('has a non-empty paths object (annotations were actually picked up)', () => {
    const spec = buildOpenApiSpec()
    expect(spec.paths).toBeTypeOf('object')
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0)
  })

  it('includes every declared CORE path so the parity test cannot silently drift', () => {
    const spec = buildOpenApiSpec()
    expect(CORE_PATHS.length).toBeGreaterThan(0)
    for (const p of CORE_PATHS) {
      expect(spec.paths, `expected CORE path ${p} in the spec`).toHaveProperty(p)
    }
  })

  it('produces a deterministic, JSON-serializable spec (no throw, stable across calls)', () => {
    const a = JSON.stringify(buildOpenApiSpec())
    const b = JSON.stringify(buildOpenApiSpec())
    expect(() => JSON.parse(a)).not.toThrow()
    expect(a).toBe(b)
  })
})
