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

export function registerShutdown({ server, watcher }) {
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

    // 3. Close file watcher
    if (watcher && typeof watcher.close === 'function') {
      await watcher.close()
    }

    // 4. Exit
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err)
    process.exit(1)
  })

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason)
    process.exit(1)
  })
}
