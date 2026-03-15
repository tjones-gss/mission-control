import { useState } from 'react'
import { X } from 'lucide-react'
import { getNotificationPrefs, setNotificationPrefs } from '../hooks/useNotifications.js'

function Toggle({ label, description, checked, onChange }) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer">
      <div>
        <div className="text-xs text-gray-300 font-medium">{label}</div>
        {description && <div className="text-xs text-gray-600 mt-0.5">{description}</div>}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-indigo-600' : 'bg-gray-700'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform mt-0.5 ${
            checked ? 'translate-x-4 ml-0.5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  )
}

export function SettingsModal({ onClose }) {
  const [prefs, setPrefs] = useState(getNotificationPrefs)

  const update = (key, value) => {
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    setNotificationPrefs(next)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg max-w-sm w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h2 className="text-sm font-semibold text-gray-200">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Notifications</h3>
            <div className="space-y-3">
              <Toggle
                label="Desktop notifications"
                description="Show browser notifications when an agent needs input"
                checked={prefs.enabled}
                onChange={(v) => update('enabled', v)}
              />
              <Toggle
                label="Sound"
                description="Play an audio ping with notifications"
                checked={prefs.sound}
                onChange={(v) => update('sound', v)}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
