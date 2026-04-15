import chokidar from 'chokidar'
import path from 'path'
import os from 'os'
import { emit } from './sse.js'
import { onSessionEvent } from './intelligence/triggers.js'

export { addClient, removeClient, emit } from './sse.js'

const CLAUDE_DIR = path.join(os.homedir(), '.claude')

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

  watcher.on('change', (filePath) => {
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
    const rel = path.relative(CLAUDE_DIR, filePath)
    if (rel.startsWith('projects') && filePath.endsWith('.jsonl')) {
      emit('new_session', { filePath: rel, ts: Date.now() })
      const sessionId = path.basename(filePath, '.jsonl')
      onSessionEvent(sessionId)
    } else if (rel.startsWith('workflows')) {
      emit('workflows_update', { filePath: rel, ts: Date.now() })
    } else if (rel.startsWith('skills') || rel.startsWith('commands')) {
      emit('skills_update', { filePath: rel, ts: Date.now() })
    }
  })

  watcher.on('unlink', (filePath) => {
    const rel = path.relative(CLAUDE_DIR, filePath)
    if (rel.startsWith('workflows')) {
      emit('workflows_update', { filePath: rel, ts: Date.now() })
    } else if (rel.startsWith('skills') || rel.startsWith('commands')) {
      emit('skills_update', { filePath: rel, ts: Date.now() })
    }
  })

  console.log(`Watching ${CLAUDE_DIR}`)
  return watcher
}
