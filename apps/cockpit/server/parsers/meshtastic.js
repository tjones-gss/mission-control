import fs from 'fs'
import path from 'path'
import { config } from '../lib/config.js'

// MeshMonitor / Meshtastic node integration. Reads JSON node dumps from a local
// data directory (MESHTASTIC_DATA_PATH, default ~/.meshtastic). This is opt-in
// hardware telemetry — if the tool isn't installed the directory won't exist, so
// the parser must DEGRADE (return { nodes: [], degraded: true }) and never throw.

// Normalize one raw record to the canonical node shape. Returns null for records
// with no identifiable node id (those are dropped). The spec field names are the
// contract; the secondary fallbacks (`num`, nested `user`/`deviceMetrics`) match
// the standard Meshtastic node-info JSON shape so a raw device export also works.
function normalizeNode(rec) {
  if (!rec || typeof rec !== 'object') return null
  const nodeId = rec.nodeId ?? rec.num ?? rec.id ?? null
  if (nodeId === null || nodeId === undefined) return null
  return {
    nodeId: String(nodeId),
    shortName: rec.shortName ?? rec.user?.shortName ?? null,
    snr: typeof rec.snr === 'number' ? rec.snr : null,
    lastHeard: rec.lastHeard ?? null,
    battery: rec.battery ?? rec.deviceMetrics?.batteryLevel ?? null,
    hopLimit: rec.hopLimit ?? rec.hopsAway ?? null,
    position: rec.position ?? null,
  }
}

// A node file may be a bare array, a { nodes: [...] } wrapper, or a single record.
function recordsFrom(parsed) {
  if (Array.isArray(parsed)) return parsed
  if (parsed && Array.isArray(parsed.nodes)) return parsed.nodes
  if (parsed && typeof parsed === 'object') return [parsed]
  return []
}

export function getMeshNodes(dataPath = config.meshtasticDataPath) {
  let entries
  try {
    entries = fs.readdirSync(dataPath)
  } catch {
    // Path missing / unreadable — MeshMonitor not installed. Degrade, never crash.
    return { nodes: [], degraded: true }
  }

  const nodes = []
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    let parsed
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(dataPath, name), 'utf-8'))
    } catch {
      // Unreadable or unparseable file — skip it, keep scanning the rest.
      continue
    }
    for (const rec of recordsFrom(parsed)) {
      const node = normalizeNode(rec)
      if (node) nodes.push(node)
    }
  }
  return { nodes, degraded: false }
}
