import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The fleet-run schema is the contract for the persisted run JSON the cockpit
// writes (apps/cockpit/server/data/fleet/<id>.json). Item 1g added the TERMINAL
// 'orphaned' status (boot reconciler) and the durable child `pid`. This makes
// that contract executable: a committed golden ORPHANED sample must validate
// against the shared schema, and the schema must actually allow the orphaned
// shape — guarding against a future edit that quietly drops it.
const SAMPLE_PATH = path.resolve(__dirname, '../fixtures/fleet-run-orphaned.sample.json')
const SCHEMA_PATH = path.resolve(
  __dirname,
  '../../../../../packages/contracts/schemas/fleet-run.schema.json',
)

const sample = JSON.parse(readFileSync(SAMPLE_PATH, 'utf-8'))
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'))

describe('fleet-run contract: the orphaned golden sample validates against the shared schema', () => {
  it('the committed orphaned golden sample is schema-valid', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false })
    addFormats(ajv)
    const validate = ajv.compile(schema)
    const ok = validate(sample)
    if (!ok) {
      throw new Error(
        `orphaned golden sample failed schema validation: ${JSON.stringify(validate.errors, null, 2)}`,
      )
    }
    expect(ok).toBe(true)
  })

  it('the golden sample IS an orphaned run with an orphaned child', () => {
    expect(sample.status).toBe('orphaned')
    const orphanedChild = sample.children.find((c) => c.status === 'orphaned')
    expect(orphanedChild).toBeTruthy()
    // The durable registry field the reconciler relies on is present.
    expect(orphanedChild).toHaveProperty('pid')
  })

  it("the schema documents 'orphaned' on both the run and child status", () => {
    // Guards the 1g additions against a silent revert: if someone drops 'orphaned'
    // from the canonical status examples, this fails loudly.
    expect(schema.properties.status.examples).toContain('orphaned')
    const childStatus = schema.properties.children.items.properties.status
    expect(childStatus.examples).toContain('orphaned')
    // The durable pid registry field is part of the contract.
    expect(schema.properties.children.items.properties).toHaveProperty('pid')
  })
})
