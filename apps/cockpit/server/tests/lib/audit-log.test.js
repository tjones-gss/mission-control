import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import {
  recordAuditEvent,
  readAuditLog,
  setAuditLogPath,
  getAuditLogPath,
} from '../../lib/audit-log.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH = path.resolve(
  __dirname,
  '../../../../../packages/contracts/schemas/audit-event.schema.json',
)
const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'))

function compileSchema() {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  addFormats(ajv)
  return ajv.compile(schema)
}

let tmpDir
let logPath

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-log-'))
  logPath = path.join(tmpDir, 'audit.jsonl')
  setAuditLogPath(logPath)
})

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    /* best-effort cleanup */
  }
})

describe('audit-log: every recorded event is schema-valid', () => {
  it('stamps schemaVersion + ts and writes a record validating against audit-event.schema.json', async () => {
    const rec = await recordAuditEvent({
      eventType: 'spawn',
      source: 'cockpit',
      sessionId: 'sess-1',
    })
    const validate = compileSchema()
    expect(validate(rec)).toBe(true)
    // It stamped the required fields the caller did not provide. New records
    // carry the CURRENT contract version (the audit surface itself landed at
    // v9 and later bumps must never stamp lower).
    expect(rec.schemaVersion).toBeGreaterThanOrEqual(9)
    expect(typeof rec.ts).toBe('string')
    expect(new Date(rec.ts).toISOString()).toBe(rec.ts)
    expect(rec.eventType).toBe('spawn')
    expect(rec.source).toBe('cockpit')
  })

  it('records each eventType (spawn / approval / merge) as a schema-valid line', async () => {
    await recordAuditEvent({ eventType: 'spawn', source: 'cockpit' })
    await recordAuditEvent({
      eventType: 'approval',
      source: 'harness',
      decision: 'approved',
      controlState: { gateType: 'hard', decisionMaker: 'human' },
    })
    await recordAuditEvent({ eventType: 'merge', source: 'cockpit', subjectId: 'fleet/x/c0' })
    const lines = readAuditLog()
    expect(lines).toHaveLength(3)
    const validate = compileSchema()
    for (const line of lines) {
      expect(validate(line)).toBe(true)
    }
    expect(lines.map((l) => l.eventType)).toEqual(['spawn', 'approval', 'merge'])
  })

  it('rejects an event with an unknown eventType (fail closed, nothing written)', async () => {
    await expect(
      recordAuditEvent({ eventType: 'launch-missiles', source: 'cockpit' }),
    ).rejects.toThrow()
    expect(fs.existsSync(logPath)).toBe(false)
  })

  it('rejects an event with an unknown source (fail closed)', async () => {
    await expect(recordAuditEvent({ eventType: 'spawn', source: 'rogue' })).rejects.toThrow()
  })
})

// v9: an 'approval' MUST carry its control context (the schema's conditional);
// the writer enforces the same rule fail-closed, derived FROM the schema so the
// two cannot drift.
describe('audit-log v9: approval events require controlState (fail closed)', () => {
  it('rejects an approval WITHOUT controlState (nothing written)', async () => {
    await expect(
      recordAuditEvent({ eventType: 'approval', source: 'cockpit', decision: 'approved' }),
    ).rejects.toThrow(/controlState/)
    expect(fs.existsSync(logPath)).toBe(false)
  })

  it('rejects an approval whose controlState lacks gateType or decisionMaker', async () => {
    await expect(
      recordAuditEvent({
        eventType: 'approval',
        source: 'cockpit',
        controlState: { decisionMaker: 'human' },
      }),
    ).rejects.toThrow(/gateType/)
    await expect(
      recordAuditEvent({
        eventType: 'approval',
        source: 'cockpit',
        controlState: { gateType: 'hard' },
      }),
    ).rejects.toThrow(/decisionMaker/)
  })

  it('rejects an unknown gateType / decisionMaker value (closed enums from the schema)', async () => {
    await expect(
      recordAuditEvent({
        eventType: 'approval',
        source: 'cockpit',
        controlState: { gateType: 'vibes', decisionMaker: 'human' },
      }),
    ).rejects.toThrow(/gateType/)
    await expect(
      recordAuditEvent({
        eventType: 'approval',
        source: 'cockpit',
        controlState: { gateType: 'hard', decisionMaker: 'committee' },
      }),
    ).rejects.toThrow(/decisionMaker/)
  })

  it('accepts a spawn without controlState AND a spawn with an informational one', async () => {
    await recordAuditEvent({ eventType: 'spawn', source: 'cockpit' })
    const rec = await recordAuditEvent({
      eventType: 'spawn',
      source: 'cockpit',
      controlState: { decisionMaker: 'auto', policiesInForce: ['worktree-isolation'] },
    })
    const validate = compileSchema()
    expect(validate(rec)).toBe(true)
    expect(readAuditLog()).toHaveLength(2)
  })

  it('a written approval record validates against the v9 schema (ajv, conditional included)', async () => {
    const rec = await recordAuditEvent({
      eventType: 'approval',
      source: 'cockpit',
      decision: 'denied',
      controlState: {
        gateType: 'hard',
        decisionMaker: 'human',
        policiesInForce: ['budget-cap:12'],
      },
    })
    const validate = compileSchema()
    expect(validate(rec)).toBe(true)
  })
})

