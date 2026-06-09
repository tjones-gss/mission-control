import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

// AUDIT WIRING (Phase 4 / D-audit-otel): proves every spawn/approval/merge call
// site routes through the cockpit's SOLE audit writer with a record that VALIDATES
// against the shared contract. We mock lib/audit-log.js so each test asserts the
// exact event handed to the writer (and runs it through the real schema), without
// touching the filesystem. The append-only writer itself is covered separately by
// tests/lib/audit-log.test.js.

const recorded = []
vi.mock('../../lib/audit-log.js', () => ({
  recordAuditEventSafe: vi.fn((e) => {
    recorded.push(e)
    return Promise.resolve(e)
  }),
  recordAuditEvent: vi.fn((e) => {
    recorded.push(e)
    return Promise.resolve(e)
  }),
}))

vi.mock('../../lib/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const schema = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../../../packages/contracts/schemas/audit-event.schema.json'),
    'utf-8',
  ),
)
function validateAgainstContract(event) {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  addFormats(ajv)
  // The wiring hands a PARTIAL event (the writer stamps schemaVersion/ts/seq).
  // Stamp them here so the merged record is what would actually be written, then
  // validate THAT against the contract — proving the call site produces a valid
  // record once the writer adds its fields.
  const full = { schemaVersion: 8, ts: new Date().toISOString(), seq: 1, ...event }
  const ok = ajv.compile(schema)(full)
  return { ok, full }
}

beforeEach(() => {
  recorded.length = 0
  vi.clearAllMocks()
})

// ── Route paths: trust grant + tool-approval + front-door spawn ────────────────
describe('approval wiring — trust grant (routes/trust.js)', () => {
  it('records a schema-valid approval event on a successful trust grant', async () => {
    vi.resetModules()
    const trusted = new Set()
    vi.doMock('../../lib/trust-store.js', () => ({
      isCwdTrusted: (c) => trusted.has(c),
      trustCwd: (c) => {
        if (!c) return false
        trusted.add(c)
        return true
      },
      untrustCwd: (c) => trusted.delete(c) || true,
      listTrustedCwds: () => [...trusted],
    }))
    const express = (await import('express')).default
    const request = (await import('supertest')).default
    const { router } = await import('../../routes/trust.js')
    const app = express()
    app.use(express.json())
    app.use('/', router)

    const CWD = path.resolve('/work/trusted-proj')
    const res = await request(app).post('/').send({ cwd: CWD })
    expect(res.status).toBe(200)
    expect(recorded).toHaveLength(1)
    const ev = recorded[0]
    expect(ev.eventType).toBe('approval')
    expect(ev.source).toBe('cockpit')
    expect(ev.decision).toBe('approved')
    expect(ev.subjectId).toBe(CWD)
    expect(validateAgainstContract(ev).ok).toBe(true)
  })

  it('records NOTHING when the grant is rejected (invalid cwd)', async () => {
    vi.resetModules()
    vi.doMock('../../lib/trust-store.js', () => ({
      isCwdTrusted: () => false,
      trustCwd: vi.fn(),
      untrustCwd: vi.fn(),
      listTrustedCwds: () => [],
    }))
    const express = (await import('express')).default
    const request = (await import('supertest')).default
    const { router } = await import('../../routes/trust.js')
    const app = express()
    app.use(express.json())
    app.use('/', router)
    const res = await request(app).post('/').send({ cwd: 'relative/path' })
    expect(res.status).toBe(400)
    expect(recorded).toHaveLength(0)
  })
})

describe('approval wiring — tool-approval (routes/sessions.js)', () => {
  async function loadSessionsApp({ resolved }) {
    vi.resetModules()
    vi.doMock('../../pty-session.js', () => ({
      startQuery: vi.fn(),
      spawnNewSession: vi.fn(),
      isQueryActive: vi.fn(),
      getQueryStatus: vi.fn(() => ({})),
      resolveApproval: vi.fn(() => resolved),
      cancelQuery: vi.fn(),
      VALID_PERMISSION_MODES: [],
      VALID_MODEL_SHORTCUTS: [],
    }))
    const express = (await import('express')).default
    const request = (await import('supertest')).default
    const { router } = await import('../../routes/sessions.js')
    const app = express()
    app.use(express.json())
    app.use('/', router)
    return { app, request }
  }

  it('records a schema-valid approval event when a tool-approval resolves', async () => {
    const { app, request } = await loadSessionsApp({ resolved: true })
    const res = await request(app)
      .post('/sess-1/tool-approval')
      .send({ approvalId: 'appr-9', decision: 'allow' })
    expect(res.status).toBe(200)
    expect(recorded).toHaveLength(1)
    const ev = recorded[0]
    expect(ev.eventType).toBe('approval')
    expect(ev.source).toBe('cockpit')
    expect(ev.sessionId).toBe('sess-1')
    expect(ev.subjectId).toBe('appr-9')
    expect(ev.decision).toBe('approved')
    expect(validateAgainstContract(ev).ok).toBe(true)
  })

  it('records NOTHING when the approval was not found (404)', async () => {
    const { app, request } = await loadSessionsApp({ resolved: false })
    const res = await request(app)
      .post('/sess-1/tool-approval')
      .send({ approvalId: 'missing', decision: 'deny' })
    expect(res.status).toBe(404)
    expect(recorded).toHaveLength(0)
  })

  it('records a schema-valid spawn event on the front-door POST /new path', async () => {
    vi.resetModules()
    vi.doMock('../../pty-session.js', () => ({
      startQuery: vi.fn(),
      spawnNewSession: vi.fn(),
      isQueryActive: vi.fn(),
      getQueryStatus: vi.fn(() => ({})),
      resolveApproval: vi.fn(),
      cancelQuery: vi.fn(),
      VALID_PERMISSION_MODES: [],
      VALID_MODEL_SHORTCUTS: [],
    }))
    vi.doMock('../../claude-cli.js', () => ({
      runClaude: vi.fn(),
      runClaudeCancellable: vi.fn(() => ({
        promise: Promise.resolve({ stdout: '{"type":"result","result":"ok"}\n', stderr: '' }),
        cancel: vi.fn(),
      })),
    }))
    vi.doMock('../../lib/pending-session.js', () => ({
      // Resolve the ack fast so POST /new returns 202 without waiting 15s.
      awaitNewSession: vi.fn(() => Promise.resolve('sess-new-1')),
    }))
    const express = (await import('express')).default
    const request = (await import('supertest')).default
    const { router } = await import('../../routes/sessions.js')
    const app = express()
    app.use(express.json())
    app.use('/', router)
    const CWD = path.resolve('/work/proj')
    const res = await request(app).post('/new').send({ cwd: CWD, prompt: 'do a thing' })
    expect([201, 202]).toContain(res.status)
    const spawnEvents = recorded.filter((e) => e.eventType === 'spawn')
    expect(spawnEvents).toHaveLength(1)
    expect(spawnEvents[0].source).toBe('cockpit')
    expect(spawnEvents[0].payload.cwd).toBe(CWD)
    expect(validateAgainstContract(spawnEvents[0]).ok).toBe(true)
  })
})
