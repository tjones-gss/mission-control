import { useEffect, useState } from 'react'
import { RadioTower, BatteryMedium, Radio, Clock, Waypoints } from 'lucide-react'
import { useApi } from '../../hooks/useApi.js'

const POLL_MS = 10000

// SNR → confidence tier (spec §3.5): green ≥10dB, amber 5–10dB, red <5dB. A
// missing SNR is "unknown" (neutral) rather than silently rendering as healthy.
export function snrTier(snr) {
  if (typeof snr !== 'number') return 'unknown'
  if (snr >= 10) return 'green'
  if (snr >= 5) return 'amber'
  return 'red'
}

const TIER_COLOR = {
  green: 'var(--mc-ok)',
  amber: 'var(--mc-warn)',
  red: 'var(--mc-danger)',
  unknown: 'var(--mc-fg-4)',
}

// Meshtastic timestamps are unix *seconds*; tolerate millisecond values too.
export function relativeTime(ts, now = Date.now()) {
  if (ts === null || ts === undefined) return '—'
  const ms = ts < 1e12 ? ts * 1000 : ts
  const diff = Math.max(0, Math.round((now - ms) / 1000))
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function NodeCard({ node }) {
  const tier = snrTier(node.snr)
  const color = TIER_COLOR[tier]
  return (
    <div
      data-testid={`mesh-node-${node.nodeId}`}
      data-snr-tier={tier}
      className="rounded-lg p-3 flex flex-col gap-2"
      style={{
        background: 'var(--mc-surface)',
        border: '1px solid var(--mc-border)',
        borderLeft: `3px solid ${color}`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold" style={{ color: 'var(--mc-fg)' }}>
          {node.shortName || node.nodeId}
        </span>
        <span
          className="text-[11px] font-mono px-1.5 py-0.5 rounded"
          style={{ color, background: 'color-mix(in srgb, currentColor 15%, transparent)' }}
          title="Signal-to-noise ratio"
        >
          <Radio size={10} className="inline mr-1" />
          {typeof node.snr === 'number' ? `${node.snr} dB` : '— dB'}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px]" style={{ color: 'var(--mc-fg-3)' }}>
        <span className="flex items-center gap-1" title="Last heard">
          <Clock size={11} />
          {relativeTime(node.lastHeard)}
        </span>
        <span className="flex items-center gap-1" title="Battery">
          <BatteryMedium size={11} />
          {typeof node.battery === 'number' ? `${node.battery}%` : '—'}
        </span>
        <span className="flex items-center gap-1" title="Hop count">
          <Waypoints size={11} />
          {node.hopLimit ?? '—'} {node.hopLimit === 1 ? 'hop' : 'hops'}
        </span>
      </div>
    </div>
  )
}

export function MeshTab() {
  const [tick, setTick] = useState(0)
  const { data, loading } = useApi('/api/mesh/nodes', [tick])

  // Poll every 10s — MeshMonitor writes node telemetry continuously and there is
  // no SSE channel for it yet, so a lightweight interval keeps the grid live.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), POLL_MS)
    return () => clearInterval(id)
  }, [])

  const nodes = data?.nodes ?? []

  if (loading && nodes.length === 0) {
    return (
      <div className="p-4 text-xs" style={{ color: 'var(--mc-fg-4)' }}>
        Loading mesh nodes…
      </div>
    )
  }

  if (nodes.length === 0) {
    return (
      <div
        className="p-8 text-center text-xs flex flex-col items-center gap-2"
        style={{ color: 'var(--mc-fg-4)' }}
      >
        <RadioTower size={24} style={{ color: 'var(--mc-fg-5)' }} />
        <div>
          No MeshMonitor data found — set{' '}
          <code style={{ color: 'var(--mc-fg-3)' }}>MESHTASTIC_DATA_PATH</code> to your data
          directory
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-3 overflow-y-auto h-full">
      <div className="flex items-center gap-2">
        <RadioTower size={13} style={{ color: 'var(--mc-accent)' }} />
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--mc-fg-3)' }}
        >
          Mesh Nodes
        </span>
        <span className="text-xs" style={{ color: 'var(--mc-fg-4)' }}>
          {nodes.length}
        </span>
      </div>
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {nodes.map((node) => (
          <NodeCard key={node.nodeId} node={node} />
        ))}
      </div>
    </div>
  )
}
