import { useState } from 'react'
import './MeshView.css'

// MeshView — live SVG topology of every session orbiting a central Dispatch hub.
// Pure client view: it consumes the already-fetched `sessions` array via props and
// re-layouts when `sessionsVersion` changes. No new API surface (spec §3.2, §5).
export function MeshView({ sessions = [], sessionsVersion, onSelectSession }) {
  const [selected, setSelected] = useState(null)

  return (
    <div className="mesh-root">
      <svg className="mesh-canvas" role="img" aria-label="Agent topology mesh" />
      <div data-panel className={`mesh-panel${selected ? ' open' : ''}`} />
    </div>
  )
}
