import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Paths to the committed golden sample and the shared contract schema. The
// schema lives in packages/contracts and (before this test existed) was imported
// by ZERO files — so drift between the CLI's `--json` output and the cockpit's
// reader shipped silently. This test makes the contract executable.
const SAMPLE_PATH = path.resolve(__dirname, '../fixtures/harness-status.sample.json')
const SCHEMA_PATH = path.resolve(
  __dirname,
  '../../../../../packages/contracts/schemas/harness-status.schema.json',
)

const sample = JSON.parse(readFileSync(SAMPLE_PATH, 'utf-8'))
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'))

const PROJECT = 'C:/golden-proj'

// ── Mocks ────────────────────────────────────────────────────────────────────
// We exercise the REAL parser end-to-end (shapeSummary is private, so we go
// through the public getHarnessProjects/getHarnessProjectByPath). To do that
// without spawning a real python process, we mock:
//   - conductor.getSessionCwds → the whitelisted root
//   - fs.statSync → make the root look like a valid .harness project
//   - node:child_process.spawn → emit the golden sample as stdout, exit 0
vi.mock('../../parsers/conductor.js', () => ({
  getSessionCwds: vi.fn(() => [PROJECT]),
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal()
  const statSync = vi.fn(() => ({ isFile: () => true }))
  return { ...actual, default: { ...actual.default, statSync }, statSync }
})

vi.mock('node:child_process', () => {
  const spawn = vi.fn(() => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stdout.setEncoding = () => {}
    child.stderr = new EventEmitter()
    child.kill = () => {}
    // Emit the golden sample as the CLI would, then close successfully.
    setImmediate(() => {
      child.stdout.emit('data', JSON.stringify(sample))
      child.emit('close', 0)
    })
    return child
  })
  return { spawn }
})

// Import AFTER the mocks are registered.
import {
  getHarnessProjects,
  getHarnessProjectByPath,
} from '../../parsers/harness.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('harness-status contract: golden sample validates against the shared schema', () => {
  it('the committed golden sample is schema-valid', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false })
    addFormats(ajv)
    const validate = ajv.compile(schema)
    const ok = validate(sample)
    if (!ok) {
      throw new Error(
        `golden sample failed schema validation: ${JSON.stringify(validate.errors, null, 2)}`,
      )
    }
    expect(ok).toBe(true)
  })

  it('the schema declares readiness under `readiness_overall` (the CLI key)', () => {
    // Guards the structural fix: if someone renames the schema key back to
    // `readiness`, this fails loudly.
    expect(schema.properties).toHaveProperty('readiness_overall')
    expect(schema.properties).not.toHaveProperty('readiness')
  })

  it('the golden sample carries readiness_overall with score + mvp_ready', () => {
    expect(sample.readiness_overall).toBeTypeOf('object')
    expect(sample.readiness_overall).toHaveProperty('score')
    expect(sample.readiness_overall).toHaveProperty('mvp_ready')
  })
})

describe('harness-status contract: the parser maps readiness correctly', () => {
  // These assertions FAIL if the parser drifts back to reading `status.readiness`
  // instead of `status.readiness_overall`.
  it('getHarnessProjects surfaces a non-null readiness with score + mvp_ready', async () => {
    const projects = await getHarnessProjects()
    expect(projects).toHaveLength(1)
    const summary = projects[0]
    expect(summary.available).toBe(true)
    expect(summary.readiness).not.toBeNull()
    expect(summary.readiness.score).toBe(sample.readiness_overall.score)
    expect(summary.readiness.mvp_ready).toBe(sample.readiness_overall.mvp_ready)
  })

  it('getHarnessProjectByPath spreads the raw status including readiness_overall', async () => {
    const detail = await getHarnessProjectByPath(PROJECT)
    expect(detail).not.toBeNull()
    // The detail endpoint returns the raw status, so the client reads
    // status.readiness_overall.{score,mvp_ready} directly.
    expect(detail.readiness_overall).toEqual(sample.readiness_overall)
  })
})
