import { vi } from 'vitest'
import { isReady, setReady, isShuttingDown, registerShutdown, _reset } from '../../lib/lifecycle.js'

const closeAll = vi.fn()
const closeDb = vi.fn()
vi.mock('../../sse.js', () => ({ closeAll: () => closeAll() }))
vi.mock('../../lib/db/connection.js', () => ({ closeDb: () => closeDb() }))

describe('lifecycle', () => {
  beforeEach(() => {
    _reset()
    closeAll.mockClear()
    closeDb.mockClear()
  })

  test('isReady defaults to false', () => {
    expect(isReady()).toBe(false)
  })

  test('setReady makes isReady return true', () => {
    setReady()
    expect(isReady()).toBe(true)
  })

  test('isShuttingDown defaults to false', () => {
    expect(isShuttingDown()).toBe(false)
  })

  test('_reset resets all state', () => {
    setReady()
    expect(isReady()).toBe(true)
    _reset()
    expect(isReady()).toBe(false)
  })

  test('shutdown closes server, SSE clients, DB, and watcher then exits 0', async () => {
    const server = { close: vi.fn() }
    const watcher = { close: vi.fn().mockResolvedValue(undefined) }
    const exit = vi.fn()
    const shutdown = registerShutdown({ server, watcher, exit })

    await shutdown('SIGTERM')

    expect(server.close).toHaveBeenCalled()
    expect(closeAll).toHaveBeenCalled()
    expect(closeDb).toHaveBeenCalled()
    expect(watcher.close).toHaveBeenCalled()
    expect(exit).toHaveBeenCalledWith(0)
    expect(isShuttingDown()).toBe(true)
  })

  test('shutdown is idempotent — a second call is a no-op', async () => {
    const server = { close: vi.fn() }
    const exit = vi.fn()
    const shutdown = registerShutdown({ server, exit })

    await shutdown('SIGTERM')
    await shutdown('SIGINT')

    expect(server.close).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledTimes(1)
  })
})
