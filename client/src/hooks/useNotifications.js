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

export function useNotifications(sessions, soundEngine) {
  const prevIdsRef = useRef(new Set())
  const mutedIdsRef = useRef(new Set())

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

    // Sound via soundEngine (respects global mute from oversight.notifications.sound)
    if (prefs.sound && soundEngine) {
      for (const session of newlyWaiting) {
        soundEngine.play('needsInput', { projectLabel: projectLabel(session), ...session })
      }
    }
  }, [sessions, soundEngine])

  return { requestPermission, muteSession, mutedIds: mutedIdsRef }
}
