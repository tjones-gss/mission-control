import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import { SCHEMA_VERSION } from '@mission-control/contracts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The audit-event schema is the contracts-first foundation for the audit log
// (Phase 4 / D-audit-otel). SCHEMA ONLY this landing — no emitter writes audit
// records yet. This test makes the contract executable: a committed golden
// audit-event sample must validate against the shared schema, and the schema
// must carry the canonical eventType/source enums so a future edit can't quietly
// drop them. Adding this consumable record type bumps the sidecar surface 7 -> 8.
const SAMPLE_PATH = path.resolve(__dirname, '../fixtures/audit-event.sample.json')
const SCHEMA_PATH = path.resolve(
  __dirname,
  '../../../../../packages/contracts/schemas/audit-event.schema.json',
)

const sample = JSON.parse(readFileSync(SAMPLE_PATH, 'utf-8'))
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'))

function compile(s) {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  addFormats(ajv)
  return ajv.compile(s)
}

describe('audit-event contract: the golden sample validates against the shared schema', () => {
  it('the committed golden audit-event sample is schema-valid', () => {
    const validate = compile(schema)
    const ok = validate(sample)
    if (!ok) {
      throw new Error(
        `audit-event golden sample failed schema validation: ${JSON.stringify(validate.errors, null, 2)}`,
      )
    }
    expect(ok).toBe(true)
  })

  it('the schema documents the canonical eventType and source enums', () => {
    expect(schema.properties.eventType.enum).toEqual(
      expect.arrayContaining(['spawn', 'approval', 'merge']),
    )
    expect(schema.properties.source.enum).toEqual(expect.arrayContaining(['cockpit', 'harness']))
  })

  it('schemaVersion / ts / eventType / source are required', () => {
    expect(schema.required).toEqual(
      expect.arrayContaining(['schemaVersion', 'ts', 'eventType', 'source']),
    )
  })

  it('rejects an event with an unknown eventType', () => {
    const validate = compile(schema)
    const bad = { ...sample, eventType: 'launch-missiles' }
    expect(validate(bad)).toBe(false)
  })

  it('rejects an event with an unknown source vendor', () => {
    const validate = compile(schema)
    const bad = { ...sample, source: 'rogue-vendor' }
    expect(validate(bad)).toBe(false)
  })

  it("the golden sample's schemaVersion matches the package SCHEMA_VERSION (8)", () => {
    // The audit-event surface lands at sidecar v8; the sample stamps the same.
    expect(sample.schemaVersion).toBe(SCHEMA_VERSION)
    expect(SCHEMA_VERSION).toBe(8)
  })

  it('the schema uses vendor-NEUTRAL language (no claude/anthropic/cursor/codex)', () => {
    const blob = JSON.stringify(schema).toLowerCase()
    for (const vendor of ['claude', 'anthropic', 'cursor', 'codex']) {
      expect(blob).not.toContain(vendor)
    }
  })
})
