import { useEffect, useRef } from 'react'

export function useSSE(onMessage) {
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  useEffect(() => {
    const es = new EventSource('/api/stream')

    const events = ['session_update', 'new_session', 'task_update', 'team_update', 'history_update']
    events.forEach(evt => {
      es.addEventListener(evt, e => {
        onMessageRef.current({ type: evt, data: JSON.parse(e.data) })
      })
    })

    es.onerror = () => {
      // auto-reconnects by default
    }

    return () => es.close()
  }, [])
}
