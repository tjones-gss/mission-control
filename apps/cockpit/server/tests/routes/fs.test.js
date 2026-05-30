import os from 'os'
import path from 'path'
import express from 'express'
import request from 'supertest'

const statMock = vi.fn()
const readdirMock = vi.fn()

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

const { router } = await import('../../routes/fs.js')

function createApp() {
  const app = express()
  app.use('/api/fs', router)
  return app
}

function makeDirent(name, isDir) {
  return { name, isDirectory: () => isDir, isFile: () => !isDir }
}

beforeEach(() => {
  statMock.mockReset()
  readdirMock.mockReset()
})

describe('GET /api/fs/home', () => {
  test('returns home directory and platform separator', async () => {
    const res = await request(createApp()).get('/api/fs/home')
    expect(res.status).toBe(200)
    expect(res.body.path).toBe(os.homedir())
    expect(res.body.sep).toBe(path.sep)
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
