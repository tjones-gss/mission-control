// Shared validation helpers for route handlers

// Skill names allow colons (for namespaced skills like "plugin:skill-name")
const SKILL_NAME_RE = /^[a-zA-Z0-9_:-]+$/

// Workflow names: letters, digits, underscores, hyphens
const WORKFLOW_NAME_RE = /^[a-zA-Z0-9_-]+$/

// Session IDs: UUID format or alphanumeric with hyphens/underscores
const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/

export function validateSkillName(name, res) {
  if (!SKILL_NAME_RE.test(name)) {
    res.status(400).json({ error: 'Invalid skill name. Only letters, digits, underscores, colons, and hyphens are allowed.' })
    return false
  }
  return true
}

export function validateWorkflowName(name, res) {
  if (!WORKFLOW_NAME_RE.test(name)) {
    res.status(400).json({ error: 'Invalid workflow name. Only letters, digits, underscores, and hyphens are allowed.' })
    return false
  }
  return true
}

export function validateSessionId(sessionId, res) {
  if (!sessionId || !SESSION_ID_RE.test(sessionId)) {
    res.status(400).json({ error: 'Invalid session ID' })
    return false
  }
  return true
}
