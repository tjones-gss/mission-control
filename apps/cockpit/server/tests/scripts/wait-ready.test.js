import { waitForReady } from '../../../../../scripts/wait-ready.js'

describe('wait-ready health poller', () => {
  test('resolves true once the endpoint returns 200', async () => {
    let calls = 0
    const fetchImpl = async () => {
      calls += 1
      if (calls < 3) throw new Error('ECONNREFUSED') // server not up yet
      return { ok: true, status: 200 }
    }
    const ok = await waitForReady({
      url: 'http://localhost:3001/api/health',
      intervalMs: 1,
      timeoutMs: 1000,
      fetchImpl,
      sleep: async () => {},
    })
    expect(ok).toBe(true)
    expect(calls).toBe(3)
  })

  test('resolves false when never healthy before the timeout', async () => {
    let calls = 0
    const fetchImpl = async () => {
      calls += 1
      throw new Error('ECONNREFUSED')
    }
    const ok = await waitForReady({
      url: 'http://localhost:3001/api/health',
      intervalMs: 2,
      timeoutMs: 15,
      fetchImpl,
      sleep: async (ms) => new Promise((r) => setTimeout(r, ms)),
    })
    expect(ok).toBe(false)
    expect(calls).toBeGreaterThan(0)
  })

  test('treats a non-200 response as not-ready', async () => {
    let calls = 0
    const fetchImpl = async () => {
      calls += 1
      if (calls < 2) return { ok: false, status: 503 }
      return { ok: true, status: 200 }
    }
    const ok = await waitForReady({
      url: 'http://localhost:3001/api/health',
      intervalMs: 1,
      timeoutMs: 1000,
      fetchImpl,
      sleep: async () => {},
    })
    expect(ok).toBe(true)
    expect(calls).toBe(2)
  })
})
