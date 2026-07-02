import { Keyboard, X } from 'lucide-react'
import { ACTION_LABELS } from '../hooks/useKeyboardShortcuts.js'

export function ShortcutHelpOverlay({ shortcuts, open, onToggle }) {
  if (!open) {
    return (
      <button
        onClick={onToggle}
        className="fixed bottom-4 right-4 z-dropdown w-8 h-8 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors shadow-lg"
        title="Keyboard shortcuts (?)"
      >
        <Keyboard size={14} />
      </button>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 z-dropdown w-72 bg-gray-900 border border-gray-700 rounded-lg shadow-xl">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <span className="text-xs font-semibold text-gray-300">Keyboard Shortcuts</span>
        <button onClick={onToggle} className="text-gray-500 hover:text-gray-300 transition-colors">
          <X size={14} />
        </button>
      </div>
      <div className="px-3 py-2 max-h-80 overflow-y-auto">
        <div className="space-y-1">
          {Object.entries(shortcuts).map(([action, key]) => (
            <div key={action} className="flex items-center justify-between py-0.5">
              <span className="text-xs text-gray-500">{ACTION_LABELS[action] || action}</span>
              <kbd className="text-[10px] bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-gray-300 font-mono">
                {key}
              </kbd>
            </div>
          ))}
        </div>
        {/* Context keys that only bind while their surface has focus — kept
         * static here because they live in the surface, not the global map. */}
        <div className="mt-2 pt-2 border-t border-gray-700 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-gray-600">
            Triage queue (focused card)
          </div>
          {[
            ['Move between cards', '↑ / ↓'],
            ['Open session', 'Enter'],
            ['Select for broadcast', 'Space'],
            ['Approve (send "yes")', 'y'],
            ['Send "continue"', 'c'],
          ].map(([label, key]) => (
            <div key={label} className="flex items-center justify-between py-0.5">
              <span className="text-xs text-gray-500">{label}</span>
              <kbd className="text-[10px] bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-gray-300 font-mono">
                {key}
              </kbd>
            </div>
          ))}
          <div className="text-[10px] uppercase tracking-wider text-gray-600 pt-1">
            Command palette
          </div>
          <div className="flex items-center justify-between py-0.5">
            <span className="text-xs text-gray-500">Action mode (approve / steer…)</span>
            <kbd className="text-[10px] bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-gray-300 font-mono">
              &gt;
            </kbd>
          </div>
        </div>
      </div>
    </div>
  )
}
