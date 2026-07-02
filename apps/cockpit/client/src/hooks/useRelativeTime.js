import { useEffect, useMemo, useState } from 'react'

function toMs(value) {
  if (!value) return null
  if (typeof value === 'number') return value
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

export function formatRelativeTime(value, prefix = '') {
  const ms = toMs(value)
  if (!ms) return ''
  const delta = Math.max(0, Date.now() - ms)
  const mins = Math.floor(delta / 60_000)
  let label
  if (mins < 1) label = 'now'
  else if (mins < 60) label = `${mins}m`
  else {
    const hours = Math.floor(mins / 60)
    const rem = mins % 60
    label = rem ? `${hours}h ${rem}m` : `${hours}h`
  }
  return prefix ? `${prefix} ${label}` : label
}

export function useRelativeTime(value, { intervalMs = 30_000, prefix = '' } = {}) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => setTick((v) => v + 1), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])

  return useMemo(() => formatRelativeTime(value, prefix), [value, prefix, tick])
}
