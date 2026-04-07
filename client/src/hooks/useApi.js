import { useState, useEffect, useCallback, useRef } from 'react'

export function useApi(url, deps = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(url !== null)
  const [error, setError] = useState(null)
  const controllerRef = useRef(null)

  const refetch = useCallback(
    async (signal) => {
      if (!url) return
      setLoading(true)
      try {
        const res = await fetch(url, { signal })
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
        if (e.name === 'AbortError') return
        setError(e.message)
      } finally {
        setLoading(false)
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