describe('audit-log: APPEND-ONLY invariant', () => {
  it('assigns a monotonically increasing seq to each record', async () => {
    const a = await recordAuditEvent({ eventType: 'spawn', source: 'cockpit' })
    const b = await recordAuditEvent({
      eventType: 'approval',
      source: 'cockpit',
      controlState: { gateType: 'hard', decisionMaker: 'human' },
    })
    const c = await recordAuditEvent({ eventType: 'merge', source: 'cockpit' })
    expect(a.seq).toBe(1)
    expect(b.seq).toBe(2)
    expect(c.seq).toBe(3)
  })

  it('seq continues from the existing tail across process restarts (resumes from disk)', async () => {
    await recordAuditEvent({ eventType: 'spawn', source: 'cockpit' })
    await recordAuditEvent({ eventType: 'spawn', source: 'cockpit' })
    // Simulate a fresh process: re-point at the SAME file (clears in-memory seq).
    setAuditLogPath(logPath)
    const next = await recordAuditEvent({ eventType: 'merge', source: 'cockpit' })
    expect(next.seq).toBe(3)
    expect(readAuditLog()).toHaveLength(3)
  })

  it('NEVER mutates or truncates prior lines — byte prefix is stable as records are appended', async () => {
    await recordAuditEvent({ eventType: 'spawn', source: 'cockpit', sessionId: 'A' })
    const after1 = fs.readFileSync(logPath, 'utf-8')
    await recordAuditEvent({
      eventType: 'approval',
      source: 'cockpit',
      sessionId: 'B',
      controlState: { gateType: 'hard', decisionMaker: 'human' },
    })
    const after2 = fs.readFileSync(logPath, 'utf-8')
    // The full content after the first write is a byte-exact PREFIX of the content
    // after the second write — proof no earlier byte was rewritten or truncated.
    expect(after2.startsWith(after1)).toBe(true)
    expect(after2.length).toBeGreaterThan(after1.length)
    // And the first line is byte-identical.
    expect(after2.split('\n')[0]).toBe(after1.split('\n')[0])
  })

  it('each record is exactly one newline-terminated JSON line (true JSONL)', async () => {
    await recordAuditEvent({ eventType: 'spawn', source: 'cockpit' })
    await recordAuditEvent({ eventType: 'merge', source: 'cockpit' })
    const raw = fs.readFileSync(logPath, 'utf-8')
    expect(raw.endsWith('\n')).toBe(true)
    const lines = raw.split('\n').filter(Boolean)
    expect(lines).toHaveLength(2)
    for (const l of lines) {
      expect(() => JSON.parse(l)).not.toThrow()
      expect(l.includes('\n')).toBe(false)
    }
  })
})

describe('audit-log: reader', () => {
  it('returns [] when the log does not exist yet', () => {
    setAuditLogPath(path.join(tmpDir, 'does-not-exist.jsonl'))
    expect(readAuditLog()).toEqual([])
  })

  it('skips a corrupt line rather than throwing', async () => {
    await recordAuditEvent({ eventType: 'spawn', source: 'cockpit' })
    fs.appendFileSync(logPath, 'this is not json\n')
    await recordAuditEvent({ eventType: 'merge', source: 'cockpit' })
    const lines = readAuditLog()
    expect(lines).toHaveLength(2)
    expect(lines.map((l) => l.eventType)).toEqual(['spawn', 'merge'])
  })

  it('getAuditLogPath reflects the configured path', () => {
    expect(getAuditLogPath()).toBe(logPath)
  })
})
