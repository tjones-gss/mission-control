// Phase I3 — knowledge graph (derived read-cache).
//
// Unit tests over the pure extractor (extractGraph) and the 2-hop neighbourhood
// query (getNeighbourhood) against a real temp-file db. Deterministic, no LLM:
// nodes + edges are pure functions of a session's transcript.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { openDb, closeDb, withTransaction } from '../../lib/db/connection.js'
import {
  extractGraph,
  reindexSessionGraph,
  getNeighbourhood,
} from '../../lib/db/knowledge-graph.js'

let tmpDir

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-graph-test-'))
  openDb(path.join(tmpDir, 'cockpit.db'))
})

afterEach(() => {
  closeDb()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// A transcript that edits two files, spawns a subagent, and makes a git commit.
function records() {
  return [
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', name: 'Edit', input: { file_path: '/repo/auth.js' } },
          { type: 'tool_use', name: 'Write', input: { file_path: '/repo/auth.test.js' } },
          { type: 'tool_use', name: 'Edit', input: { file_path: '/repo/auth.js' } },
          {
            type: 'tool_use',
            name: 'Task',
            input: { subagent_type: 'Explore', description: 'find callers' },
          },
          {
            type: 'tool_use',
            name: 'Bash',
            input: { command: 'git commit -m "fix auth bug"' },
          },
        ],
      },
    },
  ]
}

const SUMMARY = { sessionId: 'sess-1', slug: 'fix-auth', cwd: '/repo', model: 'claude-opus-4-8' }

describe('extractGraph', () => {
  it('emits a session node labelled by slug', () => {
    const { nodes } = extractGraph('sess-1', records(), SUMMARY)
    const session = nodes.find((n) => n.id === 'session:sess-1')
    expect(session).toBeTruthy()
    expect(session.kind).toBe('session')
    expect(session.label).toBe('fix-auth')
  })

  it('emits one file node per distinct path with a touched edge from the session', () => {
    const { nodes, edges } = extractGraph('sess-1', records(), SUMMARY)
    const files = nodes.filter((n) => n.kind === 'file')
    expect(files.map((f) => f.id).sort()).toEqual(['file:/repo/auth.js', 'file:/repo/auth.test.js'])
    // auth.js edited twice → still a single touched edge (deduped)
    const touched = edges.filter((e) => e.rel === 'touched')
    expect(touched).toHaveLength(2)
    expect(touched.every((e) => e.from_id === 'session:sess-1')).toBe(true)
  })

  it('emits a task node with a spawned edge for a Task tool call', () => {
    const { nodes, edges } = extractGraph('sess-1', records(), SUMMARY)
    const task = nodes.find((n) => n.kind === 'task')
    expect(task).toBeTruthy()
    expect(task.label).toBe('Explore')
    expect(edges.some((e) => e.rel === 'spawned' && e.to_id === task.id)).toBe(true)
  })

  it('emits a commit node with a produced edge, labelled by the commit message', () => {
    const { nodes, edges } = extractGraph('sess-1', records(), SUMMARY)
    const commit = nodes.find((n) => n.kind === 'commit')
    expect(commit).toBeTruthy()
    expect(commit.label).toBe('fix auth bug')
    expect(edges.some((e) => e.rel === 'produced' && e.to_id === commit.id)).toBe(true)
  })

  it('returns no edges (only the session node) for an empty transcript', () => {
    const { nodes, edges } = extractGraph('sess-1', [], SUMMARY)
    expect(nodes).toEqual([
      { id: 'session:sess-1', kind: 'session', label: 'fix-auth', meta: '{"cwd":"/repo"}' },
    ])
    expect(edges).toEqual([])
  })
})

describe('reindexSessionGraph + getNeighbourhood', () => {
  it('persists nodes and edges and returns the 1-hop neighbourhood of a session', () => {
    withTransaction((tx) => reindexSessionGraph(tx, 'sess-1', records(), SUMMARY))
    const { nodes, edges } = getNeighbourhood('session:sess-1')
    expect(nodes.find((n) => n.id === 'session:sess-1')).toBeTruthy()
    expect(nodes.filter((n) => n.kind === 'file')).toHaveLength(2)
    expect(edges.length).toBeGreaterThanOrEqual(4) // 2 touched + 1 spawned + 1 produced
  })

  it('is idempotent — reindexing the same session does not double edges', () => {
    withTransaction((tx) => reindexSessionGraph(tx, 'sess-1', records(), SUMMARY))
    withTransaction((tx) => reindexSessionGraph(tx, 'sess-1', records(), SUMMARY))
    const { edges } = getNeighbourhood('session:sess-1')
    expect(edges.filter((e) => e.rel === 'touched')).toHaveLength(2)
  })

  it('shares a file node across sessions — 2-hop from a file reaches both sessions', () => {
    withTransaction((tx) => reindexSessionGraph(tx, 'sess-1', records(), SUMMARY))
    const otherRecords = [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/repo/auth.js' } }],
        },
      },
    ]
    withTransaction((tx) =>
      reindexSessionGraph(tx, 'sess-2', otherRecords, {
        sessionId: 'sess-2',
        slug: 'other',
        cwd: '/repo',
      }),
    )
    const { nodes } = getNeighbourhood('file:/repo/auth.js')
    const sessionIds = nodes.filter((n) => n.kind === 'session').map((n) => n.id)
    expect(sessionIds.sort()).toEqual(['session:sess-1', 'session:sess-2'])
  })

  it('returns an empty neighbourhood for an unknown node', () => {
    expect(getNeighbourhood('session:nope')).toEqual({ nodes: [], edges: [] })
  })
})
