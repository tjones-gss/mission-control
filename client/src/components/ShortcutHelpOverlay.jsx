import { Keyboard, X } from 'lucide-react'

export function ShortcutHelpOverlay({ shortcuts, open, onToggle }) {
  const ACTION_LABELS = {
    nextSession:    'Next session',
    prevSession:    'Previous session',
    openDetail:     'Open detail view',
    backToBoard:    'Back to board',
    tabAgents:      'Agents tab',
    tabTasks:       'Tasks tab',
    tabWorkflows:   'Workflows tab',
    tabSkills:      'Skills tab',
    quickApprove:   'Approve (send "yes")',
    quickContinue:  'Continue session',
    focusInput:     'Focus message input',
    showHelp:       'Show shortcut help',
    toggleSettings: 'Open settings',
    toggleMute:     'Mute session',
  }

  if (!open) {
    return (
      <button
        onClick={onToggle}
        className="fixed bottom-4 right-4 z-40 w-8 h-8 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors shadow-lg"
        title="Keyboard shortcuts (?)"
      >
        <Keyboard size={14} />
      </button>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-72 bg-gray-900 border border-gray-700 rounded-lg shadow-xl">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <span className="text-xs font-semibold text-gray-300">Keyboard Shortcuts</span>
        <button
          onClick={onToggle}
          className="text-gray-500 hover:text-gray-300 transition-colors"
        >
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
      </div>
    </div>
  )
}
