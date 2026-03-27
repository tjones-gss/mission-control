// Shared validation helpers for route handlers

// Skill names allow colons (for namespaced skills like "plugin:skill-name")
const SKILL_NAME_RE = /^[a-zA-Z0-9_:-]+$/

// Workflow names: letters, digits, underscores, hyphens
const WORKFLOW_NAME_RE = /^[a-zA-Z0-9_-]+$/

// Session IDs: alphanumeric with hyphens and underscores
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

// Team names: same rules as workflow names
const TEAM_NAME_RE = /^[a-zA-Z0-9_-]+$/

export function validateTeamName(name, res) {
  if (!name || !TEAM_NAME_RE.test(name)) {
    res.status(400).json({ error: 'Invalid team name. Only letters, digits, underscores, and hyphens are allowed.' })
    return false
  }
  return true
}

// Message IDs: UUID format or alphanumeric with hyphens
const MESSAGE_ID_RE = /^[a-zA-Z0-9_-]+$/

export function validateMessageId(id, res) {
  if (!id || !MESSAGE_ID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid message ID' })
    return false
  }
  return true
}
