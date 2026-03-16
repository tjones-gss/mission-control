import { useState, useEffect, useCallback } from 'react'
import { ACTION_LABELS } from '../../hooks/useKeyboardShortcuts.js'

export function ShortcutsTab({ shortcuts, updateShortcut, resetShortcuts }) {
  const [rebinding, setRebinding] = useState(null)

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

      updateShortcut(rebinding, parts.join('+'))
      setRebinding(null)
    }

    document.addEventListener('keydown', handleKeyCapture, true)
    return () => document.removeEventListener('keydown', handleKeyCapture, true)
  }, [rebinding, updateShortcut])

  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Key Bindings</h3>
        <p className="text-[10px] text-gray-600 mb-3">Click a key to rebind. Press Escape to cancel.</p>
        <div className="space-y-1">
          {Object.entries(shortcuts).map(([action, key]) => (
            <div key={action} className="flex items-center justify-between py-1">
              <span className="text-xs text-gray-400">{ACTION_LABELS[action] || action}</span>
              <button
                onClick={() => setRebinding(action)}
                className={`text-[11px] font-mono px-2 py-0.5 rounded border transition-colors ${
                  rebinding === action
                    ? 'bg-indigo-900/50 border-indigo-500 text-indigo-300 animate-pulse'
                    : 'bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-500'
                }`}
              >
                {rebinding === action ? 'Press a key...' : key}
              </button>
            </div>
          ))}
        </div>
      </section>

      <button
        onClick={resetShortcuts}
        className="px-3 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors"
      >
        Reset to defaults
      </button>
    </div>
  )
}
