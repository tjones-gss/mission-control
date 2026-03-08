import chokidar from 'chokidar'
import path from 'path'
import os from 'os'

const CLAUDE_DIR = path.join(os.homedir(), '.claude')

// In-memory set of SSE response objects
const clients = new Set()

export function addClient(res) {
  clients.add(res)
  res.on('close', () => clients.delete(res))
}

export function emit(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of clients) {
    try { client.write(payload) } catch { clients.delete(client) }
  }
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

  watcher.on('change', filePath => {
    const rel = path.relative(CLAUDE_DIR, filePath)

    if (rel.startsWith('projects') && filePath.endsWith('.jsonl')) {
      emit('session_update', { filePath: rel, ts: Date.now() })
    } else if (rel.startsWith('tasks')) {
      emit('task_update', { filePath: rel, ts: Date.now() })
    } else if (rel.startsWith('teams')) {
      emit('team_update', { filePath: rel, ts: Date.now() })
    } else if (rel === 'history.jsonl') {
      emit('history_update', { ts: Date.now() })
    }
  })

  watcher.on('add', filePath => {
    const rel = path.relative(CLAUDE_DIR, filePath)
    if (rel.startsWith('projects') && filePath.endsWith('.jsonl')) {
      emit('new_session', { filePath: rel, ts: Date.now() })
    }
  })

  console.log(`Watching ${CLAUDE_DIR}`)
}
