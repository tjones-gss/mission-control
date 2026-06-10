import chokidar from 'chokidar'
import path from 'path'
import os from 'os'
import { emit } from './sse.js'
import { onSessionEvent } from './intelligence/triggers.js'
import { getKnownConductorRoots } from './parsers/conductor.js'
import { getKnownHarnessRoots } from './parsers/harness.js'
import { upsertSession, removeSession } from './lib/db/session-index.js'
import { indexMemoryFile, removeMemoryFile } from './lib/db/memory-index.js'

export { addClient, removeClient, emit } from './sse.js'

const CLAUDE_DIR = path.join(os.homedir(), '.claude')
const CONDUCTOR_SEP = `${path.sep}.conductor${path.sep}`
const HARNESS_SEP = `${path.sep}.harness${path.sep}`
const ADR_RE = /^\d{4}$/

// Parse a path that lives under <projectPath>/.conductor/<adr>/... so the
// emitted SSE event carries enough info for the client to refetch the right
// run. Returns null if the path doesn't match the conductor convention.
function parseConductorPath(filePath) {
  const idx = filePath.indexOf(CONDUCTOR_SEP)
  if (idx === -1) return null
  const projectPath = filePath.slice(0, idx)
  const rest = filePath.slice(idx + CONDUCTOR_SEP.length)
  const parts = rest.split(path.sep)
  const adr = parts[0]
  if (!adr || !ADR_RE.test(adr)) return null
  return { projectPath, adr, rel: parts.slice(1).join(path.sep) }
}

// Parse a path that lives under <projectPath>/.harness/... so the emitted SSE
// event carries the project the client should refetch. Returns null if the path
// doesn't sit under a .harness directory. rel is the path INSIDE .harness/.
function parseHarnessPath(filePath) {
  const idx = filePath.indexOf(HARNESS_SEP)
  if (idx === -1) return null
  const projectPath = filePath.slice(0, idx)
  if (!projectPath) return null
  return { projectPath, rel: filePath.slice(idx + HARNESS_SEP.length) }
}

// A pending approval is a FILE inside .harness/approvals/pending/ — the harness
// writes one request file per gate and the approve CLI moves/decides it. Depth
// check (>= 3 segments) so the pending/ dir itself appearing doesn't match.
function isPendingApprovalRel(rel) {
  const parts = rel.split(/[\\/]/)
  return parts.length >= 3 && parts[0] === 'approvals' && parts[1] === 'pending'
}

// A session transcript is a DIRECT child of a project dir:
// projects/<project>/<sessionId>.jsonl. Nested .jsonl files — subagent
// transcripts at projects/<project>/<sessionId>/subagents/agent-*.jsonl —
// parse as plausible sessions, so a prefix+suffix check would index them as
// phantom top-level 'agent-...' sessions (ADR-0008). Depth check, not name
// check: rel is relative to CLAUDE_DIR, so a session is exactly 3 segments.
function isSessionTranscript(rel) {
  if (!rel.endsWith('.jsonl')) return false
  const parts = rel.split(/[\\/]/)
  return parts.length === 3 && parts[0] === 'projects'
}

// A memory doc is projects/<project>/memory/<file>.md — the exact layout
// parsers/memory.js reads (MEMORY.md included). Depth check like
// isSessionTranscript, so a stray .md elsewhere under projects/ never indexes.
function isMemoryDoc(rel) {
  if (!rel.toLowerCase().endsWith('.md')) return false
  const parts = rel.split(/[\\/]/)
  return parts.length === 4 && parts[0] === 'projects' && parts[2] === 'memory'
}

