import fs from 'fs'
import path from 'path'
import os from 'os'

const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude', 'projects')
const CWD_SCAN_BYTES = 8192

const PHASES = new Set([
  'bootstrap',
  'plan',
  'build',
  'integration',
  'ship',
  'retrospective',
  'completed',
  'aborted',
  'escalated',
])

const ADR_RE = /^\d{4}$/

// Extract `cwd` from a session JSONL by scanning the first ~8KB. The first
// line is often a `last-prompt` or `ai-title` metadata stub without `cwd`;
// `cwd` lives on the conversation records that follow. Reading the full file
// the way parsers/sessions.js does is too expensive for hundreds of sessions,
// so we slurp a fixed prefix and parse line-by-line until we hit a record
// with `cwd`. If 8KB doesn't cover it, the session is pathological and we
// drop it — that's strictly better than reading every record.
function readSessionCwd(filePath) {
  let fd
  try {
    fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(CWD_SCAN_BYTES)
    const bytes = fs.readSync(fd, buf, 0, CWD_SCAN_BYTES, 0)
    const text = buf.toString('utf-8', 0, bytes)
    // Drop the trailing partial line — it could be a half-written record
    // we're racing the writer for. The leading complete lines are safe.
    const lines = text.split('\n').slice(0, -1)
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const rec = JSON.parse(line)
        if (rec && typeof rec.cwd === 'string') return rec.cwd
      } catch {
        // Skip malformed records; the prefix may still contain a valid one.
      }
    }
    return null
  } catch {
    return null
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        /* ignore */
      }
    }
  }
}

export function getSessionCwds() {
  if (!fs.existsSync(CLAUDE_PROJECTS)) return []
  const cwds = new Set()
  let projectDirs = []
  try {
    projectDirs = fs
      .readdirSync(CLAUDE_PROJECTS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
  } catch {
    return []
  }
  for (const pd of projectDirs) {
    const dir = path.join(CLAUDE_PROJECTS, pd.name)
    let files = []
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const f of files) {
      const cwd = readSessionCwd(path.join(dir, f))
      if (cwd) cwds.add(cwd)
    }
  }
  return [...cwds]
}

function existsAsFile(p) {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

function existsAsDir(p) {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

export function getKnownConductorRoots() {
  return getSessionCwds().filter((cwd) => existsAsDir(path.join(cwd, '.conductor')))
}

function buildAdrPaths(projectPath, adr) {
  const adrDir = path.join(projectPath, '.conductor', adr)
  return {
    adrDir,
    status: path.join(adrDir, 'status.json'),
    plan: path.join(adrDir, 'plan.json'),
    events: path.join(adrDir, 'events.jsonl'),
    journalDraft: path.join(adrDir, 'journal-draft.md'),
    ratificationProposal: path.join(adrDir, 'ratification-proposal.md'),
    skillDiffProposal: path.join(adrDir, 'skill-diff-proposal.md'),
    attemptsDir: path.join(adrDir, 'attempts'),
    dispatchesDir: path.join(adrDir, 'dispatches'),
  }
}

function buildRun(projectPath, adr) {
  const paths = buildAdrPaths(projectPath, adr)

  let status
  try {
    status = JSON.parse(fs.readFileSync(paths.status, 'utf-8'))
  } catch {
    return null
  }
  if (!status || typeof status !== 'object') return null

  const phase = PHASES.has(status.phase) ? status.phase : 'bootstrap'
  const escalationReason =
    typeof status.escalation_reason === 'string' && status.escalation_reason.trim()
      ? status.escalation_reason
      : null

  // task_iters is the canonical map; older fixtures used scalar iter_count for
  // the current task only. Fall back to that shape so historical runs render.
  let taskIters = {}
  if (status.task_iters && typeof status.task_iters === 'object') {
    taskIters = status.task_iters
  } else if (typeof status.iter_count === 'number' && status.current_task_id) {
    taskIters = { [status.current_task_id]: status.iter_count }
  }

  const splits = status.splits && typeof status.splits === 'object' ? status.splits : {}

  return {
    projectPath,
    projectLabel: path.basename(projectPath),
    adr,
    phase,
    startedAt: typeof status.started_at === 'string' ? status.started_at : null,
    currentTaskId: typeof status.current_task_id === 'string' ? status.current_task_id : null,
    taskIters,
    splits,
    acceptanceCommandsRequired: Array.isArray(status.acceptance_commands_required)
      ? status.acceptance_commands_required
      : [],
    acceptanceCommandsRun: Array.isArray(status.acceptance_commands_run)
      ? status.acceptance_commands_run
      : [],
    escalationReason,
    isPaused: phase === 'escalated' || phase === 'aborted' || !!escalationReason,
    hasJournalDraft: existsAsFile(paths.journalDraft),
    hasRatificationProposal: existsAsFile(paths.ratificationProposal),
    hasSkillDiffProposal: existsAsFile(paths.skillDiffProposal),
    paths: {
      status: paths.status,
      plan: paths.plan,
      events: paths.events,
      journalDraft: paths.journalDraft,
      ratificationProposal: paths.ratificationProposal,
      skillDiffProposal: paths.skillDiffProposal,
    },
  }
}

export function getConductorRuns() {
  const runs = []
  for (const root of getKnownConductorRoots()) {
    const conductorDir = path.join(root, '.conductor')
    let entries = []
    try {
      entries = fs
        .readdirSync(conductorDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && ADR_RE.test(d.name))
    } catch {
      continue
    }
    for (const e of entries) {
      const run = buildRun(root, e.name)
      if (run) runs.push(run)
    }
  }
  // Most-recently-started first, with paused runs surfaced. We sort by
  // startedAt descending; ties (or missing timestamps) fall back to projectPath.
  return runs.sort((a, b) => {
    const ta = a.startedAt || ''
    const tb = b.startedAt || ''
    if (ta !== tb) return tb.localeCompare(ta)
    return a.projectPath.localeCompare(b.projectPath)
  })
}

export function getConductorRunById(projectPath, adr) {
  if (typeof projectPath !== 'string' || !projectPath) return null
  if (!ADR_RE.test(adr)) return null
  // Whitelist check: never read from a path that's not a known session cwd
  // with an existing .conductor/ dir. This prevents a malicious projectKey
  // from being decoded into an arbitrary FS read.
  const knownRoots = new Set(getKnownConductorRoots())
  if (!knownRoots.has(projectPath)) return null
  return buildRun(projectPath, adr)
}

// Read a run-scoped file, but only after the same whitelist check above so
// the caller can't escape the run directory.
export function readRunFile(projectPath, adr, kind) {
  const run = getConductorRunById(projectPath, adr)
  if (!run) return null
  const target = run.paths[kind]
  if (!target) return null
  try {
    return fs.readFileSync(target, 'utf-8')
  } catch {
    return null
  }
}
