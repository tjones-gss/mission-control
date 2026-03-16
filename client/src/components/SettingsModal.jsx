import { X } from 'lucide-react'
import { SettingsTabs } from './settings/SettingsTabs.jsx'

export function SettingsModal({ onClose, soundEngine, shortcuts, updateShortcut, resetShortcuts }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg max-w-lg w-full mx-4 max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
          <h2 className="text-sm font-semibold text-gray-200">Settings</h2>
          <button
            onClick={onClose}
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
      </div>
    </div>
  )
}
