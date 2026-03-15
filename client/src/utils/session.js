export function projectLabel(session) {
  const src = session.cwd || session.projectName || ''
  const parts = src.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] || session.slug || session.sessionId.slice(0, 8)
}
