vi.mock('fs', () => {
  return {
    default: {
      existsSync: vi.fn(),
      readdirSync: vi.fn(),
      readFileSync: vi.fn(),
      statSync: vi.fn(),
    },
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    statSync: vi.fn(),
  }
})

vi.mock('../../sse.js', () => ({
  emit: vi.fn(),
}))

import fs from 'fs'
import { getHooksConfig } from '../../parsers/hooks.js'
import { emit } from '../../sse.js'
import { _resetDegradedDedupe } from '../../lib/claude-format.js'

beforeEach(() => {
  vi.resetAllMocks()
  _resetDegradedDedupe()
})

describe('getHooksConfig()', () => {
  it('returns empty when no settings or hooks dir exist', () => {
    fs.existsSync.mockReturnValue(false)
    const result = getHooksConfig()
    expect(result.config).toEqual({})
    expect(result.scripts).toEqual([])
    expect(result.matrix).toEqual([])
    expect(result.degraded).toBeFalsy()
    expect(emit).not.toHaveBeenCalled()
  })

  it('flags degraded (NOT "no hooks") when settings.json is present but unparseable', () => {
    // A broken settings.json must never render as "no guardrails active" when
    // the hooks may in fact be enforced. Surface a degraded flag + persistent
    // parser_degraded SSE event, distinct from the legitimately-empty case.
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockImplementation((p) => {
      if (typeof p === 'string' && p.endsWith('settings.json')) return '{not valid json!!'
      return ''
    })
    fs.readdirSync.mockReturnValue([])
    const result = getHooksConfig()
    expect(result.degraded).toBe(true)
    expect(emit).toHaveBeenCalledWith(
      'parser_degraded',
      expect.objectContaining({ parser: 'hooks' }),
    )
  })

  it('reads hooks config from settings.json', () => {
    const settings = {
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bash guard.sh' }] }],
      },
    }
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(JSON.stringify(settings))

    const result = getHooksConfig()
    expect(result.config).toEqual(settings.hooks)
    expect(result.matrix).toHaveLength(1)
    expect(result.matrix[0]).toEqual({
      event: 'PreToolUse',
      matcher: 'Bash',
      type: 'command',
      command: 'bash guard.sh',
    })
  })

  it('builds matrix with multiple events and matchers', () => {
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              { type: 'command', command: 'bash pre-bash.sh' },
              { type: 'command', command: 'bash pre-commit.sh' },
            ],
          },
        ],
        PostToolUse: [
          { matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'bash post-edit.sh' }] },
        ],
      },
    }
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(JSON.stringify(settings))

    const result = getHooksConfig()
    expect(result.matrix).toHaveLength(3)
    expect(result.matrix[0].event).toBe('PreToolUse')
    expect(result.matrix[2].event).toBe('PostToolUse')
    expect(result.matrix[2].matcher).toBe('Edit|Write')
  })

  it('reads hook script files from hooks dir', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockImplementation((p) => {
      if (typeof p === 'string' && p.endsWith('settings.json')) return '{}'
      return '#!/bin/bash\necho "hook"'
    })
    fs.readdirSync.mockReturnValue(['guard.sh', 'test.sh', 'readme.txt'])
    fs.statSync.mockReturnValue({ mtimeMs: 1000, size: 42 })

    const result = getHooksConfig()
    expect(result.scripts).toHaveLength(2) // .txt excluded
    expect(result.scripts[0].filename).toBe('guard.sh')
    expect(result.scripts[0].content).toContain('echo "hook"')
  })

  it('returns empty scripts when hooks dir does not exist', () => {
    fs.existsSync.mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('hooks')) return false
      return true
    })
    fs.readFileSync.mockReturnValue('{}')

    const result = getHooksConfig()
    expect(result.scripts).toEqual([])
  })
})
