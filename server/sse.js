// Shared SSE client registry — imported by watcher.js and intelligence/triggers.js
// Kept in a separate module to avoid circular imports.

const clients = new Set()

export function addClient(res) {
  clients.add(res)
  res.on('close', () => clients.delete(res))
}

export function removeClient(res) {
  clients.delete(res)
}

export function closeAll() {
  for (const client of clients) {
    try {
      client.end()
    } catch {
      /* ignore */
    }
  }
  clients.clear()
}

// Internal listeners for server-side modules (e.g. pty-session completion detection)
const listeners = []

export function onEvent(callback) {
  listeners.push(callback)
  return () => {
    const i = listeners.indexOf(callback)
    if (i >= 0) listeners.splice(i, 1)
  }
}

export function emit(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of clients) {
    try {
      client.write(payload)
    } catch {
      clients.delete(client)
    }
  }
  // Notify internal listeners
  for (const cb of listeners) {
    try {
      cb(event, data)
    } catch {
      /* ignore */
    }
  }
}
