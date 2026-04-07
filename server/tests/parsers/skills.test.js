vi.mock('fs', () => {
  const promises = {
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    unlink: vi.fn(),
  }
  return {
    default: { existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn(), promises },
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    promises,
  }
})

import fs from 'fs'
import { getAllSkills } from '../../parsers/skills.js'

beforeEach(() => {
  vi.resetAllMocks()
})

// Helper: make existsSync return false for everything by default
function noFiles() {
  fs.existsSync.mockReturnValue(false)
}

describe('getAllSkills()', () => {
  it('returns empty skills when user skills dir and plugin config are missing', () => {
    noFiles()
    const result = getAllSkills()
    expect(result.userSkills).toEqual([])
    expect(result.plugins).toEqual([])
    expect(result.totalSkillCount).toBe(0)
  })

  it('returns empty skills when user skills dir does not exist', () => {
    // existsSync returns false for everything
    noFiles()
    const result = getAllSkills()
    expect(result.userSkills).toHaveLength(0)
    expect(result.totalSkillCount).toBe(0)
  })

  it('parses user skill files from the skills dir', () => {
    const skillContent = `---\nname: my-skill\ndescription: Does something useful\n---\nDo the thing.`

    fs.existsSync.mockImplementation((p) => {
      // userSkillsDir exists, settings/installed do not
      if (p.endsWith('skills')) return true
      return false
    })
    fs.readdirSync.mockReturnValue(['my-skill.md'])
    fs.readFileSync.mockReturnValue(skillContent)

    const result = getAllSkills()
    expect(result.userSkills).toHaveLength(1)
    expect(result.userSkills[0].name).toBe('my-skill')
    expect(result.userSkills[0].description).toBe('Does something useful')
    expect(result.userSkills[0].source).toBe('user')
    expect(result.userSkills[0].command).toBe('/my-skill')
    expect(result.totalSkillCount).toBe(1)
  })

  it('uses filename (without .md) as name when frontmatter has no name', () => {
    const skillContent = `---\ndescription: No name here\n---\nBody text.`

    fs.existsSync.mockImplementation((p) => {
      if (p.endsWith('skills')) return true
      return false
    })
    fs.readdirSync.mockReturnValue(['unnamed-skill.md'])
    fs.readFileSync.mockReturnValue(skillContent)

    const result = getAllSkills()
    expect(result.userSkills[0].name).toBe('unnamed-skill')
    expect(result.userSkills[0].command).toBe('/unnamed-skill')
  })

  it('handles argument-hint and argumentHint frontmatter fields', () => {
    const skillContent = `---\nname: my-skill\nargument-hint: <some-arg>\n---\nBody.`

    fs.existsSync.mockImplementation((p) => {
      if (p.endsWith('skills')) return true
      return false
    })
    fs.readdirSync.mockReturnValue(['my-skill.md'])
    fs.readFileSync.mockReturnValue(skillContent)

    const result = getAllSkills()
    expect(result.userSkills[0].argumentHint).toBe('<some-arg>')
  })

  it('ignores non-.md files in user skills dir', () => {
    fs.existsSync.mockImplementation((p) => {
      if (p.endsWith('skills')) return true
      return false
    })
    fs.readdirSync.mockReturnValue(['README.txt', 'notes.json'])
    // readFileSync should not be called since no .md files
    fs.readFileSync.mockReturnValue('')

    const result = getAllSkills()
    expect(result.userSkills).toHaveLength(0)
    expect(result.totalSkillCount).toBe(0)
  })

  it('skips skill files that throw on read', () => {
    fs.existsSync.mockImplementation((p) => {
      if (p.endsWith('skills')) return true
      return false
    })
    fs.readdirSync.mockReturnValue(['broken.md'])
    fs.readFileSync.mockImplementation(() => {
      throw new Error('cannot read')
    })

    const result = getAllSkills()
    expect(result.userSkills).toHaveLength(0)
  })

  it('returns plugins when settings and installed_plugins exist', () => {
    const settings = JSON.stringify({ enabledPlugins: { 'myplugin@1.0.0': true } })
    const installed = JSON.stringify({
      plugins: {
        'myplugin@1.0.0': [{ installPath: '/fake/myplugin' }],
      },
    })
    const pluginJson = JSON.stringify({
      name: 'My Plugin',
      description: 'A plugin',
      version: '1.0.0',
      author: 'Author',
    })
    const skillContent = `---\nname: plugin-skill\ndescription: Plugin skill\n---\nDo it.`

    // Dirent mock for skills subdir
    const fakeSubdir = { name: 'skill1', isDirectory: () => true }

    fs.existsSync.mockImplementation((p) => {
      if (p.endsWith('skills') && !p.includes('myplugin')) return false // user skills dir absent
      if (p.includes('settings.json')) return true
      if (p.includes('installed_plugins.json')) return true
      if (p.includes('skills') && p.includes('myplugin')) return true // plugin skills dir
      if (p.includes('SKILL.md')) return true
      return false
    })

    fs.readdirSync.mockImplementation((p, opts) => {
      if (p.includes('skills') && p.includes('myplugin')) {
        return opts?.withFileTypes ? [fakeSubdir] : [fakeSubdir]
      }
      return []
    })

    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('settings.json')) return settings
      if (p.includes('installed_plugins.json')) return installed
      if (p.includes('.claude-plugin')) return pluginJson
      if (p.includes('SKILL.md')) return skillContent
      return ''
    })

    const result = getAllSkills()
    expect(result.plugins).toHaveLength(1)
    expect(result.plugins[0].key).toBe('myplugin@1.0.0')
    expect(result.plugins[0].skills).toHaveLength(1)
    expect(result.plugins[0].skills[0].source).toBe('plugin')
    expect(result.totalSkillCount).toBe(1)
  })

  it('skips disabled plugins', () => {
    const settings = JSON.stringify({ enabledPlugins: { 'disabled-plugin@1.0.0': false } })
    const installed = JSON.stringify({
      plugins: { 'disabled-plugin@1.0.0': [{ installPath: '/fake/disabled' }] },
    })

    fs.existsSync.mockImplementation((p) => {
      if (p.includes('settings.json')) return true
      if (p.includes('installed_plugins.json')) return true
      return false
    })
    fs.readdirSync.mockReturnValue([])
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('settings.json')) return settings
      if (p.includes('installed_plugins.json')) return installed
      return ''
    })

    const result = getAllSkills()
    expect(result.plugins).toHaveLength(0)
  })
})
