import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}))

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
  },
  existsSync: vi.fn(() => true),
}))

// Import AFTER mocks so CLAUDE_BIN (evaluated at module load) doesn't short-circuit
// the mocks on first import. We re-import after resetModules in each test to get
// fresh module state.
const origPlatform = process.platform

function setPlatform(p) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

async function loadFreshModule() {
  vi.resetModules()
  return await import('../../lib/claude-bin.js')
}

describe('resolveClaudeBin', () => {
  beforeEach(async () => {
    const cp = await import('child_process')
    cp.execFileSync.mockReset()
    const fs = await import('fs')
    fs.default.existsSync.mockReset()
    fs.default.existsSync.mockReturnValue(true)
  })

  afterEach(() => {
    setPlatform(origPlatform)
  })

  test('returns the native-installer .exe on Windows when it resolves first', async () => {
    setPlatform('win32')
    const cp = await import('child_process')
    cp.execFileSync.mockImplementation((_locator, [name]) => {
      if (name === 'claude.exe') return 'C:\\Users\\u\\.local\\bin\\claude.exe\r\n'
      throw new Error('not found')
    })
    const { resolveClaudeBin } = await loadFreshModule()
    expect(resolveClaudeBin()).toBe('C:\\Users\\u\\.local\\bin\\claude.exe')
  })

  test('falls back to .cmd when .exe is absent on Windows', async () => {
    setPlatform('win32')
    const cp = await import('child_process')
    cp.execFileSync.mockImplementation((_locator, [name]) => {
      if (name === 'claude.exe') throw new Error('not found')
      if (name === 'claude.cmd') return 'C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd\r\n'
      throw new Error('not found')
    })
    const { resolveClaudeBin } = await loadFreshModule()
    expect(resolveClaudeBin()).toBe('C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd')
  })

  test('uses `which claude` on non-Windows platforms', async () => {
    setPlatform('linux')
    const cp = await import('child_process')
    cp.execFileSync.mockImplementation((locator, [name]) => {
      expect(locator).toBe('which')
      expect(name).toBe('claude')
      return '/usr/local/bin/claude\n'
    })
    const { resolveClaudeBin } = await loadFreshModule()
    expect(resolveClaudeBin()).toBe('/usr/local/bin/claude')
  })

  test('throws install-guidance error when no candidate resolves', async () => {
    setPlatform('win32')
    const cp = await import('child_process')
    cp.execFileSync.mockImplementation(() => {
      throw new Error('not found')
    })
    // Module load evaluates the top-level CLAUDE_BIN, so import itself rejects.
    await expect(loadFreshModule()).rejects.toThrow(/Claude CLI not found on PATH/)
  })

  test('skips a candidate whose resolved path fails existsSync', async () => {
    setPlatform('win32')
    const cp = await import('child_process')
    cp.execFileSync.mockImplementation((_locator, [name]) => {
      if (name === 'claude.exe') return 'C:\\stale\\claude.exe\r\n'
      if (name === 'claude.cmd') return 'C:\\real\\claude.cmd\r\n'
      throw new Error('not found')
    })
    const fs = await import('fs')
    fs.default.existsSync.mockImplementation((p) => p === 'C:\\real\\claude.cmd')
    const { resolveClaudeBin } = await loadFreshModule()
    expect(resolveClaudeBin()).toBe('C:\\real\\claude.cmd')
  })

  test('takes only the first line of where.exe output (multiple matches)', async () => {
    setPlatform('win32')
    const cp = await import('child_process')
    cp.execFileSync.mockImplementation((_locator, [name]) => {
      if (name === 'claude.exe') {
        return 'C:\\first\\claude.exe\r\nC:\\second\\claude.exe\r\n'
      }
      throw new Error('not found')
    })
    const { resolveClaudeBin } = await loadFreshModule()
    expect(resolveClaudeBin()).toBe('C:\\first\\claude.exe')
  })
})

describe('isShellScript', () => {
  test('identifies .cmd, .bat, .ps1 as shell scripts', async () => {
    setPlatform('win32')
    const cp = await import('child_process')
    cp.execFileSync.mockReturnValue('C:\\x\\claude.exe\r\n')
    const { isShellScript } = await loadFreshModule()
    expect(isShellScript('C:\\x\\claude.cmd')).toBe(true)
    expect(isShellScript('C:\\x\\CLAUDE.CMD')).toBe(true)
    expect(isShellScript('C:\\x\\claude.bat')).toBe(true)
    expect(isShellScript('C:\\x\\claude.ps1')).toBe(true)
    expect(isShellScript('C:\\x\\claude.exe')).toBe(false)
    expect(isShellScript('/usr/local/bin/claude')).toBe(false)
  })
})
