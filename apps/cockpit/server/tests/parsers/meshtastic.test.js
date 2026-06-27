import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { getMeshNodes } from '../../parsers/meshtastic.js'

let dir

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-test-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('getMeshNodes()', () => {
  it('degrades gracefully (never crashes) when the data path does not exist', () => {
    const missing = path.join(dir, 'does-not-exist')
    const result = getMeshNodes(missing)
    expect(result).toEqual({ nodes: [], degraded: true })
  })

  it('reads node records from a JSON array file with canonical fields', () => {
    const node = {
      nodeId: '!a1b2c3d4',
      shortName: 'BASE',
      snr: 12.5,
      lastHeard: 1719360000,
      battery: 87,
      hopLimit: 3,
      position: { lat: 40.1, lon: -111.6 },
    }
    fs.writeFileSync(path.join(dir, 'nodes.json'), JSON.stringify([node]))

    const result = getMeshNodes(dir)
    expect(result.degraded).toBe(false)
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0]).toMatchObject({
      nodeId: '!a1b2c3d4',
      shortName: 'BASE',
      snr: 12.5,
      lastHeard: 1719360000,
      battery: 87,
      hopLimit: 3,
      position: { lat: 40.1, lon: -111.6 },
    })
  })

  it('reads the { nodes: [...] } wrapper shape', () => {
    fs.writeFileSync(
      path.join(dir, 'export.json'),
      JSON.stringify({
        nodes: [
          { nodeId: 'n1', snr: 3 },
          { nodeId: 'n2', snr: 8 },
        ],
      }),
    )
    const result = getMeshNodes(dir)
    expect(result.nodes.map((n) => n.nodeId)).toEqual(['n1', 'n2'])
  })

  it('returns an empty (non-degraded) list when the path exists but holds no JSON', () => {
    fs.writeFileSync(path.join(dir, 'README.txt'), 'not json')
    const result = getMeshNodes(dir)
    expect(result).toEqual({ nodes: [], degraded: false })
  })

  it('skips an unparseable JSON file without crashing and keeps the good ones', () => {
    fs.writeFileSync(path.join(dir, 'broken.json'), '{ not valid json ')
    fs.writeFileSync(path.join(dir, 'good.json'), JSON.stringify([{ nodeId: 'ok' }]))
    const result = getMeshNodes(dir)
    expect(result.degraded).toBe(false)
    expect(result.nodes.map((n) => n.nodeId)).toEqual(['ok'])
  })

  it('drops records that have no identifiable node id', () => {
    fs.writeFileSync(
      path.join(dir, 'nodes.json'),
      JSON.stringify([{ snr: 5 }, { nodeId: 'keep', snr: 6 }]),
    )
    const result = getMeshNodes(dir)
    expect(result.nodes.map((n) => n.nodeId)).toEqual(['keep'])
  })
})
