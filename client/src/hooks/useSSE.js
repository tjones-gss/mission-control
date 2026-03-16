import { useEffect, useRef, useState } from 'react'

export function useSSE(onMessage) {
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage
  const [connected, setConnected] = useState(true)

  useEffect(() => {
    const es = new EventSource('/api/stream')

    const events = ['session_update', 'new_session', 'task_update', 'team_update', 'history_update', 'intelligence_update']
    events.forEach(evt => {
      es.addEventListener(evt, e => {
        onMessageRef.current({ type: evt, data: JSON.parse(e.data) })
      })
    })

    let wasOpen = false
    es.onopen = () => { wasOpen = true; setConnected(true) }
    es.onerror = () => { if (wasOpen) setConnected(false) }

    return () => {
      es.close()
      setConnected(false)
    }
  }, [])

  return { connected }
}
