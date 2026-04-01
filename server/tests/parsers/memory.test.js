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
import path from 'path'
import os from 'os'
import { getMemoryForSession, parseFrontmatter } from '../../parsers/memory.js'

const CLAUDE_DIR = path.join(os.homedir(), '.claude')
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects')

beforeEach(() => {
  vi.resetAllMocks()
})

// Helpers
function makeStat(mtimeMs = Date.now() - 10_000) {
  return { mtimeMs }
}

function makeProjectDirEntry(name) {
  return { name, isDirectory: () => true }
}

function makeSessionJsonl(overrides = {}) {
  return JSON.stringify({ uuid: 'rec-1', type: 'user', cwd: '/home/user/project', ...overrides })
}

// ──────────────────────────────────────────────────────────────────────────────
// parseFrontmatter()
// ──────────────────────────────────────────────────────────────────────────────

describe('parseFrontmatter()', () => {
  it('returns null frontmatter when content has no frontmatter', () => {
    const result = parseFrontmatter('# Just a heading\nSome body text.')
    expect(result.frontmatter).toBeNull()
    expect(result.body).toBe('# Just a heading\nSome body text.')
  })

  it('parses key-value pairs from frontmatter block', () => {
    const content = `---
name: my-memory
description: A test memory file
type: note
---
# Body content here`
    const result = parseFrontmatter(content)
    expect(result.frontmatter).toEqual({
      name: 'my-memory',
      description: 'A test memory file',
      type: 'note',
    })
    expect(result.body).toBe('# Body content here')
  })

  it('returns null frontmatter when closing --- is missing', () => {
    const content = `---
name: broken
no closing delimiter`
    const result = parseFrontmatter(content)
    expect(result.frontmatter).toBeNull()
  })

  it('handles empty content', () => {
    const result = parseFrontmatter('')
    expect(result.frontmatter).toBeNull()
    expect(result.body).toBe('')
  })

  it('handles null/undefined content', () => {
    expect(parseFrontmatter(null).frontmatter).toBeNull()
    expect(parseFrontmatter(undefined).frontmatter).toBeNull()
  })

  it('handles frontmatter with colons in values', () => {
    const content = `---
url: https://example.com:8080/path
---
Body`
    const result = parseFrontmatter(content)
    expect(result.frontmatter.url).toBe('https://example.com:8080/path')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// getMemoryForSession()
// ──────────────────────────────────────────────────────────────────────────────

describe('getMemoryForSession()', () => {
  it('returns null when session is not found in any project dir', () => {
    fs.existsSync.mockReturnValue(false)
    expect(getMemoryForSession('nonexistent')).toBeNull()
  })

  it('returns null when projects dir exists but session file is missing', () => {
    // existsSync: projects dir exists, but session .jsonl does not
    fs.existsSync.mockImplementation((p) => {
      if (p === PROJECTS_DIR) return true
      return false
    })
    fs.readdirSync.mockReturnValue([makeProjectDirEntry('C--project')])

    expect(getMemoryForSession('no-such-session')).toBeNull()
  })

  it('reads global CLAUDE.md content', () => {
    const globalPath = path.join(CLAUDE_DIR, 'CLAUDE.md')

    fs.existsSync.mockImplementation((p) => {
      if (p === PROJECTS_DIR) return true
      if (p.endsWith('test-session.jsonl')) return true
      if (p === globalPath) return true
      return false
    })
    fs.readdirSync.mockImplementation((p) => {
      if (typeof p === 'string' && p === PROJECTS_DIR) return [makeProjectDirEntry('C--project')]
      return []
    })
    fs.readFileSync.mockImplementation((p) => {
      if (typeof p === 'string' && p.endsWith('test-session.jsonl')) return makeSessionJsonl()
      if (p === globalPath) return '# Global instructions'
      return ''
    })
    fs.statSync.mockReturnValue(makeStat())

    const result = getMemoryForSession('test-session')
    expect(result).not.toBeNull()
    expect(result.global).not.toBeNull()
    expect(result.global.content).toBe('# Global instructions')
    expect(result.global.path).toBe(globalPath)
  })

  it('reads project-level CLAUDE.md from cwd', () => {
    const cwd = '/home/user/project'
    const rootClaudeMd = path.join(cwd, 'CLAUDE.md')
    const dotClaudeMd = path.join(cwd, '.claude', 'CLAUDE.md')

    fs.existsSync.mockImplementation((p) => {
      if (p === PROJECTS_DIR) return true
      if (typeof p === 'string' && p.endsWith('test-session.jsonl')) return true
      if (p === rootClaudeMd) return true
      if (p === dotClaudeMd) return true
      return false
    })
    fs.readdirSync.mockImplementation((p) => {
      if (typeof p === 'string' && p === PROJECTS_DIR) return [makeProjectDirEntry('C--project')]
      return []
    })
    fs.readFileSync.mockImplementation((p) => {
      if (typeof p === 'string' && p.endsWith('test-session.jsonl')) {
        return makeSessionJsonl({ cwd })
      }
      if (p === rootClaudeMd) return '# Root project instructions'
      if (p === dotClaudeMd) return '# Dot-claude project instructions'
      return ''
    })
    fs.statSync.mockReturnValue(makeStat())

    const result = getMemoryForSession('test-session')
    expect(result.project).toHaveLength(2)
    expect(result.project[0].content).toBe('# Root project instructions')
    expect(result.project[0].path).toBe(rootClaudeMd)
    expect(result.project[1].content).toBe('# Dot-claude project instructions')
    expect(result.project[1].path).toBe(dotClaudeMd)
  })

  it('parses frontmatter from memory files', () => {
    const memoryDir = path.join(PROJECTS_DIR, 'C--project', 'memory')
    const memFile = path.join(memoryDir, 'note.md')

    const memContent = `---
name: my-note
type: lesson
---
# Lesson learned
Always write tests first.`

    fs.existsSync.mockImplementation((p) => {
      if (p === PROJECTS_DIR) return true
      if (typeof p === 'string' && p.endsWith('test-session.jsonl')) return true
      if (p === memoryDir) return true
      if (p === memFile) return true
      return false
    })
    fs.readdirSync.mockImplementation((p) => {
      if (typeof p === 'string' && p === PROJECTS_DIR) return [makeProjectDirEntry('C--project')]
      if (p === memoryDir) return ['note.md']
      return []
    })
    fs.readFileSync.mockImplementation((p) => {
      if (typeof p === 'string' && p.endsWith('test-session.jsonl')) return makeSessionJsonl()
      if (p === memFile) return memContent
      return ''
    })
    fs.statSync.mockReturnValue(makeStat())

    const result = getMemoryForSession('test-session')
    expect(result.memories).toHaveLength(1)
    expect(result.memories[0].filename).toBe('note.md')
    expect(result.memories[0].frontmatter).toEqual({ name: 'my-note', type: 'lesson' })
    expect(result.memories[0].body).toContain('Always write tests first.')
  })

  it('returns empty memories array when memory dir does not exist', () => {
    fs.existsSync.mockImplementation((p) => {
      if (p === PROJECTS_DIR) return true
      if (typeof p === 'string' && p.endsWith('test-session.jsonl')) return true
      return false
    })
    fs.readdirSync.mockImplementation((p) => {
      if (typeof p === 'string' && p === PROJECTS_DIR) return [makeProjectDirEntry('C--project')]
      return []
    })
    fs.readFileSync.mockImplementation((p) => {
      if (typeof p === 'string' && p.endsWith('test-session.jsonl')) return makeSessionJsonl()
      return ''
    })
    fs.statSync.mockReturnValue(makeStat())

    const result = getMemoryForSession('test-session')
    expect(result.memories).toEqual([])
  })

  it('handles missing session gracefully', () => {
    // Projects dir exists but no matching session file
    fs.existsSync.mockImplementation((p) => {
      if (p === PROJECTS_DIR) return true
      return false
    })
    fs.readdirSync.mockReturnValue([makeProjectDirEntry('C--project')])

    const result = getMemoryForSession('missing-session')
    expect(result).toBeNull()
  })

  it('reads memory index (MEMORY.md) separately from memory files', () => {
    const memoryDir = path.join(PROJECTS_DIR, 'C--project', 'memory')
    const memoryIndexPath = path.join(memoryDir, 'MEMORY.md')

    const noteFilePath = path.join(memoryDir, 'note.md')

    fs.existsSync.mockImplementation((p) => {
      if (p === PROJECTS_DIR) return true
      if (typeof p === 'string' && p.endsWith('test-session.jsonl')) return true
      if (p === memoryDir) return true
      if (p === memoryIndexPath) return true
      if (p === noteFilePath) return true
      return false
    })
    fs.readdirSync.mockImplementation((p) => {
      if (typeof p === 'string' && p === PROJECTS_DIR) return [makeProjectDirEntry('C--project')]
      if (p === memoryDir) return ['MEMORY.md', 'note.md']
      return []
    })
    fs.readFileSync.mockImplementation((p) => {
      if (typeof p === 'string' && p.endsWith('test-session.jsonl')) return makeSessionJsonl()
      if (p === memoryIndexPath) return '# Memory Index\n- note.md'
      if (p === path.join(memoryDir, 'note.md')) return '# A note'
      return ''
    })
    fs.statSync.mockReturnValue(makeStat())

    const result = getMemoryForSession('test-session')
    // MEMORY.md should be in memoryIndex, not in memories array
    expect(result.memoryIndex).not.toBeNull()
    expect(result.memoryIndex.content).toBe('# Memory Index\n- note.md')
    expect(result.memories).toHaveLength(1)
    expect(result.memories[0].filename).toBe('note.md')
  })

  it('returns null global and empty project when CLAUDE.md files do not exist', () => {
    fs.existsSync.mockImplementation((p) => {
      if (p === PROJECTS_DIR) return true
      if (typeof p === 'string' && p.endsWith('test-session.jsonl')) return true
      return false
    })
    fs.readdirSync.mockImplementation((p) => {
      if (typeof p === 'string' && p === PROJECTS_DIR) return [makeProjectDirEntry('C--project')]
      return []
    })
    fs.readFileSync.mockImplementation((p) => {
      if (typeof p === 'string' && p.endsWith('test-session.jsonl')) return makeSessionJsonl()
      return ''
    })
    fs.statSync.mockReturnValue(makeStat())

    const result = getMemoryForSession('test-session')
    expect(result.global).toBeNull()
    expect(result.project).toEqual([])
  })
})