export function startWatcher() {
  const watcher = chokidar.watch(CLAUDE_DIR, {
    ignored: [
      /node_modules/,
      /\.git/,
      path.join(CLAUDE_DIR, 'debug'),
      path.join(CLAUDE_DIR, 'file-history'),
      path.join(CLAUDE_DIR, 'cache'),
      path.join(CLAUDE_DIR, 'paste-cache'),
      path.join(CLAUDE_DIR, 'downloads'),
      // The plugin system git-clones into transient plugins/cache/temp_git_*
      // dirs and deletes them mid-flight. On Windows, stat-ing a file that
      // vanishes throws EPERM, which chokidar surfaces as an 'error' event.
      // The cockpit consumes nothing from here, so don't watch it at all.
      path.join(CLAUDE_DIR, 'plugins'),
    ],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  })

  // Discover .conductor/ dirs in any project we know about (via session cwd)
  // and add them to the watch list. chokidar.add() is idempotent so we can
  // call this on startup AND on every new_session event without dedup logic.
  const watchedConductorRoots = new Set()
  function addConductorWatchers() {
    let roots = []
    try {
      roots = getKnownConductorRoots()
    } catch {
      return
    }
    for (const root of roots) {
      const conductorDir = path.join(root, '.conductor')
      if (watchedConductorRoots.has(conductorDir)) continue
      watchedConductorRoots.add(conductorDir)
      try {
        watcher.add(conductorDir)
      } catch {
        watchedConductorRoots.delete(conductorDir)
      }
    }
  }
  addConductorWatchers()

  // Discover .harness/ dirs in any known project (via session cwd) and add them
  // to the watch list. chokidar.add() is idempotent, and we track which dirs
  // we've already added so calling this on startup AND on every new_session is
  // safe and cheap.
  const watchedHarnessRoots = new Set()
  function addHarnessWatchers() {
    let roots = []
    try {
      roots = getKnownHarnessRoots()
    } catch {
      return
    }
    for (const root of roots) {
      const harnessDir = path.join(root, '.harness')
      if (watchedHarnessRoots.has(harnessDir)) continue
      watchedHarnessRoots.add(harnessDir)
      try {
        watcher.add(harnessDir)
      } catch {
        watchedHarnessRoots.delete(harnessDir)
      }
    }
  }
  addHarnessWatchers()

  // chokidar emits 'error' for transient filesystem failures (a watched file
  // deleted mid-scan, EPERM/ENOENT on Windows, etc.). Without a listener, an
  // EventEmitter 'error' is re-thrown as an uncaught exception and kills the
  // whole server. These are recoverable watch hiccups, not fatal — log and
  // carry on so one vanishing file can't take the cockpit offline.
  watcher.on('error', (err) => {
    console.error(`[watcher] ignoring filesystem watch error: ${err?.message || err}`)
  })

  function emitConductor(filePath) {
    const parsed = parseConductorPath(filePath)
    if (!parsed) return false
    emit('conductor_update', {
      projectPath: parsed.projectPath,
      adr: parsed.adr,
      filePath: parsed.rel,
      ts: Date.now(),
    })
    return true
  }

  function emitHarness(filePath, fsEvent) {
    const parsed = parseHarnessPath(filePath)
    if (!parsed) return false
    emit('harness_update', {
      projectPath: parsed.projectPath,
      ts: Date.now(),
    })
    // Phase 4 (AFK gate notifier): a file appearing/changing under
    // approvals/pending/ is an approval-gate OPENING — emit a distinct event so
    // lib/notify.js can react without false-positives from other .harness
    // writes. An unlink means the request was decided/removed, not pending.
    if (fsEvent !== 'unlink' && isPendingApprovalRel(parsed.rel)) {
      emit('harness_approval_pending', {
        projectPath: parsed.projectPath,
        filePath: parsed.rel,
        ts: Date.now(),
      })
    }
    return true
  }

  watcher.on('change', (filePath) => {
    if (emitConductor(filePath)) return
    if (emitHarness(filePath, 'change')) return

    const rel = path.relative(CLAUDE_DIR, filePath)

    if (isSessionTranscript(rel)) {
      // ADR-0008: invalidate exactly this session in the SQLite index BEFORE
      // the SSE emit, so the refetch the event triggers reads fresh rows.
      // upsertSession is a safe no-op when the db is unavailable.
      upsertSession(filePath)
      emit('session_update', { filePath: rel, ts: Date.now() })
      const sessionId = path.basename(filePath, '.jsonl')
      onSessionEvent(sessionId)
    } else if (rel.startsWith('projects') && rel.includes('memory')) {
      // Phase 6: memory docs feed the knowledge index — refresh it BEFORE the
      // emit (the client refetch must read fresh rows). Safe no-op when the
      // path isn't a real memory .md or the db is degraded.
      if (isMemoryDoc(rel)) indexMemoryFile(filePath)
      emit('memory_update', { filePath: rel, ts: Date.now() })
    } else if (rel.startsWith('tasks')) {
      emit('task_update', { filePath: rel, ts: Date.now() })
    } else if (rel.startsWith('teams')) {
      emit('team_update', { filePath: rel, ts: Date.now() })
    } else if (rel === 'history.jsonl') {
      emit('history_update', { ts: Date.now() })
    } else if (rel.startsWith('plans')) {
      emit('plan_update', { filePath: rel, ts: Date.now() })
    } else if (rel === 'settings.json' || rel.endsWith('settings.local.json')) {
      emit('config_update', { filePath: rel, ts: Date.now() })
    } else if (rel.startsWith('hooks')) {
      emit('hooks_update', { filePath: rel, ts: Date.now() })
    } else if (rel.startsWith('workflows')) {
      emit('workflows_update', { filePath: rel, ts: Date.now() })
    } else if (rel.startsWith('skills') || rel.startsWith('commands')) {
      // Slash commands and skills both feed the SkillsPanel; emit the
      // same event so the client refetch covers both directories.
      emit('skills_update', { filePath: rel, ts: Date.now() })
    }
  })

  watcher.on('add', (filePath) => {
    if (emitConductor(filePath)) return
    if (emitHarness(filePath, 'add')) return

    const rel = path.relative(CLAUDE_DIR, filePath)
    if (isSessionTranscript(rel)) {
      // ADR-0008: index the new session before announcing it (see 'change').
      upsertSession(filePath)
      emit('new_session', { filePath: rel, ts: Date.now() })
      const sessionId = path.basename(filePath, '.jsonl')
      onSessionEvent(sessionId)
      // A new session may live in a project that has a .conductor/ or .harness/
      // dir we weren't watching yet — re-derive roots and add them.
      addConductorWatchers()
      addHarnessWatchers()
    } else if (isMemoryDoc(rel)) {
      // Phase 6: a brand-new memory file (chokidar 'add', which the
      // change-handler branch never sees) — index it, then announce it.
      indexMemoryFile(filePath)
      emit('memory_update', { filePath: rel, ts: Date.now() })
    } else if (rel.startsWith('workflows')) {
      emit('workflows_update', { filePath: rel, ts: Date.now() })
    } else if (rel.startsWith('skills') || rel.startsWith('commands')) {
      emit('skills_update', { filePath: rel, ts: Date.now() })
    }
  })

  watcher.on('unlink', (filePath) => {
    if (emitConductor(filePath)) return
    if (emitHarness(filePath, 'unlink')) return

    const rel = path.relative(CLAUDE_DIR, filePath)
    if (isSessionTranscript(rel)) {
      // ADR-0008 gap fix: a deleted session JSONL was previously unhandled,
      // leaving a stale index row and a stale client list. Remove the row,
      // then reuse session_update (the client's refetch signal) with a
      // reason, matching the name_changed/name_cleared emits in routes.
      removeSession(path.basename(filePath, '.jsonl'))
      emit('session_update', { filePath: rel, ts: Date.now(), reason: 'removed' })
    } else if (isMemoryDoc(rel)) {
      // Phase 6: a deleted memory file leaves stale knowledge rows — reap
      // them and tell clients to refetch.
      removeMemoryFile(filePath)
      emit('memory_update', { filePath: rel, ts: Date.now() })
    } else if (rel.startsWith('workflows')) {
      emit('workflows_update', { filePath: rel, ts: Date.now() })
    } else if (rel.startsWith('skills') || rel.startsWith('commands')) {
      emit('skills_update', { filePath: rel, ts: Date.now() })
    }
  })

  return watcher
}
