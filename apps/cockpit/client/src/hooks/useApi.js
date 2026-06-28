import { useState, useEffect, useCallback, useRef } from 'react'
import { authHeaders } from '../lib/authToken.js'

export function useApi(url, deps = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(url !== null)
  const [error, setError] = useState(null)
  const controllerRef = useRef(null)

  const refetch = useCallback(
    async (signal) => {
      if (!url) return
      setLoading(true)
      let aborted = false
      try {
        const res = await fetch(url, { signal, headers: authHeaders() })
        if (!res.ok) {
          let msg = `HTTP ${res.status}`
          try {
            const body = await res.json()
            msg = body.detail ?? body.error ?? msg
          } catch {}
          throw new Error(msg)
        }
        setData(await res.json())
        setError(null)
      } catch (e) {
        if (e.name === 'AbortError') {
          aborted = true
          return
        }
        setError(e.message)
      } finally {
        // Don't flip loading=false on an aborted fetch — under React
        // StrictMode the effect mounts → cleanup aborts → mounts again,
        // and the aborted first fetch was racing to set loading=false
        // BEFORE the second fetch landed, leaving consumers briefly in
        // {data: null, loading: false} → "No data" empty state. Caught
        // by an e2e test that queried during that microtask gap.
        if (!aborted) setLoading(false)
      }
    },
    [url],
  )

  useEffect(() => {
    if (!url) {
      setData(null)
      setLoading(false)
      return
    }
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    refetch(controller.signal)
    return () => controller.abort()
  }, [refetch, url, ...deps])

  return { data, loading, error, refetch: () => refetch() }
}
