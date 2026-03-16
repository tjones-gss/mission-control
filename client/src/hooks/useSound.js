import { useRef, useCallback, useEffect, useMemo } from 'react'
import { PRESETS } from '../audio/presets.js'
import { speak, cancelSpeech, TTS_TEMPLATES } from '../audio/tts.js'

const STORAGE_KEY = 'oversight.sound'

const DEFAULT_PREFS = {
  masterVolume: 0.7,
  events: {
    needsInput:        { sound: 'chime',   voice: true },
    sessionError:      { sound: 'fail',    voice: true },
    sessionComplete:   { sound: 'success', voice: true },
    sessionUpdate:     { sound: 'gentle',  voice: false },
    newSession:        { sound: 'ping',    voice: false },
    taskUpdate:        { sound: 'gentle',  voice: false },
    intelligenceReady: { sound: 'ping',    voice: false },
    teamUpdate:        { sound: 'none',    voice: false },
    historyUpdate:     { sound: 'none',    voice: false },
  },
  ttsVoice: null,
  customSounds: {},
}

export function getSoundPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return { ...DEFAULT_PREFS, ...parsed, events: { ...DEFAULT_PREFS.events, ...parsed.events } }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_PREFS }
}

export function setSoundPrefs(prefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
}

export function useSound() {
  const audioCtxRef = useRef(null)
  const masterGainRef = useRef(null)
  const prefsRef = useRef(getSoundPrefs())
  const decodedCacheRef = useRef(new Map())

  // Lazy AudioContext init on first user click
  useEffect(() => {
    const initAudio = () => {
      if (!audioCtxRef.current) {
        const ctx = new (window.AudioContext || window.webkitAudioContext)()
        audioCtxRef.current = ctx
        const gain = ctx.createGain()
        gain.gain.value = prefsRef.current.masterVolume
        gain.connect(ctx.destination)
        masterGainRef.current = gain
      }
      document.removeEventListener('click', initAudio)
    }
    document.addEventListener('click', initAudio)
    return () => document.removeEventListener('click', initAudio)
  }, [])

  const ensureContext = useCallback(() => {
    const ctx = audioCtxRef.current
    if (!ctx) return null
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
  }, [])

  const playCustomSound = useCallback(async (name) => {
    const ctx = ensureContext()
    if (!ctx) return
    const prefs = prefsRef.current
    const base64 = prefs.customSounds[name]
    if (!base64) return

    let buffer = decodedCacheRef.current.get(name)
    if (!buffer) {
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      buffer = await ctx.decodeAudioData(bytes.buffer.slice(0))
      decodedCacheRef.current.set(name, buffer)
    }

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(masterGainRef.current)
    source.start()
  }, [ensureContext])

  const playPreset = useCallback((presetName) => {
    if (presetName?.startsWith('custom:')) {
      playCustomSound(presetName.slice(7))
      return
    }
    const ctx = ensureContext()
    if (!ctx || !PRESETS[presetName]) return
    masterGainRef.current.gain.value = prefsRef.current.masterVolume
    PRESETS[presetName](ctx, masterGainRef.current)
  }, [ensureContext, playCustomSound])

  const play = useCallback((eventName, sessionContext) => {
    const prefs = prefsRef.current
    const eventConfig = prefs.events[eventName]
    if (!eventConfig) return

    const soundName = eventConfig.sound
    if (soundName === 'none') {
      // still do TTS if enabled
    } else if (soundName?.startsWith('custom:')) {
      playCustomSound(soundName.slice(7))
    } else if (PRESETS[soundName]) {
      playPreset(soundName)
    }

    // TTS
    if (eventConfig.voice && sessionContext) {
      const template = TTS_TEMPLATES[eventName]
      if (template) {
        const text = template(sessionContext)
        if (text) speak(text, prefs.ttsVoice, prefs.masterVolume)
      }
    }
  }, [playPreset, playCustomSound])

  const speakText = useCallback((text) => {
    const prefs = prefsRef.current
    speak(text, prefs.ttsVoice, prefs.masterVolume)
  }, [])

  const getPrefs = useCallback(() => prefsRef.current, [])

  const updatePrefs = useCallback((partial) => {
    const current = prefsRef.current
    const next = {
      ...current,
      ...partial,
      events: { ...current.events, ...(partial.events || {}) },
      customSounds: { ...current.customSounds, ...(partial.customSounds || {}) },
    }
    prefsRef.current = next
    setSoundPrefs(next)
    if (masterGainRef.current && next.masterVolume !== undefined) {
      masterGainRef.current.gain.value = next.masterVolume
    }
    return next
  }, [])

  const addCustomSound = useCallback((name, base64) => {
    // 500KB cap
    if (base64.length > 500 * 1024 * 1.37) return false // base64 overhead
    const prefs = prefsRef.current
    const next = { ...prefs, customSounds: { ...prefs.customSounds, [name]: base64 } }
    prefsRef.current = next
    setSoundPrefs(next)
    decodedCacheRef.current.delete(name)
    return true
  }, [])

  const removeCustomSound = useCallback((name) => {
    const prefs = prefsRef.current
    const { [name]: _, ...rest } = prefs.customSounds
    const next = { ...prefs, customSounds: rest }
    prefsRef.current = next
    setSoundPrefs(next)
    decodedCacheRef.current.delete(name)
  }, [])

  return useMemo(
    () => ({ play, playPreset, speakText, getPrefs, updatePrefs, addCustomSound, removeCustomSound }),
    [play, playPreset, speakText, getPrefs, updatePrefs, addCustomSound, removeCustomSound]
  )
}
