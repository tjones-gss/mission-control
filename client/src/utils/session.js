export function projectLabel(session) {
  const src = session.cwd || ''
  const parts = src.split(/[/\\]/).filter(Boolean)
  if (parts.length > 0) return parts[parts.length - 1]
  if (session.slug) return session.slug
  if (session.sessionId) return `session ${session.sessionId.slice(0, 8)}`
  return 'session'
}
