vi.mock('fs', () => {
  const promises = {
    access: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(),
    mkdir: vi.fn(), unlink: vi.fn(),
  }
  return {
    default: {
      existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn(),
      statSync: vi.fn(), accessSync: vi.fn(), promises,
    },
    existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn(),
    statSync: vi.fn(), accessSync: vi.fn(), promises,
  }
})

import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  deepMerge,
  trackSources,
  getConfigForSession,
  getUserConfig,
} from '../../parsers/config.js'

beforeEach(() => {
  vi.resetAllMocks()
})

const USER_CONFIG = path.join(os.homedir(), '.claude', 'settings.json')

describe('deepMerge()', () => {
  it('merges flat objects with b winning', () => {
    const a = { foo: 1, bar: 2 }
    const b = { bar: 3, baz: 4 }
    expect(deepMerge(a, b)).toEqual({ foo: 1, bar: 3, baz: 4 })
  })

  it('deep merges nested objects', () => {
    const a = { env: { A: '1', B: '2' } }
    const b = { env: { B: '3', C: '4' } }
    expect(deepMerge(a, b)).toEqual({ env: { A: '1', B: '3', C: '4' } })
  })

  it('replaces arrays instead of merging them', () => {
    const a = { permissions: ['read'] }
    const b = { permissions: ['write'] }
    expect(deepMerge(a, b)).toEqual({ permissions: ['write'] })
  })

  it('does not mutate the original objects', () => {
    const a = { env: { A: '1' } }
    const b = { env: { B: '2' } }
    deepMerge(a, b)
    expect(a).toEqual({ env: { A: '1' } })
    expect(b).toEqual({ env: { B: '2' } })
  })
})

describe('trackSources()', () => {
  it('tracks sources correctly for each top-level key', () => {
    const user = { env: {}, permissions: [] }
    const project = { permissions: [], hooks: {} }
    const local = { hooks: {}, statusLine: '' }
    const sources = trackSources(user, project, local)
    expect(sources.env).toBe('user')
    expect(sources.permissions).toBe('project')
    expect(sources.hooks).toBe('local')
    expect(sources.statusLine).toBe('local')
  })

  it('returns empty object when all configs are empty', () => {
    expect(trackSources({}, {}, {})).toEqual({})
  })

  it('local overrides project which overrides user', () => {
    const user = { key: 'a' }
    const project = { key: 'b' }
    const local = { key: 'c' }
    const sources = trackSources(user, project, local)
    expect(sources.key).toBe('local')
  })
})

describe('getUserConfig()', () => {
  it('reads and returns user config', () => {
    const config = { env: { EDITOR: 'vim' }, permissions: ['read'] }
    fs.readFileSync.mockReturnValue(JSON.stringify(config))
    expect(getUserConfig()).toEqual(config)
    expect(fs.readFileSync).toHaveBeenCalledWith(USER_CONFIG, 'utf-8')
  })

  it('returns {} when user config file is missing', () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT') })
    expect(getUserConfig()).toEqual({})
  })

  it('handles malformed JSON gracefully', () => {
    fs.readFileSync.mockReturnValue('{bad json!!')
    expect(getUserConfig()).toEqual({})
  })
})

