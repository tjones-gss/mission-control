import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { SettingsTabs } from './settings/SettingsTabs.jsx'

export function SettingsModal({ onClose, soundEngine, shortcuts, updateShortcut, resetShortcuts }) {
  const dialogRef = useRef(null)
  const closeButtonRef = useRef(null)

  useEffect(() => {
    // Focus the close button on mount
    closeButtonRef.current?.focus()

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }

      if (e.key !== 'Tab') return

      const dialog = dialogRef.current
      if (!dialog) return

      const focusable = dialog.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="bg-gray-900 border border-gray-700 rounded-lg max-w-lg w-full mx-4 max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
          <h2 id="settings-title" className="text-sm font-semibold text-gray-200">Settings</h2>
          <button
            ref={closeButtonRef}
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
      </div>
    </div>
  )
}
