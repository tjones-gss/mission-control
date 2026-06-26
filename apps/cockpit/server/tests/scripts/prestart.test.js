import net from 'node:net'
import { isPortInUse, checkPorts } from '../../scripts/prestart.js'

// Bind a throwaway listener on an OS-assigned port and hand back its number +
// a closer, so each test owns a real, known-occupied port without hardcoding.
function occupyPort() {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ port, close: () => new Promise((r) => server.close(r)) })
    })
  })
}

describe('prestart port checker', () => {
  test('isPortInUse returns true for an occupied port', async () => {
    const { port, close } = await occupyPort()
    try {
      expect(await isPortInUse(port)).toBe(true)
    } finally {
      await close()
    }
  })

  test('isPortInUse returns false once the port is freed', async () => {
    const { port, close } = await occupyPort()
    await close()
    expect(await isPortInUse(port)).toBe(false)
  })

  test('checkPorts reports inUse per port', async () => {
    const { port: busy, close } = await occupyPort()
    const { port: free, close: closeFree } = await occupyPort()
    await closeFree()
    try {
      const results = await checkPorts([busy, free])
      expect(results).toHaveLength(2)
      const byPort = Object.fromEntries(results.map((r) => [r.port, r]))
      expect(byPort[busy].inUse).toBe(true)
      expect(byPort[free].inUse).toBe(false)
      // pid is best-effort: a number when identifiable, otherwise null
      expect(['number', 'object']).toContain(typeof byPort[busy].pid)
    } finally {
      await close()
    }
  })
})