describe('getConfigForSession()', () => {
  const cwd = '/home/user/my-project'
  const projectPath = path.join(cwd, '.claude', 'settings.json')
  const localPath = path.join(cwd, '.claude', 'settings.local.json')

  function mockConfigFiles(user, project, local) {
    fs.readFileSync.mockImplementation((filePath) => {
      if (filePath === USER_CONFIG && user !== null) return JSON.stringify(user)
      if (filePath === projectPath && project !== null) return JSON.stringify(project)
      if (filePath === localPath && local !== null) return JSON.stringify(local)
      throw new Error('ENOENT')
    })
    fs.accessSync.mockImplementation((filePath) => {
      if (filePath === USER_CONFIG && user !== null) return undefined
      if (filePath === projectPath && project !== null) return undefined
      if (filePath === localPath && local !== null) return undefined
      throw new Error('ENOENT')
    })
  }

  it('returns empty merged when no config files exist', () => {
    mockConfigFiles(null, null, null)
    const result = getConfigForSession(cwd)
    expect(result.merged).toEqual({})
    expect(result.sources).toEqual({})
    expect(result.files).toHaveLength(3)
    expect(result.files[0]).toEqual({ level: 'user', path: USER_CONFIG, exists: false })
    expect(result.files[1]).toEqual({ level: 'project', path: projectPath, exists: false })
    expect(result.files[2]).toEqual({ level: 'local', path: localPath, exists: false })
  })

  it('reads and returns user config only', () => {
    const userCfg = { env: { EDITOR: 'vim' }, permissions: ['read'] }
    mockConfigFiles(userCfg, null, null)
    const result = getConfigForSession(cwd)
    expect(result.merged).toEqual(userCfg)
    expect(result.sources.env).toBe('user')
    expect(result.sources.permissions).toBe('user')
    expect(result.files[0].exists).toBe(true)
    expect(result.files[1].exists).toBe(false)
  })

  it('merges project config over user config', () => {
    const userCfg = { env: { A: '1', B: '2' }, permissions: ['read'] }
    const projectCfg = { env: { B: '3' }, hooks: { pre: 'lint' } }
    mockConfigFiles(userCfg, projectCfg, null)
    const result = getConfigForSession(cwd)
    expect(result.merged.env).toEqual({ A: '1', B: '3' })
    expect(result.merged.permissions).toEqual(['read'])
    expect(result.merged.hooks).toEqual({ pre: 'lint' })
    expect(result.sources.env).toBe('project')
    expect(result.sources.permissions).toBe('user')
    expect(result.sources.hooks).toBe('project')
  })

  it('merges local config over project config', () => {
    const userCfg = { env: { A: '1' } }
    const projectCfg = { env: { B: '2' }, hooks: { pre: 'lint' } }
    const localCfg = { hooks: { pre: 'test' }, statusLine: 'custom' }
    mockConfigFiles(userCfg, projectCfg, localCfg)
    const result = getConfigForSession(cwd)
    expect(result.merged.env).toEqual({ A: '1', B: '2' })
    expect(result.merged.hooks).toEqual({ pre: 'test' })
    expect(result.merged.statusLine).toBe('custom')
    expect(result.sources.env).toBe('project')
    expect(result.sources.hooks).toBe('local')
    expect(result.sources.statusLine).toBe('local')
  })

  it('tracks sources correctly for each top-level key', () => {
    const userCfg = { a: 1, b: 2 }
    const projectCfg = { b: 3, c: 4 }
    const localCfg = { c: 5, d: 6 }
    mockConfigFiles(userCfg, projectCfg, localCfg)
    const result = getConfigForSession(cwd)
    expect(result.sources).toEqual({ a: 'user', b: 'project', c: 'local', d: 'local' })
  })

  it('handles malformed JSON gracefully (returns {} for that level)', () => {
    fs.readFileSync.mockImplementation((filePath) => {
      if (filePath === USER_CONFIG) return '{"valid": true}'
      if (filePath === projectPath) return '{not valid json!!!'
      throw new Error('ENOENT')
    })
    fs.accessSync.mockImplementation((filePath) => {
      if (filePath === USER_CONFIG) return undefined
      if (filePath === projectPath) return undefined
      throw new Error('ENOENT')
    })
    const result = getConfigForSession(cwd)
    expect(result.merged).toEqual({ valid: true })
    expect(result.sources.valid).toBe('user')
  })

  it('reports file existence correctly', () => {
    mockConfigFiles({ a: 1 }, { b: 2 }, null)
    const result = getConfigForSession(cwd)
    expect(result.files[0].exists).toBe(true)
    expect(result.files[1].exists).toBe(true)
    expect(result.files[2].exists).toBe(false)
  })
})
