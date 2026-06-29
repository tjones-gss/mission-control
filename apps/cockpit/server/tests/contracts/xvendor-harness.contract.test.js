import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Sprint 2-d, consumer side: the cockpit's harness parser must ingest a
// NON-CLAUDE harness `status --json` payload without throwing and without making
// any claude-specific assumption. The schema-level proof (the same payload
// validates against the shared contract) lives in
// packages/contracts/tests/xvendor-contract.test.js — this is its complement:
// the real reader handles the same fixture. Together they prove ADR-0005's
// vendor-neutral contract is honored on BOTH sides of the boundary.
//
// We load the SINGLE source-of-truth fixture from the contracts package (not a
// local copy) so the consumer test and the schema test exercise the identical
// bytes — if the fixture changes, both move together.
const SYNTHETIC_FIXTURE_PATH = path.resolve(
  __dirname,
  '../../../../../packages/contracts/fixtures/synthetic-non-claude-harness.json',
)
const synthetic = JSON.parse(readFileSync(SYNTHETIC_FIXTURE_PATH, 'utf-8'))

const PROJECT = 'C:/xvendor-proj'

// Mock the spawn boundary so the parser ingests the synthetic non-Claude payload
// as if `harness status --json` had emitted it — no real python process.
vi.mock('../../lib/session-discovery.js', () => ({
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
    setImmediate(() => {
      child.stdout.emit('data', JSON.stringify(synthetic))
      child.emit('close', 0)
    })
    return child
  })
  return { spawn }
})

// Import AFTER the mocks are registered.
import { getHarnessProjects, getHarnessProjectByPath } from '../../parsers/harness.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('cross-vendor: the cockpit parser accepts a non-Claude harness payload', () => {
  it('the fixture under test is genuinely non-Claude', () => {
    expect(synthetic.vendor).toBe('openai-codex')
    expect(synthetic.vendor).not.toBe('claude')
  })

  it('getHarnessProjects shapes the non-Claude status without throwing', async () => {
    const projects = await getHarnessProjects()
    expect(projects).toHaveLength(1)
    const summary = projects[0]
    expect(summary.available).toBe(true)
    expect(summary.error).toBeNull()
    // The parser reads only vendor-neutral fields — these come straight from the
    // openai-codex payload, proving no claude-specific assumption is baked in.
    expect(summary.mode).toBe('feature-development')
    expect(summary.pipeline).not.toBeNull()
    expect(summary.pipeline.phase).toBe('implement')
    expect(summary.pipeline.goal).toBe(synthetic.pipeline.goal)
    expect(summary.readiness).not.toBeNull()
    expect(summary.readiness.score).toBe(synthetic.readiness_overall.score)
    expect(summary.next.recommended_agent).toBe('codex-implementer')
    expect(summary.blocked).toBe(false)
  })

  it('getHarnessProjectByPath spreads the raw non-Claude status verbatim', async () => {
    const detail = await getHarnessProjectByPath(PROJECT)
    expect(detail).not.toBeNull()
    // The detail endpoint returns the raw status, so vendor-specific extension
    // fields survive untouched for the client to render.
    expect(detail.vendor).toBe('openai-codex')
    expect(detail.version).toEqual(synthetic.version)
    expect(detail.sessions).toEqual(synthetic.sessions)
    expect(detail.pipeline).toEqual(synthetic.pipeline)
  })
})
