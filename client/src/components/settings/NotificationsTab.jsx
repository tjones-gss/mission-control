import { useState } from 'react'
import { getNotificationPrefs, setNotificationPrefs } from '../../hooks/useNotifications.js'

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

export function NotificationsTab({ soundEngine }) {
  const [prefs, setPrefs] = useState(getNotificationPrefs)
  const soundPrefs = soundEngine.getPrefs()
  const [volume, setVolume] = useState(soundPrefs.masterVolume)

  const updateNotifPref = (key, value) => {
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    setNotificationPrefs(next)
  }

  const handleVolumeChange = (e) => {
    const v = parseFloat(e.target.value)
    setVolume(v)
    soundEngine.updatePrefs({ masterVolume: v })
  }

  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Desktop Notifications</h3>
        <div className="space-y-3">
          <Toggle
            label="Desktop notifications"
            description="Show browser notifications when an agent needs input"
            checked={prefs.enabled}
            onChange={(v) => updateNotifPref('enabled', v)}
          />
          <Toggle
            label="Sound"
            description="Global mute — disables all notification sounds"
            checked={prefs.sound}
            onChange={(v) => updateNotifPref('sound', v)}
          />
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Volume</h3>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={handleVolumeChange}
            className="flex-1 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
          />
          <span className="text-xs text-gray-400 w-8 text-right">{Math.round(volume * 100)}%</span>
        </div>
        <button
          onClick={() => soundEngine.playPreset('chime')}
          className="mt-2 px-3 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors"
        >
          Test sound
        </button>
      </section>
    </div>
  )
}
