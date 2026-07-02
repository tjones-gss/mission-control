import os from 'os'
import path from 'path'
import express from 'express'
import request from 'supertest'
import { EventEmitter } from 'node:events'

const statMock = vi.fn()
const readdirMock = vi.fn()
const spawnMock = vi.fn()

vi.mock('fs', () => ({
  default: {
    promises: {
      stat: (...args) => statMock(...args),
      readdir: (...args) => readdirMock(...args),
    },
  },
  promises: {
    stat: (...args) => statMock(...args),
    readdir: (...args) => readdirMock(...args),
  },
}))

vi.mock('node:child_process', () => ({
  spawn: (...args) => spawnMock(...args),
}))

const { router } = await import('../../routes/fs.js')

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/fs', router)
  return app
}

function makeDirent(name, isDir) {
  return { name, isDirectory: () => isDir, isFile: () => !isDir }
}

function mockPickerProcess({ code = 0, stdout = '', error = null } = {}) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  spawnMock.mockImplementationOnce(() => {
    setImmediate(() => {
      if (error) {
        child.emit('error', error)
        return
      }
      if (stdout) child.stdout.emit('data', Buffer.from(stdout))
      child.emit('close', code)
    })
    return child
  })
}

beforeEach(() => {
  statMock.mockReset()
  readdirMock.mockReset()
  spawnMock.mockReset()
})

describe('GET /api/fs/home', () => {
  test('returns home directory and platform separator', async () => {
    const res = await request(createApp()).get('/api/fs/home')
    expect(res.status).toBe(200)
    expect(res.body.path).toBe(os.homedir())
    expect(res.body.sep).toBe(path.sep)
  })
})

describe('POST /api/fs/pick-directory', () => {
  test('200 returns the selected native directory path', async () => {
    mockPickerProcess({ stdout: `${path.resolve('/workspace/native')}\n` })
    const res = await request(createApp())
      .post('/api/fs/pick-directory')
      .send({ path: path.resolve('/workspace') })

    expect(res.status).toBe(200)
    expect(res.body.path).toBe(path.resolve('/workspace/native'))
    expect(spawnMock).toHaveBeenCalled()
  })

  test('204 when the native picker is cancelled', async () => {
    mockPickerProcess({ code: 2 })
    const res = await request(createApp()).post('/api/fs/pick-directory').send({})

    expect(res.status).toBe(204)
  })

  test('501 when no native picker command is available', async () => {
    const err = new Error('missing picker')
    err.code = 'ENOENT'
    mockPickerProcess({ error: err })
    const res = await request(createApp()).post('/api/fs/pick-directory').send({})

    expect(res.status).toBe(501)
    expect(res.body.error).toMatch(/unavailable/i)
  })

  test('500 (not 204-cancel) on an unexpected exit code, without leaking stderr', async () => {
    mockPickerProcess({ code: 3 })
    const res = await request(createApp()).post('/api/fs/pick-directory').send({})

    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/failed/i)
    expect(res.body.detail).toBeUndefined()
  })

  test('on Windows, exit 1 is a script ERROR (500), not user-cancel — only exit 2 cancels', async () => {
    // PowerShell exits 1 when the script itself fails (e.g. WinForms
    // unavailable in a headless session); the picker script exits 2 on
    // user-cancel. Mapping 1 → cancel would mask a permanently broken picker.
    const realPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      mockPickerProcess({ code: 1 })
      const res = await request(createApp()).post('/api/fs/pick-directory').send({})
      expect(res.status).toBe(500)

      mockPickerProcess({ code: 2 })
      const cancelled = await request(createApp()).post('/api/fs/pick-directory').send({})
      expect(cancelled.status).toBe(204)
    } finally {
      Object.defineProperty(process, 'platform', { value: realPlatform })
    }
  })

  test('on POSIX, exit 1 is user-cancel (204)', async () => {
    const realPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux' })
    try {
      mockPickerProcess({ code: 1 })
      const res = await request(createApp()).post('/api/fs/pick-directory').send({})
      expect(res.status).toBe(204)
    } finally {
      Object.defineProperty(process, 'platform', { value: realPlatform })
    }
  })

  test('on Windows, the initial path travels via env var, never argv (injection safety)', async () => {
    const realPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      mockPickerProcess({ code: 2 })
      const hostile = 'C:\\some dir"; rm -rf /'
      await request(createApp()).post('/api/fs/pick-directory').send({ path: hostile })

      const [, args, options] = spawnMock.mock.calls[0]
      expect(options.env.MC_INITIAL_DIRECTORY).toBe(hostile)
      for (const arg of args) {
        expect(arg).not.toContain(hostile)
      }
    } finally {
      Object.defineProperty(process, 'platform', { value: realPlatform })
    }
  })

  test('409 when a picker dialog is already open (single-flight)', async () => {
    // First request hangs on a child that never closes; the second must be
    // rejected instead of stacking a second native dialog on the desktop.
    const hanging = new EventEmitter()
    hanging.stdout = new EventEmitter()
    hanging.stderr = new EventEmitter()
    hanging.kill = vi.fn()
    spawnMock.mockImplementationOnce(() => hanging)

    const app = createApp()
    const first = request(app).post('/api/fs/pick-directory').send({})
    const firstSettled = first.then((r) => r)
    // Yield so the first request reaches the route and spawns.
    await new Promise((r) => setImmediate(r))

    const second = await request(app).post('/api/fs/pick-directory').send({})
    expect(second.status).toBe(409)

    hanging.emit('close', 0)
    hanging.stdout.emit('data', Buffer.from(''))
    const firstRes = await firstSettled
    // Closed with code 0 and empty stdout → treated as cancel (204).
    expect(firstRes.status).toBe(204)
  })
})

