// Shared validation helpers for route handlers

// Skill names: letters, digits, underscores, hyphens. Colons used to be
// allowed for namespaced skills like "plugin:skill-name" but that's
// only ever produced by the plugin loader (read-only path); user-authored
// skills are filename-based and ':' is reserved on Windows. Removing it
// from the writable path closes a class of 500s where the regex passed
// but fs.open failed with EINVAL/ENOENT.
const SKILL_NAME_RE = /^[a-zA-Z0-9_-]+$/

// Workflow names: letters, digits, underscores, hyphens
const WORKFLOW_NAME_RE = /^[a-zA-Z0-9_-]+$/

// Session IDs: alphanumeric with hyphens and underscores
const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/

// Reasonable cap for human-authored names. Longer than 100 chars is
// almost certainly a bug, and Windows path limits make 500+ char file
// names blow up at the fs layer with ENOENT instead of a clean 400.
const MAX_NAME_LENGTH = 100

// Reject names that are pure punctuation, lead with a dash (would look
// like a CLI flag), or are reserved Windows file basenames.
const WINDOWS_RESERVED = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
])

function isAcceptableName(name) {
  if (!name || typeof name !== 'string') return false
  if (name.length > MAX_NAME_LENGTH) return false
  if (name.startsWith('-')) return false
  if (!/[a-zA-Z0-9]/.test(name)) return false // not pure punctuation
  if (WINDOWS_RESERVED.has(name.toUpperCase())) return false
  return true
}

export function validateSkillName(name, res) {
  if (!SKILL_NAME_RE.test(name) || !isAcceptableName(name)) {
    res.status(400).json({
      error:
        'Invalid skill name. Use letters, digits, underscores, and hyphens. ' +
        'Must contain at least one alphanumeric character, must not start with a hyphen, ' +
        `and must be 1-${MAX_NAME_LENGTH} characters.`,
    })
    return false
  }
  return true
}

export function validateWorkflowName(name, res) {
  if (!WORKFLOW_NAME_RE.test(name) || !isAcceptableName(name)) {
    res.status(400).json({
      error:
        'Invalid workflow name. Use letters, digits, underscores, and hyphens. ' +
        'Must contain at least one alphanumeric character, must not start with a hyphen, ' +
        `and must be 1-${MAX_NAME_LENGTH} characters.`,
    })
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
    res
      .status(400)
      .json({
        error: 'Invalid team name. Only letters, digits, underscores, and hyphens are allowed.',
      })
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

// Sender names: letters, digits, underscores, hyphens, spaces
const SENDER_RE = /^[a-zA-Z0-9_ -]+$/

export function sanitizeSender(raw) {
  if (!raw || typeof raw !== 'string') return 'user'
  const trimmed = raw.trim().slice(0, 50)
  if (!SENDER_RE.test(trimmed)) return 'user'
  return trimmed
}
