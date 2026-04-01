vi.mock('fs', () => {
  const promises = {
    access: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(),
    mkdir: vi.fn(), unlink: vi.fn(),
  }
  return {
    default: {
      existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn(),
      statSync: vi.fn(), promises,
    },
    existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn(),
    statSync: vi.fn(), promises,
  }
})

import fs from 'fs'
import { getAllPlans, getPlanByFilename } from '../../parsers/plans.js'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('getAllPlans()', () => {
  it('returns [] when plans dir does not exist', () => {
    fs.existsSync.mockReturnValue(false)
    expect(getAllPlans()).toEqual([])
  })

  it('parses .md files and extracts name from # heading', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue(['plan-a.md'])
    fs.statSync.mockReturnValue({ mtimeMs: 1000 })
    fs.readFileSync.mockReturnValue('# My Great Plan\n\nSome content here.')

    const result = getAllPlans()
    expect(result).toHaveLength(1)
    expect(result[0].filename).toBe('plan-a.md')
    expect(result[0].name).toBe('My Great Plan')
    expect(result[0].lastModified).toBe(1000)
  })

  it('falls back to filename when no heading', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue(['plan-b.md'])
    fs.statSync.mockReturnValue({ mtimeMs: 2000 })
    fs.readFileSync.mockReturnValue('No heading in this file.')

    const result = getAllPlans()
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('plan-b.md')
  })

  it('sorts by lastModified desc', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue(['old.md', 'new.md'])
    fs.statSync
      .mockReturnValueOnce({ mtimeMs: 1000 })
      .mockReturnValueOnce({ mtimeMs: 5000 })
    fs.readFileSync
      .mockReturnValueOnce('# Old Plan')
      .mockReturnValueOnce('# New Plan')

    const result = getAllPlans()
    expect(result).toHaveLength(2)
    expect(result[0].filename).toBe('new.md')
    expect(result[1].filename).toBe('old.md')
  })

  it('skips non-.md files', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue(['plan.md', 'notes.txt', 'readme.json'])
    fs.statSync.mockReturnValue({ mtimeMs: 1000 })
    fs.readFileSync.mockReturnValue('# Plan')

    const result = getAllPlans()
    expect(result).toHaveLength(1)
    expect(result[0].filename).toBe('plan.md')
  })

  it('skips files that throw during read', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue(['bad.md', 'good.md'])
    fs.statSync
      .mockImplementationOnce(() => { throw new Error('stat failed') })
      .mockReturnValueOnce({ mtimeMs: 1000 })
    fs.readFileSync.mockReturnValue('# Good Plan')

    const result = getAllPlans()
    expect(result).toHaveLength(1)
    expect(result[0].filename).toBe('good.md')
  })
})

describe('getPlanByFilename()', () => {
  it('returns null for non-existent file', () => {
    fs.statSync.mockImplementation(() => { throw new Error('ENOENT') })
    expect(getPlanByFilename('missing.md')).toBeNull()
  })

  it('rejects path traversal with ..', () => {
    expect(getPlanByFilename('../etc/passwd')).toBeNull()
  })

  it('rejects path traversal with forward slash', () => {
    expect(getPlanByFilename('foo/bar.md')).toBeNull()
  })

  it('rejects path traversal with backslash', () => {
    expect(getPlanByFilename('foo\\bar.md')).toBeNull()
  })

  it('returns plan data for valid file', () => {
    fs.statSync.mockReturnValue({ mtimeMs: 3000 })
    fs.readFileSync.mockReturnValue('# Deployment Plan\n\nStep 1: Deploy.')

    const result = getPlanByFilename('deploy.md')
    expect(result).not.toBeNull()
    expect(result.filename).toBe('deploy.md')
    expect(result.name).toBe('Deployment Plan')
    expect(result.content).toBe('# Deployment Plan\n\nStep 1: Deploy.')
    expect(result.lastModified).toBe(3000)
  })

  it('falls back to filename when no heading', () => {
    fs.statSync.mockReturnValue({ mtimeMs: 4000 })
    fs.readFileSync.mockReturnValue('Just some text with no heading.')

    const result = getPlanByFilename('notes.md')
    expect(result.name).toBe('notes.md')
  })
})
