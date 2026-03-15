import { useRef, useEffect, useCallback } from 'react'
import { projectLabel } from '../utils/session.js'

export function getNotificationPrefs() {
  try {
    const raw = localStorage.getItem('oversight.notifications')
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { enabled: true, sound: true }
}

export function setNotificationPrefs(prefs) {
  localStorage.setItem('oversight.notifications', JSON.stringify(prefs))
}

export function useNotifications(sessions) {
  const prevIdsRef = useRef(new Set())
  const mutedIdsRef = useRef(new Set())
  const audioCtxRef = useRef(null)

  // Initialize AudioContext on first user interaction (browser autoplay policy)
  useEffect(() => {
    const initAudio = () => {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
      }
      document.removeEventListener('click', initAudio)
    }
    document.addEventListener('click', initAudio)
    return () => document.removeEventListener('click', initAudio)
  }, [])

  const playPing = useCallback(() => {
    const ctx = audioCtxRef.current
    if (!ctx) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.value = 800
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.2)
  }, [])

  const requestPermission = useCallback(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  const muteSession = useCallback((sessionId) => {
    mutedIdsRef.current.add(sessionId)
  }, [])

  useEffect(() => {
    if (!sessions?.length) return
    const prefs = getNotificationPrefs()

    const currentNeedsInput = new Set(
      sessions.filter(s => s.needsInput).map(s => s.sessionId)
    )

    // Clear muted IDs that are no longer needsInput (so they re-notify if they come back)
    for (const id of mutedIdsRef.current) {
      if (!currentNeedsInput.has(id)) {
        mutedIdsRef.current.delete(id)
      }
    }

    if (!prefs.enabled) {
      prevIdsRef.current = currentNeedsInput
      return
    }

    // Find sessions that just transitioned to needsInput (excluding muted)
    const newlyWaiting = []
    for (const id of currentNeedsInput) {
      if (!prevIdsRef.current.has(id) && !mutedIdsRef.current.has(id)) {
        const session = sessions.find(s => s.sessionId === id)
        if (session) newlyWaiting.push(session)
      }
    }

    prevIdsRef.current = currentNeedsInput

    if (newlyWaiting.length === 0) return

    // Desktop notification
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      for (const session of newlyWaiting) {
        new Notification('Agent needs input', {
          body: `${projectLabel(session)}: ${session.lastText || 'Waiting for response'}`,
          tag: session.sessionId,
        })
      }
    } else if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission()
    }

    // Audio ping
    if (prefs.sound) {
      playPing()
    }
  }, [sessions, playPing])

  return { requestPermission, muteSession, mutedIds: mutedIdsRef }
}
