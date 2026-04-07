vi.mock('fs', () => {
  const promises = {
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    unlink: vi.fn(),
    readdir: vi.fn(),
    rmdir: vi.fn(),
    // rename is required by lib/atomic-write.js (writeFile-then-rename pattern).
    rename: vi.fn(),
  }
  return {
    default: { existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn(), promises },
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    promises,
  }
})
vi.mock('../../parsers/skills.js', () => ({
  getAllSkills: vi.fn().mockReturnValue({ userSkills: [], plugins: [], totalSkillCount: 0 }),
}))

import express from 'express'
import request from 'supertest'
import { promises as fsp } from 'fs'
import { getAllSkills } from '../../parsers/skills.js'
import { router } from '../../routes/skills.js'

const app = express()
app.use(express.json())
app.use('/', router)

beforeEach(() => {
  vi.resetAllMocks()
  // atomic-write.rename must succeed by default or every write path is 500
  fsp.rename.mockResolvedValue(undefined)
})

// ─── GET / ──────────────────────────────────────────────────────────────────

describe('GET /', () => {
  it('returns getAllSkills() result', async () => {
    const mockData = { userSkills: [{ name: 'myfoo' }], plugins: [], totalSkillCount: 1 }
    getAllSkills.mockReturnValue(mockData)
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(mockData)
  })
})

// ─── GET /:name/raw ──────────────────────────────────────────────────────────

describe('GET /:name/raw', () => {
  it('404 when skill not found', async () => {
    // The route now uses resolveSkillPath which probes both
    //   ~/.claude/skills/<name>/SKILL.md  (subdir layout)
    //   ~/.claude/skills/<name>.md        (flat layout)
    // via fs.access. If both reject, resolveSkillPath returns null and the
    // route emits 404. Mock access to fail so we exercise that path.
    const err = new Error('not found')
    err.code = 'ENOENT'
    fsp.access.mockRejectedValue(err)
    const res = await request(app).get('/missing/raw')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/skill not found/i)
  })

  it('200 returns text/plain content', async () => {
    fsp.access.mockResolvedValue(undefined) // resolveSkillPath finds the file
    fsp.readFile.mockResolvedValue('# My Skill\nDo the thing.')
    const res = await request(app).get('/myskill/raw')
    expect(res.status).toBe(200)
    expect(res.type).toMatch(/text/)
    expect(res.text).toContain('# My Skill')
  })

  it('colons in skill names are now rejected (Windows file basenames)', async () => {
    // Skill names previously allowed colons for namespaced plugin skills,
    // but ':' is reserved on Windows and the writable path now matches
    // Claude Code's stricter rules. Verify the validator rejects them.
    const res = await request(app).get('/my:skill/raw')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid skill name/i)
  })
})

// ─── POST / ─────────────────────────────────────────────────────────────────

describe('POST /', () => {
  it('400 when name is missing', async () => {
    const res = await request(app).post('/').send({ content: 'some content' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/name is required/i)
  })

  it('400 when name is invalid (contains space)', async () => {
    const res = await request(app).post('/').send({ name: 'my skill', content: 'content' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid skill name/i)
  })

  it('400 when content is missing', async () => {
    const res = await request(app).post('/').send({ name: 'valid-skill' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/content is required/i)
  })

  it('409 when skill already exists', async () => {
    fsp.access.mockResolvedValue(undefined) // file exists
    const res = await request(app).post('/').send({ name: 'existing', content: '# Skill' })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/already exists/i)
  })

  it('201 on success', async () => {
    fsp.access.mockRejectedValue({ code: 'ENOENT' })
    fsp.mkdir.mockResolvedValue(undefined)
    fsp.writeFile.mockResolvedValue(undefined)
    const res = await request(app).post('/').send({ name: 'newskill', content: '# New Skill' })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ ok: true, name: 'newskill' })
  })

  it('400 when name uses colons (no longer accepted on the writable path)', async () => {
    const res = await request(app).post('/').send({ name: 'my:skill', content: '# Colon Skill' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid skill name/i)
  })
})

// ─── PUT /:name ──────────────────────────────────────────────────────────────

describe('PUT /:name', () => {
  it('400 when name is invalid', async () => {
    const res = await request(app).put('/bad name').send({ content: 'x' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid skill name/i)
  })

  it('404 when skill not found', async () => {
    fsp.access.mockRejectedValue({ code: 'ENOENT' })
    const res = await request(app).put('/missing').send({ content: 'new content' })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/skill not found/i)
  })

  it('200 on success', async () => {
    fsp.access.mockResolvedValue(undefined)
    fsp.writeFile.mockResolvedValue(undefined)
    const res = await request(app).put('/myskill').send({ content: 'updated content' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, name: 'myskill' })
  })
})

// ─── DELETE /:name ───────────────────────────────────────────────────────────

describe('DELETE /:name', () => {
  it('400 when name is invalid', async () => {
    const res = await request(app).delete('/bad name')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid skill name/i)
  })

  it('404 when skill not found', async () => {
    const err = new Error('not found')
    err.code = 'ENOENT'
    fsp.unlink.mockRejectedValue(err)
    const res = await request(app).delete('/missing')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/skill not found/i)
  })

  it('200 on success', async () => {
    fsp.unlink.mockResolvedValue(undefined)
    const res = await request(app).delete('/myskill')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, name: 'myskill' })
  })
})
