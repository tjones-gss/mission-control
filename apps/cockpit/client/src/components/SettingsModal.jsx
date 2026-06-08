import { X } from 'lucide-react'
import { Dialog } from './ui/Dialog.jsx'
import { SettingsTabs } from './settings/SettingsTabs.jsx'

export function SettingsModal({ onClose, soundEngine, shortcuts, updateShortcut, resetShortcuts }) {
  return (
    <Dialog
      onClose={onClose}
      labelledBy="settings-title"
      className="bg-gray-900 border border-gray-700 rounded-lg max-w-lg w-[calc(100%-2rem)] max-h-[85vh] overflow-hidden flex flex-col"
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
        <h2 id="settings-title" className="text-sm font-semibold text-gray-200">
          Settings
        </h2>
        <button
          onClick={onClose}
          aria-label="Close settings"
          className="text-gray-500 hover:text-gray-300 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <div className="overflow-y-auto">
        <SettingsTabs
          soundEngine={soundEngine}
          shortcuts={shortcuts}
          updateShortcut={updateShortcut}
          resetShortcuts={resetShortcuts}
        />
      </div>
    </Dialog>
  )
}
