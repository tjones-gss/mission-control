let ready = false
let shuttingDown = false

export function isReady() {
  return ready && !shuttingDown
}
export function setReady() {
  ready = true
}
export function isShuttingDown() {
  return shuttingDown
}

// For testing: reset state
export function _reset() {
  ready = false
  shuttingDown = false
}

export function registerShutdown({ server, watcher, exit = (code) => process.exit(code) }) {
  const shutdown = async (signal) => {
    if (shuttingDown) return
    shuttingDown = true

    // 1. Stop accepting new connections
    server.close()

    // 2. Close SSE clients
    try {
      const { closeAll } = await import('../sse.js')
      closeAll()
    } catch {
      /* sse module may not be loaded in tests */
    }

    // 3. Close the SQLite derived-cache connection (ADR-0008). Releasing the
    // handle flushes WAL and avoids leaving a wedged lock for the next boot —
    // the same stale-process class the prestart guard warns about. Best-effort:
    // the cache is rebuildable, so a close failure must never block exit.
    try {
      const { closeDb } = await import('./db/connection.js')
      closeDb()
    } catch {
      /* db module may not be loaded (degraded mode / tests) */
    }

    // 4. Stop LAN mDNS advertisement (Sprint 2-b), so we send a goodbye packet
    // and free the multicast socket instead of leaving a stale record on the
    // LAN. Best-effort: a no-op when not advertising (the loopback default) and
    // never blocks shutdown. Dynamic import mirrors the sse/db handling above.
    try {
      const { stopDiscovery } = await import('./discovery.js')
      stopDiscovery()
    } catch {
      /* discovery module may not be loaded in tests */
    }

    // 5. Close file watcher
    if (watcher && typeof watcher.close === 'function') {
      await watcher.close()
    }

    // 6. Exit
    exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err)
    process.exit(1)
  })

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason)
    // Log but don't crash — PTY errors on Windows can trigger unhandled rejections
    // that are non-fatal to the rest of the server.
  })

  // Returned so the sequence is unit-testable without raising a real signal.
  return shutdown
}
