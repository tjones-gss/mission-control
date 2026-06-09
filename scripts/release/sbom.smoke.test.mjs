// SBOM smoke test (node:test, zero external deps). Lives under scripts/release/
// — OUTSIDE the server coverage include globs — so it does not move the floor.
//
// Asserts generate-sbom.mjs produces a valid CycloneDX 1.5 document whose
// components span BOTH ecosystems: at least one npm component (e.g. express,
// from the node lockfiles) and at least one PyPI component (e.g. pyyaml, from
// the hand-built python [project] list). The python transitive graph is NOT
// resolved (offline lockfile mode) — this test only proves both ecosystems are
// represented, matching what the generator honestly claims.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildSbom } from './generate-sbom.mjs'

test('buildSbom emits a CycloneDX 1.5 bom document', () => {
  const bom = buildSbom()
  assert.equal(bom.bomFormat, 'CycloneDX')
  assert.equal(bom.specVersion, '1.5')
  assert.ok(typeof bom.serialNumber === 'string' && bom.serialNumber.length > 0)
  assert.ok(bom.metadata && bom.metadata.timestamp, 'metadata.timestamp present')
  assert.ok(Array.isArray(bom.components), 'components is an array')
  assert.ok(bom.components.length > 0, 'at least one component')
})

test('every component has the required CycloneDX fields', () => {
  const bom = buildSbom()
  for (const c of bom.components) {
    assert.equal(c.type, 'library')
    assert.ok(typeof c.name === 'string' && c.name.length > 0, 'component name')
    assert.ok(typeof c.version === 'string' && c.version.length > 0, 'component version')
    assert.ok(typeof c.purl === 'string' && c.purl.startsWith('pkg:'), 'component purl')
  }
})

test('components span BOTH ecosystems (npm + pypi)', () => {
  const bom = buildSbom()
  const purls = bom.components.map((c) => c.purl)
  assert.ok(
    purls.some((p) => p.startsWith('pkg:npm/')),
    'expected at least one npm component',
  )
  assert.ok(
    purls.some((p) => p.startsWith('pkg:pypi/')),
    'expected at least one pypi component',
  )
})

test('the canonical example components are present (express + a python dep)', () => {
  const bom = buildSbom()
  const names = new Set(bom.components.map((c) => c.name.toLowerCase()))
  assert.ok(names.has('express'), 'express (npm) component present')
  assert.ok(
    names.has('pyyaml') || names.has('jsonschema'),
    'a python (pypi) dependency component present',
  )
})

test('npm components are deduped by name@version', () => {
  const bom = buildSbom()
  const npm = bom.components
    .filter((c) => c.purl.startsWith('pkg:npm/'))
    .map((c) => `${c.name}@${c.version}`)
  assert.equal(npm.length, new Set(npm).size, 'no duplicate name@version npm components')
})

test('honestly records that python transitive deps are not resolved', () => {
  const bom = buildSbom()
  // The generator stamps a note in metadata.properties so consumers know the
  // python component list is direct-only (hand-built from pyproject [project]).
  const props = bom.metadata.properties || []
  const note = props.find((p) => p.name === 'mission-control:python-deps')
  assert.ok(note, 'python-deps note property present')
  assert.match(note.value, /direct/i)
})