describe('GET /api/fs/list — validation', () => {
  test('400 when path query param is missing', async () => {
    const res = await request(createApp()).get('/api/fs/list')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('path is required')
  })

  test('400 when path is not absolute', async () => {
    const res = await request(createApp()).get('/api/fs/list').query({ path: 'relative/dir' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/absolute/)
  })

  test('400 when path contains NUL byte', async () => {
    const input = path.isAbsolute('/x') ? '/foo\u0000bar' : 'C:\\foo\u0000bar'
    const res = await request(createApp()).get('/api/fs/list').query({ path: input })
    expect(res.status).toBe(400)
  })

  test('400 when path is a UNC share (backslash form) — platform-independent', async () => {
    // The UNC guard is a pure string-prefix check so the dashboard stays
    // local-only on every OS. Prior revision gated this on process.platform
    // === 'win32', which was wrong: path.isAbsolute on Linux returns false
    // for `\\\\server\\share` and the test tripped the "must be absolute"
    // branch before reaching the UNC guard, breaking CI on Linux runners.
    const res = await request(createApp())
      .get('/api/fs/list')
      .query({ path: '\\\\evil-server\\share' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/UNC/i)
    expect(statMock).not.toHaveBeenCalled()
    expect(readdirMock).not.toHaveBeenCalled()
  })

  test('400 when path uses forward-slash UNC form — platform-independent', async () => {
    const res = await request(createApp())
      .get('/api/fs/list')
      .query({ path: '//evil-server/share' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/UNC/i)
    expect(statMock).not.toHaveBeenCalled()
    expect(readdirMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/fs/list — filesystem responses', () => {
  test('404 when path does not exist (ENOENT)', async () => {
    const err = new Error('nope')
    err.code = 'ENOENT'
    statMock.mockRejectedValueOnce(err)
    const abs = path.resolve('/does/not/exist')
    const res = await request(createApp()).get('/api/fs/list').query({ path: abs })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found/i)
  })

  test('400 when path exists but is a file', async () => {
    statMock.mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true })
    const abs = path.resolve('/some/file.txt')
    const res = await request(createApp()).get('/api/fs/list').query({ path: abs })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('not a directory')
  })

  test('403 when readdir throws EACCES', async () => {
    statMock.mockResolvedValueOnce({ isDirectory: () => true })
    const err = new Error('denied')
    err.code = 'EACCES'
    readdirMock.mockRejectedValueOnce(err)
    const abs = path.resolve('/root')
    const res = await request(createApp()).get('/api/fs/list').query({ path: abs })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('permission denied')
  })

  test('200 returns only directory entries sorted alphabetically', async () => {
    statMock.mockResolvedValueOnce({ isDirectory: () => true })
    readdirMock.mockResolvedValueOnce([
      makeDirent('zeta', true),
      makeDirent('README.md', false),
      makeDirent('alpha', true),
      makeDirent('beta', true),
    ])
    const abs = path.resolve('/workspace')
    const res = await request(createApp()).get('/api/fs/list').query({ path: abs })
    expect(res.status).toBe(200)
    expect(res.body.path).toBe(abs)
    expect(res.body.sep).toBe(path.sep)
    expect(res.body.entries).toEqual([
      { name: 'alpha', type: 'dir' },
      { name: 'beta', type: 'dir' },
      { name: 'zeta', type: 'dir' },
    ])
  })

  test('returns parent = null when path is filesystem root (platform-agnostic)', async () => {
    statMock.mockResolvedValueOnce({ isDirectory: () => true })
    readdirMock.mockResolvedValueOnce([])
    // path.parse(os.homedir()).root is the OS-appropriate root: "/" on POSIX, "C:\" on Windows.
    const root = path.parse(os.homedir()).root
    const res = await request(createApp()).get('/api/fs/list').query({ path: root })
    expect(res.status).toBe(200)
    expect(res.body.parent).toBe(null)
  })

  test('returns parent = path.dirname for a nested directory', async () => {
    statMock.mockResolvedValueOnce({ isDirectory: () => true })
    readdirMock.mockResolvedValueOnce([])
    const abs = path.resolve(os.homedir(), 'Projects', 'oversight')
    const res = await request(createApp()).get('/api/fs/list').query({ path: abs })
    expect(res.status).toBe(200)
    expect(res.body.parent).toBe(path.dirname(abs))
  })
})
