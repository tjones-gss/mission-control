import { useEffect, useRef, useState } from 'react'

export function useSSE(onMessage) {
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage
  const [connected, setConnected] = useState(true)

  useEffect(() => {
    let active = true
    let retryCount = 0
    let reconnectTimer = null
    let es = null

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
      'conductor_update',
      'harness_update',
      'fleet_update',
      'parser_degraded',
      'tool_call',
    ]

    function connect() {
      es = new EventSource('/api/stream')
      let wasOpen = false

      events.forEach((evt) => {
        es.addEventListener(evt, (e) => {
          if (active) onMessageRef.current({ type: evt, data: JSON.parse(e.data) })
        })
      })

      es.onopen = () => {
        wasOpen = true
        retryCount = 0
        if (active) setConnected(true)
      }

      es.onerror = () => {
        if (!active) return
        if (wasOpen) setConnected(false)
        es.close()
        const delay = Math.min(1000 * 2 ** retryCount, 30000)
        retryCount += 1
        reconnectTimer = setTimeout(() => {
          if (active) connect()
        }, delay)
      }
    }

    connect()

    return () => {
      active = false
      clearTimeout(reconnectTimer)
      if (es) es.close()
      // Do NOT call setConnected(false) here. Under React StrictMode the
      // effect runs → cleanup → effect, and flipping `connected` to false
      // in cleanup can race with the re-mounted EventSource's onopen,
      // leaving the header stuck on "disconnected" even though the new
      // connection is healthy.
    }
  }, [])

  return { connected }
}
