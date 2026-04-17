import { useCallback, useEffect, useState } from 'react'
import { X, Home, ChevronUp, Folder } from 'lucide-react'

function joinPath(base, name, sep) {
  if (!base) return name
  if (base.endsWith(sep)) return base + name
  return base + sep + name
}

export function FolderPicker({ onSelect, onClose, recentCwds = [] }) {
  const [path, setPath] = useState('')
  const [parent, setParent] = useState(null)
  const [sep, setSep] = useState('/')
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showHidden, setShowHidden] = useState(false)

  const loadPath = useCallback(async (target) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/fs/list?path=${encodeURIComponent(target)}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`)
        setEntries([])
        return
      }
      setPath(data.path)
      setParent(data.parent)
      setSep(data.sep || '/')
      setEntries(data.entries || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const goHome = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/fs/home')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`)
        return
      }
      if (data.sep) setSep(data.sep)
      await loadPath(data.path)
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }, [loadPath])

  useEffect(() => {
    goHome()
  }, [goHome])

  const visibleEntries = showHidden ? entries : entries.filter((e) => !e.name.startsWith('.'))

  const handleSelect = (p) => {
    onSelect?.(p)
    onClose?.()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg max-w-lg w-full mx-4 flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <h2 className="text-sm font-semibold text-gray-200">Select working directory</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {recentCwds.length > 0 && (
          <div className="px-4 py-2 border-b border-gray-800">
            <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Recent</div>
            <div className="flex flex-wrap gap-1">
              {recentCwds.map((cwd) => (
                <button
                  key={cwd}
                  onClick={() => handleSelect(cwd)}
                  className="text-[11px] text-gray-300 bg-gray-800 hover:bg-gray-700 px-2 py-0.5 rounded truncate max-w-full"
                  title={cwd}
                >
                  {cwd}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-800">
          <button
            onClick={goHome}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 px-1.5 py-1 rounded hover:bg-gray-800"
            aria-label="Home"
          >
            <Home size={12} /> Home
          </button>
          {parent && (
            <button
              onClick={() => loadPath(parent)}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 px-1.5 py-1 rounded hover:bg-gray-800"
              aria-label="Parent directory"
            >
              <ChevronUp size={12} /> Up
            </button>
          )}
          <label className="ml-auto flex items-center gap-1 text-[11px] text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
              className="rounded border-gray-700 bg-gray-900 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0"
            />
            Show hidden
          </label>
        </div>

        <div className="px-4 py-1.5 border-b border-gray-800 text-xs font-mono text-gray-300 truncate">
          {path || '\u00a0'}
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && <div className="px-4 py-6 text-xs text-gray-500">Loading...</div>}
          {!loading && error && <div className="px-4 py-6 text-xs text-red-400">{error}</div>}
          {!loading && !error && visibleEntries.length === 0 && (
            <div className="px-4 py-6 text-xs text-gray-600">No subdirectories</div>
          )}
          {!loading && !error && visibleEntries.length > 0 && (
            <ul>
              {visibleEntries.map((entry) => (
                <li key={entry.name}>
                  <button
                    onClick={() => loadPath(joinPath(path, entry.name, sep))}
                    className="w-full flex items-center gap-2 px-4 py-1.5 text-xs text-gray-300 hover:bg-gray-800 text-left"
                  >
                    <Folder size={12} className="text-gray-500 shrink-0" />
                    <span className="truncate">{entry.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 rounded hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={() => handleSelect(path)}
            disabled={!path || loading}
            className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Select this directory
          </button>
        </div>
      </div>
    </div>
  )
}
