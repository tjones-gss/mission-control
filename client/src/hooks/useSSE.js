import { useEffect, useRef, useState } from 'react'

export function useSSE(onMessage) {
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage
  const [connected, setConnected] = useState(true)

  useEffect(() => {
    let active = true
    const es = new EventSource('/api/stream')

    const events = [
      'session_update',
      'new_session',
      'task_update',
      'team_update',
      'history_update',
      'intelligence_update',
      'sdk_message',
      'sdk_result',
      'sdk_error',
      'tool_approval_request',
      'tool_approval_resolved',
      'workflows_update',
      'skills_update',
      'memory_update',
      'plan_update',
      'config_update',
      'hooks_update',
    ]
    events.forEach((evt) => {
      es.addEventListener(evt, (e) => {
        if (active) onMessageRef.current({ type: evt, data: JSON.parse(e.data) })
      })
    })

    let wasOpen = false
    es.onopen = () => {
      wasOpen = true
      if (active) setConnected(true)
    }
    es.onerror = () => {
      if (wasOpen && active) setConnected(false)
    }

    return () => {
      active = false
      es.close()
      // Do NOT call setConnected(false) here. Under React StrictMode the
      // effect runs → cleanup → effect, and flipping `connected` to false
      // in cleanup can race with the re-mounted EventSource's onopen,
      // leaving the header stuck on "disconnected" even though the new
      // connection is healthy.
    }
  }, [])

  return { connected }
}
