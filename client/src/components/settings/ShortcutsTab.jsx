import { useState, useEffect } from 'react'
import { ACTION_LABELS } from '../../hooks/useKeyboardShortcuts.js'

export function ShortcutsTab({ shortcuts, updateShortcut, resetShortcuts }) {
  const [rebinding, setRebinding] = useState(null)
  // When a rebind clears another action's binding due to a key conflict,
  // remember which actions were cleared so we can show an inline notice.
  const [lastCleared, setLastCleared] = useState([])

  useEffect(() => {
    if (!rebinding) return

    const handleKeyCapture = (e) => {
      e.preventDefault()
      e.stopPropagation()

      let key = e.key
      if (key === 'Escape') {
        setRebinding(null)
        return
      }

      // Ignore modifier-only presses
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return

      const parts = []
      if (e.ctrlKey) parts.push('Ctrl')
      if (e.altKey) parts.push('Alt')
      if (e.shiftKey && key.length > 1) parts.push('Shift')
      parts.push(key)

      const cleared = updateShortcut(rebinding, parts.join('+')) || []
      setLastCleared(cleared)
      setRebinding(null)
    }

    document.addEventListener('keydown', handleKeyCapture, true)
    return () => document.removeEventListener('keydown', handleKeyCapture, true)
  }, [rebinding, updateShortcut])

  // Render a binding the way users expect to see it: "Ctrl+S" not "Ctrl+s",
  // "j" stays "j". Only the trailing key (after the last "+") gets uppercased
  // and only when it's a single printable char so we don't mangle "Enter",
  // "Escape", "ArrowUp" etc.
  const formatBinding = (key) => {
    if (!key) return key
    const parts = key.split('+')
    const last = parts.pop()
    if (last.length === 1) parts.push(last.toUpperCase())
    else parts.push(last)
    return parts.join('+')
  }

  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Key Bindings
        </h3>
        <p className="text-[10px] text-gray-600 mb-3">
          Click a key to rebind. Press Escape to cancel.
        </p>
        {lastCleared.length > 0 && (
          <div className="mb-3 px-2 py-1.5 rounded border border-amber-800 bg-amber-900/20 text-[10px] text-amber-300">
            Conflict — unbound: {lastCleared.map((a) => ACTION_LABELS[a] || a).join(', ')}. Rebind
            from below if needed.
          </div>
        )}
        <div className="space-y-1">
          {Object.entries(shortcuts).map(([action, key]) => {
            const isEmpty = !key
            return (
              <div key={action} className="flex items-center justify-between py-1">
                <span className="text-xs text-gray-400">{ACTION_LABELS[action] || action}</span>
                <button
                  onClick={() => {
                    setRebinding(action)
                    setLastCleared([])
                  }}
                  className={`text-[11px] font-mono px-2 py-0.5 rounded border transition-colors ${
                    rebinding === action
                      ? 'bg-indigo-900/50 border-indigo-500 text-indigo-300 animate-pulse'
                      : isEmpty
                        ? 'bg-gray-900 border-gray-800 text-gray-600 italic hover:border-gray-700'
                        : 'bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-500'
                  }`}
                >
                  {rebinding === action
                    ? 'Press a key...'
                    : isEmpty
                      ? '(unset)'
                      : formatBinding(key)}
                </button>
              </div>
            )
          })}
        </div>
      </section>

      <button
        onClick={() => {
          resetShortcuts()
          setLastCleared([])
        }}
        className="px-3 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors"
      >
        Reset to defaults
      </button>
    </div>
  )
}
