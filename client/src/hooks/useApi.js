import { useState, useEffect, useCallback } from 'react'

export function useApi(url, deps = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(url !== null)
  const [error, setError] = useState(null)

  const refetch = useCallback(async () => {
    if (!url) return
    setLoading(true)
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [url])

  useEffect(() => {
    if (!url) {
      setData(null)
      setLoading(false)
      return
    }
    refetch()
  }, [refetch, url, ...deps])

  return { data, loading, error, refetch }
}
