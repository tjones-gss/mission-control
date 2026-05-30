import chokidar from 'chokidar'
import path from 'path'
import os from 'os'
import { emit } from './sse.js'
import { onSessionEvent } from './intelligence/triggers.js'
import { getKnownConductorRoots } from './parsers/conductor.js'
import { getKnownHarnessRoots } from './parsers/harness.js'

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
// doesn't sit under a .harness directory.
function parseHarnessPath(filePath) {
  const idx = filePath.indexOf(HARNESS_SEP)
  if (idx === -1) return null
  const projectPath = filePath.slice(0, idx)
  if (!projectPath) return null
  return { projectPath }
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

  function emitHarness(filePath) {
    const parsed = parseHarnessPath(filePath)
    if (!parsed) return false
    emit('harness_update', {
      projectPath: parsed.projectPath,
      ts: Date.now(),
    })
    return true
  }

  watcher.on('change', (filePath) => {
    if (emitConductor(filePath)) return
    if (emitHarness(filePath)) return

    const rel = path.relative(CLAUDE_DIR, filePath)

    if (rel.startsWith('projects') && filePath.endsWith('.jsonl')) {
      emit('session_update', { filePath: rel, ts: Date.now() })
      const sessionId = path.basename(filePath, '.jsonl')
      onSessionEvent(sessionId)
    } else if (rel.startsWith('projects') && rel.includes('memory')) {
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
    if (emitHarness(filePath)) return

    const rel = path.relative(CLAUDE_DIR, filePath)
    if (rel.startsWith('projects') && filePath.endsWith('.jsonl')) {
      emit('new_session', { filePath: rel, ts: Date.now() })
      const sessionId = path.basename(filePath, '.jsonl')
      onSessionEvent(sessionId)
      // A new session may live in a project that has a .conductor/ or .harness/
      // dir we weren't watching yet — re-derive roots and add them.
      addConductorWatchers()
      addHarnessWatchers()
    } else if (rel.startsWith('workflows')) {
      emit('workflows_update', { filePath: rel, ts: Date.now() })
    } else if (rel.startsWith('skills') || rel.startsWith('commands')) {
      emit('skills_update', { filePath: rel, ts: Date.now() })
    }
  })

  watcher.on('unlink', (filePath) => {
    if (emitConductor(filePath)) return
    if (emitHarness(filePath)) return

    const rel = path.relative(CLAUDE_DIR, filePath)
    if (rel.startsWith('workflows')) {
      emit('workflows_update', { filePath: rel, ts: Date.now() })
    } else if (rel.startsWith('skills') || rel.startsWith('commands')) {
      emit('skills_update', { filePath: rel, ts: Date.now() })
    }
  })

  return watcher
}
