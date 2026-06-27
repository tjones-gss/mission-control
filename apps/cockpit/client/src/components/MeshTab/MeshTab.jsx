import { RadioTower, Battery, Radio, Clock } from 'lucide-react'
import { useApi } from '../../hooks/useApi.js'

// EXPERIMENTAL (ADR-0007 / GOALS_MESH_TAB) — the MeshMonitor/Meshtastic tab.
// Reads parsed LoRa node data from GET /api/mesh/nodes and renders a grid of
// node cards color-coded by SNR tier. The route degrades gracefully when no
// MeshMonitor data dir is present, so this surface shows an empty state rather
// than an error in the common (no-hardware) case. --mc-* tokens only.

// SNR margin → confidence tier (matches the SF→confidence bridge): green ≥10dB,
// amber 5–10dB, red <5dB. Unknown SNR renders neutral.
function snrTier(snr) {
  if (typeof snr !== 'number') return { color: 'var(--mc-fg-4)', bg: 'var(--mc-surface-2)' }
  if (snr >= 10) return { color: 'var(--mc-ok)', bg: 'var(--mc-ok-soft)' }
  if (snr >= 5) return { color: 'var(--mc-warn)', bg: 'var(--mc-warn-soft)' }
  return { color: 'var(--mc-danger)', bg: 'var(--mc-danger-soft)' }
}

function lastHeard(ms) {
  if (!ms) return '—'
  const secs = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (secs < 60) return `${secs}s ago`
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

function NodeCard({ node }) {
  const tier = snrTier(node.snr)
  return (
    <div className="rounded-lg border border-[var(--mc-border)] bg-[var(--mc-surface)] p-3.5">
      <div className="flex items-center gap-2">
        <RadioTower size={14} className="shrink-0 text-[var(--mc-accent)]" />
        <span className="truncate text-sm font-semibold text-[var(--mc-fg)]">
          {node.shortName || node.nodeId}
        </span>
        {typeof node.snr === 'number' && (
          <span
            className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ color: tier.color, backgroundColor: tier.bg }}
          >
            {node.snr.toFixed(1)} dB
          </span>
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--mc-fg-3)]">
        <span className="flex items-center gap-1">
          <Clock size={11} className="text-[var(--mc-fg-4)]" /> {lastHeard(node.lastHeard)}
        </span>
        {typeof node.battery === 'number' && (
          <span className="flex items-center gap-1">
            <Battery size={11} className="text-[var(--mc-fg-4)]" /> {node.battery}%
          </span>
        )}
        {typeof node.hopLimit === 'number' && (
          <span className="flex items-center gap-1">
            <Radio size={11} className="text-[var(--mc-fg-4)]" /> {node.hopLimit} hop
            {node.hopLimit === 1 ? '' : 's'}
          </span>
        )}
      </div>
    </div>
  )
}

export function MeshTab() {
  const { data, loading } = useApi('/api/mesh/nodes')
  const nodes = Array.isArray(data?.nodes) ? data.nodes : []

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--mc-bg)]">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-7">
        <div className="mb-4 flex items-center gap-2.5">
          <RadioTower size={18} className="text-[var(--mc-accent)]" />
          <h2 className="text-[15px] font-bold text-[var(--mc-fg)]">Meshtastic nodes</h2>
          <span className="rounded-full bg-[var(--mc-surface)] px-2 py-0.5 text-xs font-semibold text-[var(--mc-fg-4)]">
            {nodes.length}
          </span>
        </div>

        {loading && nodes.length === 0 ? (
          <div className="rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface)] px-5 py-7 text-center text-sm text-[var(--mc-fg-3)]">
            Loading mesh nodes…
          </div>
        ) : nodes.length === 0 ? (
          <div className="rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface)] px-5 py-10 text-center text-sm text-[var(--mc-fg-3)]">
            No MeshMonitor data found — set{' '}
            <span className="font-mono text-[var(--mc-fg-2)]">MESHTASTIC_DATA_PATH</span> to your
            data directory.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {nodes.map((node) => (
              <NodeCard key={node.nodeId} node={node} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
