import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import contracts, {
  SCHEMA_VERSION,
  APPROVAL_SCHEMA_VERSION,
  pipelinePhaseSchema,
} from '@mission-control/contracts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The single canonical source of truth for the contracts package versions. Both
// the JS index and the Python harness DERIVE their numbers from this file — no
// hand-copying. The cross-language parity test lives in
// packages/harness/tests/test_contract.py; this test guards the JS side.
const SIDECAR_PATH = path.resolve(
  __dirname,
  '../../../../../packages/contracts/schema-version.json',
)
const sidecar = JSON.parse(readFileSync(SIDECAR_PATH, 'utf-8'))

const PIPELINE_PHASE_SCHEMA_PATH = path.resolve(
  __dirname,
  '../../../../../packages/contracts/schemas/pipeline-phase.schema.json',
)
const pipelinePhaseSchemaOnDisk = JSON.parse(readFileSync(PIPELINE_PHASE_SCHEMA_PATH, 'utf-8'))

function compile(schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  addFormats(ajv)
  return ajv.compile(schema)
}

describe('schema-version single-sourcing', () => {
  it('the sidecar carries both version concepts as integers', () => {
    expect(Number.isInteger(sidecar.schemaVersion)).toBe(true)
    expect(Number.isInteger(sidecar.approvalSchemaVersion)).toBe(true)
  })

  it('index.js DERIVES SCHEMA_VERSION from the sidecar (no hand-copy)', () => {
    expect(SCHEMA_VERSION).toBe(sidecar.schemaVersion)
    expect(contracts.SCHEMA_VERSION).toBe(sidecar.schemaVersion)
  })

  it('index.js DERIVES APPROVAL_SCHEMA_VERSION from the sidecar (separate concept)', () => {
    expect(APPROVAL_SCHEMA_VERSION).toBe(sidecar.approvalSchemaVersion)
    expect(contracts.APPROVAL_SCHEMA_VERSION).toBe(sidecar.approvalSchemaVersion)
  })

  it('the approval schemaVersion is a distinct, separately-versioned concept from the package SCHEMA_VERSION', () => {
    // They are deliberately allowed to differ: SCHEMA_VERSION versions the
    // contracts package as a whole; approvalSchemaVersion is the per-document
    // schemaVersion stamped into approval-request/decision files. This test
    // documents that they are sourced independently, not forced equal.
    expect(typeof SCHEMA_VERSION).toBe('number')
    expect(typeof APPROVAL_SCHEMA_VERSION).toBe('number')
  })
})

describe('pipeline-phase contract (ADR-0006)', () => {
  it('is exported from @mission-control/contracts', () => {
    expect(pipelinePhaseSchema).toBeTruthy()
    expect(pipelinePhaseSchema.$id).toBe(pipelinePhaseSchemaOnDisk.$id)
    expect(contracts.pipelinePhaseSchema).toBe(pipelinePhaseSchema)
    expect(contracts.schemas.pipelinePhase).toBe(pipelinePhaseSchema)
  })

  it('validates a representative phase', () => {
    const validate = compile(pipelinePhaseSchema)
    const ok = validate({
      id: 'implement',
      agent: 'harness-implementer',
      tier: 'implementation',
      gate: { required: ['tests_pass', 'scope_adherence'] },
      strategy: 'single',
      goal: 'Implement the parser version guard',
    })
    if (!ok) throw new Error(JSON.stringify(validate.errors, null, 2))
    expect(ok).toBe(true)
  })

  it('validates a fleet-strategy phase with an empty gate set', () => {
    const validate = compile(pipelinePhaseSchema)
    const ok = validate({
      id: 'fanout',
      agent: 'fleet',
      tier: 'implementation',
      gate: { required: [] },
      strategy: 'fleet',
      goal: 'Fan out three candidate solutions and verify',
    })
    if (!ok) throw new Error(JSON.stringify(validate.errors, null, 2))
    expect(ok).toBe(true)
  })

  it('rejects a bad phase (missing gate, unknown strategy, extra prop)', () => {
    const validate = compile(pipelinePhaseSchema)
    const ok = validate({
      id: 'broken',
      agent: 'x',
      tier: 'review',
      strategy: 'parallel', // not in enum
      goal: 'nope',
      surprise: true, // additionalProperties:false
      // gate omitted -> required violation
    })
    expect(ok).toBe(false)
  })
})
