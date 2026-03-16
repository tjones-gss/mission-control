import { useState, useEffect, useRef } from 'react'
import { Play, Upload, Trash2 } from 'lucide-react'
import { PRESETS } from '../../audio/presets.js'
import { getAvailableVoices } from '../../audio/tts.js'

const PRESET_NAMES = Object.keys(PRESETS)
const EVENT_LABELS = {
  needsInput:        'Needs input',
  sessionError:      'Session error',
  sessionComplete:   'Session complete',
  sessionUpdate:     'Session update',
  newSession:        'New session',
  taskUpdate:        'Task update',
  intelligenceReady: 'Intel ready',
  teamUpdate:        'Team update',
  historyUpdate:     'History update',
}

export function SoundsVoiceTab({ soundEngine }) {
  const [prefs, setPrefs] = useState(soundEngine.getPrefs)
  const [voices, setVoices] = useState([])
  const fileInputRef = useRef(null)

  useEffect(() => {
    getAvailableVoices().then(setVoices)
  }, [])

  const updateEventSound = (eventName, sound) => {
    const next = soundEngine.updatePrefs({
      events: { [eventName]: { ...prefs.events[eventName], sound } }
    })
    setPrefs(next)
  }

  const updateEventVoice = (eventName, voice) => {
    const next = soundEngine.updatePrefs({
      events: { [eventName]: { ...prefs.events[eventName], voice } }
    })
    setPrefs(next)
  }

  const updateTtsVoice = (voiceName) => {
    const next = soundEngine.updatePrefs({ ttsVoice: voiceName || null })
    setPrefs(next)
  }

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 500 * 1024) {
      alert('Sound file must be under 500KB')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result.split(',')[1]
      const name = file.name.replace(/\.[^.]+$/, '')
      const ok = soundEngine.addCustomSound(name, base64)
      if (ok) setPrefs(soundEngine.getPrefs())
      else alert('Failed to add sound (too large)')
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const customNames = Object.keys(prefs.customSounds)
  const allSoundOptions = [...PRESET_NAMES, ...customNames.map(n => `custom:${n}`)]

  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Event Sounds</h3>
        <div className="space-y-2">
          {Object.entries(prefs.events).map(([eventName, config]) => (
            <div key={eventName} className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-28 shrink-0">{EVENT_LABELS[eventName] || eventName}</span>
              <select
                value={config.sound}
                onChange={(e) => updateEventSound(eventName, e.target.value)}
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-indigo-500"
              >
                {allSoundOptions.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button
                onClick={() => soundEngine.playPreset(config.sound)}
                className="text-gray-500 hover:text-gray-300 transition-colors p-1"
                title="Preview"
              >
                <Play size={12} />
              </button>
              <label className="flex items-center gap-1 shrink-0">
                <input
                  type="checkbox"
                  checked={config.voice}
                  onChange={(e) => updateEventVoice(eventName, e.target.checked)}
                  className="rounded border-gray-700 bg-gray-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0"
                />
                <span className="text-[10px] text-gray-500">TTS</span>
              </label>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">TTS Voice</h3>
        <div className="flex items-center gap-2">
          <select
            value={prefs.ttsVoice || ''}
            onChange={(e) => updateTtsVoice(e.target.value)}
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="">System default</option>
            {voices.map(v => (
              <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
            ))}
          </select>
          <button
            onClick={() => soundEngine.speakText('Oversight is ready')}
            className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors"
          >
            Test
          </button>
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Custom Sounds</h3>
        {customNames.length > 0 && (
          <div className="space-y-1 mb-2">
            {customNames.map(name => (
              <div key={name} className="flex items-center gap-2">
                <span className="text-xs text-gray-400 flex-1">{name}</span>
                <button
                  onClick={() => soundEngine.playPreset(`custom:${name}`)}
                  className="text-gray-500 hover:text-gray-300 transition-colors p-1"
                >
                  <Play size={12} />
                </button>
                <button
                  onClick={() => {
                    soundEngine.removeCustomSound(name)
                    setPrefs(soundEngine.getPrefs())
                  }}
                  className="text-gray-500 hover:text-red-400 transition-colors p-1"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          onChange={handleUpload}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors"
        >
          <Upload size={12} />
          Upload sound (max 500KB)
        </button>
      </section>
    </div>
  )
}
