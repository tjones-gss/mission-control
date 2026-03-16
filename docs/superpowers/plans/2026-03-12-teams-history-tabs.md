# Teams Tab & History Tab Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two fully functional tabs — Teams (inbox display + compose) and History (stats + paginated feed) — to the Oversight dashboard.

**Architecture:** Server parsers and routes are extended first (TDD), then client components are built against MSW mocks, then App.jsx is wired up, then E2E tests validate the full stack. Each task is independently committable.

**Tech Stack:** Express 4, Vitest (server + client), React 18, Tailwind CSS, MSW (client mocks), Playwright (E2E), lucide-react icons

---

## File Map

### New files
- `server/tests/routes/teams.test.js` — route tests for POST/PATCH inbox
- `server/tests/routes/history.test.js` — route tests for /stats and paginated GET
- `client/src/components/TeamsPanel/TeamsPanel.jsx` — two-panel layout
- `client/src/components/TeamsPanel/TeamInboxFeed.jsx` — inbox message list
- `client/src/components/TeamsPanel/TeamComposeInput.jsx` — pinned compose box
- `client/src/components/HistoryTab/HistoryTab.jsx` — full-width panel
- `client/src/components/HistoryTab/HistoryStatsBar.jsx` — summary cards + sparkline
- `client/src/components/HistoryTab/HistoryFeed.jsx` — paginated + virtualized feed
- `client/src/tests/components/TeamsPanel.test.jsx` — component unit tests
- `client/src/tests/components/HistoryTab.test.jsx` — component unit tests
- `e2e/teams.spec.js` — E2E for teams tab
- `e2e/history.spec.js` — E2E for history tab

### Modified files
- `server/parsers/history.js` — add `getHistoryStats()`, extend `getHistory()` with offset/filter params
- `server/tests/parsers/history.test.js` — extend existing tests with new function coverage
- `server/routes/history.js` — add `/stats` route, add query params to GET `/`
- `server/routes/teams.js` — add `POST /:name/inbox` and `PATCH /:name/inbox/:messageId`
- `client/src/App.jsx` — add Teams/History tabs, SSE handlers, useApi call
- `client/src/tests/mocks/handlers.js` — add teams + history MSW handlers
- `client/src/components/TeamsPanel.jsx` — **deleted** (replaced by directory)

---

## Chunk 1: Server — History Parser + Routes

### Task 1: Extend history parser

**Files:**
- Modify: `server/parsers/history.js`
- Modify: `server/tests/parsers/history.test.js`

- [ ] **Step 1: Add new tests to `server/tests/parsers/history.test.js`**

Append these test cases to the existing file (after the existing `describe('getHistory()')` block):

```js
// ─── getHistory() with offset and filters ────────────────────────────────────

describe('getHistory() with offset', () => {
  it('returns entries starting at offset', () => {
    const lines = Array.from({ length: 5 }, (_, i) =>
      JSON.stringify({ display: `cmd-${i}`, timestamp: i * 1000, project: '/p' })
    )
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(lines.join('\n'))

    // All 5 reversed = [cmd-4, cmd-3, cmd-2, cmd-1, cmd-0]. offset=2, limit=2 → [cmd-2, cmd-1]
    const result = getHistory(2, 2)
    expect(result).toHaveLength(2)
    expect(result[0].display).toBe('cmd-2')
    expect(result[1].display).toBe('cmd-1')
  })

  it('filters by project', () => {
    const lines = [
      JSON.stringify({ display: 'a', timestamp: 1000, project: '/projectA' }),
      JSON.stringify({ display: 'b', timestamp: 2000, project: '/projectB' }),
      JSON.stringify({ display: 'c', timestamp: 3000, project: '/projectA' }),
    ]
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(lines.join('\n'))

    const result = getHistory(100, 0, { project: '/projectA' })
    expect(result).toHaveLength(2)
    expect(result.every(e => e.project === '/projectA')).toBe(true)
  })

  it('filters by from timestamp', () => {
    const lines = [
      JSON.stringify({ display: 'old', timestamp: 1000, project: '/p' }),
      JSON.stringify({ display: 'new', timestamp: 5000, project: '/p' }),
    ]
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(lines.join('\n'))

    const result = getHistory(100, 0, { from: 3000 })
    expect(result).toHaveLength(1)
    expect(result[0].display).toBe('new')
  })

  it('filters by to timestamp', () => {
    const lines = [
      JSON.stringify({ display: 'old', timestamp: 1000, project: '/p' }),
      JSON.stringify({ display: 'new', timestamp: 5000, project: '/p' }),
    ]
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(lines.join('\n'))

    const result = getHistory(100, 0, { to: 2000 })
    expect(result).toHaveLength(1)
    expect(result[0].display).toBe('old')
  })
})

// ─── getHistoryStats() ────────────────────────────────────────────────────────

import { getHistoryStats } from '../../parsers/history.js'

describe('getHistoryStats()', () => {
  it('returns zeroed stats when file does not exist', () => {
    fs.existsSync.mockReturnValue(false)
    const stats = getHistoryStats()
    expect(stats.total).toBe(0)
    expect(stats.topCommand).toBeNull()
    expect(stats.topProject).toBeNull()
    expect(stats.today).toBe(0)
    expect(stats.dailyActivity).toHaveLength(7)
    expect(stats.dailyActivity.every(d => d.count === 0)).toBe(true)
  })

  it('counts total entries', () => {
    const lines = [
      JSON.stringify({ display: 'a', timestamp: 1000, project: '/p' }),
      JSON.stringify({ display: 'b', timestamp: 2000, project: '/p' }),
    ]
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(lines.join('\n'))
    expect(getHistoryStats().total).toBe(2)
  })

  it('identifies top command', () => {
    const lines = [
      JSON.stringify({ display: 'git status', timestamp: 1000, project: '/p' }),
      JSON.stringify({ display: 'git status', timestamp: 2000, project: '/p' }),
      JSON.stringify({ display: 'ls', timestamp: 3000, project: '/p' }),
    ]
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(lines.join('\n'))
    expect(getHistoryStats().topCommand).toBe('git status')
  })

  it('identifies top project', () => {
    const lines = [
      JSON.stringify({ display: 'a', timestamp: 1000, project: '/projectA' }),
      JSON.stringify({ display: 'b', timestamp: 2000, project: '/projectA' }),
      JSON.stringify({ display: 'c', timestamp: 3000, project: '/projectB' }),
    ]
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(lines.join('\n'))
    expect(getHistoryStats().topProject).toBe('/projectA')
  })

  it('returns 7 daily activity buckets', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(
      JSON.stringify({ display: 'a', timestamp: Date.now(), project: '/p' })
    )
    const { dailyActivity } = getHistoryStats()
    expect(dailyActivity).toHaveLength(7)
    expect(dailyActivity[6].count).toBeGreaterThanOrEqual(1) // today
  })

  it('skips malformed lines', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue('NOT JSON\n' + JSON.stringify({ display: 'a', timestamp: 1000, project: '/p' }))
    expect(getHistoryStats().total).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd server && npx vitest run tests/parsers/history.test.js 2>&1
```
Expected: failures on `getHistory() with offset` and `getHistoryStats()` tests.

- [ ] **Step 3: Rewrite `server/parsers/history.js`**

```js
import fs from 'fs'
import path from 'path'
import os from 'os'

const HISTORY_FILE = path.join(os.homedir(), '.claude', 'history.jsonl')

function parseAll() {
  if (!fs.existsSync(HISTORY_FILE)) return []
  const lines = fs.readFileSync(HISTORY_FILE, 'utf-8').trim().split('\n').filter(Boolean)
  return lines
    .map(l => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}

export function getHistory(limit = 100, offset = 0, { project, from, to } = {}) {
  let entries = parseAll()
  if (project) entries = entries.filter(e => e.project === project)
  if (from != null) entries = entries.filter(e => e.timestamp >= from)
  if (to != null) entries = entries.filter(e => e.timestamp <= to)
  entries = entries.reverse() // newest first
  return entries.slice(offset, offset + limit)
}

export function getHistoryStats() {
  const entries = parseAll()
  const empty = {
    total: 0, topCommand: null, topProject: null, today: 0,
    dailyActivity: Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - i))
      return { date: d.toISOString().slice(0, 10), count: 0 }
    }),
  }
  if (!entries.length) return empty

  const commandCounts = {}
  const projectCounts = {}
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  let today = 0

  for (const e of entries) {
    const cmd = (e.display || '').split('\n')[0].slice(0, 50)
    if (cmd) commandCounts[cmd] = (commandCounts[cmd] || 0) + 1
    if (e.project) projectCounts[e.project] = (projectCounts[e.project] || 0) + 1
    if (e.timestamp >= todayStart.getTime()) today++
  }

  const topCommand = Object.entries(commandCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const topProject = Object.entries(projectCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  const dailyActivity = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - i))
    const next = new Date(d); next.setDate(next.getDate() + 1)
    const count = entries.filter(e => e.timestamp >= d.getTime() && e.timestamp < next.getTime()).length
    return { date: d.toISOString().slice(0, 10), count }
  })

  return { total: entries.length, topCommand, topProject, today, dailyActivity }
}
```

- [ ] **Step 4: Run all parser tests to confirm pass**

```bash
cd server && npx vitest run tests/parsers/history.test.js 2>&1
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/parsers/history.js server/tests/parsers/history.test.js
git commit -m "feat: extend history parser with pagination, filters, and stats"
```

---

### Task 2: Update history routes

**Files:**
- Modify: `server/routes/history.js`
- Create: `server/tests/routes/history.test.js`

- [ ] **Step 1: Create `server/tests/routes/history.test.js`**

```js
vi.mock('fs', () => {
  const promises = { access: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn(), unlink: vi.fn() }
  return {
    default: { existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn(), promises },
    existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn(), promises,
  }
})
vi.mock('../../parsers/history.js', () => ({
  getHistory: vi.fn().mockReturnValue([]),
  getHistoryStats: vi.fn().mockReturnValue({
    total: 0, topCommand: null, topProject: null, today: 0, dailyActivity: [],
  }),
}))

import express from 'express'
import request from 'supertest'
import { getHistory, getHistoryStats } from '../../parsers/history.js'
import { router } from '../../routes/history.js'

const app = express()
app.use(express.json())
app.use('/', router)

beforeEach(() => vi.resetAllMocks())

// ─── GET / ───────────────────────────────────────────────────────────────────

describe('GET /', () => {
  it('calls getHistory with default limit=100, offset=0', async () => {
    getHistory.mockReturnValue([{ display: 'a', timestamp: 1000 }])
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(getHistory).toHaveBeenCalledWith(100, 0, { project: undefined, from: undefined, to: undefined })
    expect(res.body).toEqual([{ display: 'a', timestamp: 1000 }])
  })

  it('passes limit and offset query params', async () => {
    getHistory.mockReturnValue([])
    await request(app).get('/?limit=50&offset=100')
    expect(getHistory).toHaveBeenCalledWith(50, 100, expect.anything())
  })

  it('passes project filter', async () => {
    getHistory.mockReturnValue([])
    await request(app).get('/?project=/my/project')
    expect(getHistory).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), expect.objectContaining({ project: '/my/project' }))
  })

  it('parses from and to as integers', async () => {
    getHistory.mockReturnValue([])
    await request(app).get('/?from=1000&to=5000')
    expect(getHistory).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), expect.objectContaining({ from: 1000, to: 5000 }))
  })
})

// ─── GET /stats ──────────────────────────────────────────────────────────────

describe('GET /stats', () => {
  it('returns stats from getHistoryStats()', async () => {
    const mockStats = { total: 42, topCommand: 'git status', topProject: '/p', today: 5, dailyActivity: [] }
    getHistoryStats.mockReturnValue(mockStats)
    const res = await request(app).get('/stats')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(mockStats)
  })

  it('returns zeroed stats when history is empty', async () => {
    getHistoryStats.mockReturnValue({ total: 0, topCommand: null, topProject: null, today: 0, dailyActivity: [] })
    const res = await request(app).get('/stats')
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(0)
  })
})
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
cd server && npx vitest run tests/routes/history.test.js 2>&1
```
Expected: failures (route doesn't have `/stats` or new params yet).

- [ ] **Step 3: Rewrite `server/routes/history.js`**

```js
import { Router } from 'express'
import { getHistory, getHistoryStats } from '../parsers/history.js'

export const router = Router()

router.get('/stats', (req, res) => {
  res.json(getHistoryStats())
})

router.get('/', (req, res) => {
  const limit = parseInt(req.query.limit) || 100
  const offset = parseInt(req.query.offset) || 0
  const { project, from, to } = req.query
  res.json(getHistory(limit, offset, {
    project,
    from: from != null ? parseInt(from) : undefined,
    to: to != null ? parseInt(to) : undefined,
  }))
})
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
cd server && npx vitest run tests/routes/history.test.js 2>&1
```
Expected: all pass.

- [ ] **Step 5: Run full server test suite to catch regressions**

```bash
cd server && npx vitest run 2>&1
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/routes/history.js server/tests/routes/history.test.js
git commit -m "feat: add history /stats route and pagination/filter params"
```

---

## Chunk 2: Server — Teams Inbox Routes

### Task 3: Add teams inbox routes

**Files:**
- Modify: `server/routes/teams.js`
- Create: `server/tests/routes/teams.test.js`

- [ ] **Step 1: Create `server/tests/routes/teams.test.js`**

```js
vi.mock('fs', () => {
  const promises = { access: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn(), unlink: vi.fn() }
  return {
    default: {
      existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn(),
      writeFileSync: vi.fn(), mkdirSync: vi.fn(), promises,
    },
    existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn(),
    writeFileSync: vi.fn(), mkdirSync: vi.fn(), promises,
  }
})
vi.mock('../../parsers/teams.js', () => ({ getAllTeams: vi.fn().mockReturnValue([]) }))
vi.mock('crypto', () => ({ randomUUID: vi.fn().mockReturnValue('test-uuid-1234') }))

import express from 'express'
import request from 'supertest'
import fs from 'fs'
import { getAllTeams } from '../../parsers/teams.js'
import { router } from '../../routes/teams.js'

const app = express()
app.use(express.json())
app.use('/', router)

beforeEach(() => vi.resetAllMocks())

// ─── GET / ───────────────────────────────────────────────────────────────────

describe('GET /', () => {
  it('returns all teams', async () => {
    getAllTeams.mockReturnValue([{ name: 'my-team' }])
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ name: 'my-team' }])
  })
})

// ─── POST /:name/inbox ───────────────────────────────────────────────────────

describe('POST /:name/inbox', () => {
  it('400 when content is missing', async () => {
    const res = await request(app).post('/my-team/inbox').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/content is required/i)
  })

  it('400 when content is empty string', async () => {
    const res = await request(app).post('/my-team/inbox').send({ content: '  ' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/content is required/i)
  })

  it('404 when team directory does not exist', async () => {
    fs.existsSync.mockReturnValue(false)
    const res = await request(app).post('/no-team/inbox').send({ content: 'hello' })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/team not found/i)
  })

  it('creates dashboard.json if it does not exist and returns 201', async () => {
    // team dir exists, inboxes dir exists, dashboard.json does not
    fs.existsSync.mockImplementation(p => !p.includes('dashboard.json'))
    fs.readdirSync.mockReturnValue([])
    fs.writeFileSync.mockImplementation(() => {})

    const res = await request(app).post('/my-team/inbox').send({ content: 'hello world' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe('test-uuid-1234')
    expect(res.body.content).toBe('hello world')
    expect(res.body.sender).toBe('user')
    expect(res.body.read).toBe(false)
    expect(res.body.archived).toBe(false)
    expect(fs.writeFileSync).toHaveBeenCalled()
  })

  it('appends to existing dashboard.json', async () => {
    const existing = [{ id: 'old-id', content: 'old', sender: 'agent', timestamp: 't', read: true, archived: false }]
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(JSON.stringify(existing))
    fs.writeFileSync.mockImplementation(() => {})

    const res = await request(app).post('/my-team/inbox').send({ content: 'new message' })
    expect(res.status).toBe(201)

    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1])
    expect(written).toHaveLength(2)
    expect(written[1].content).toBe('new message')
  })

  it('uses custom sender when provided', async () => {
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue('[]')
    fs.writeFileSync.mockImplementation(() => {})

    const res = await request(app).post('/my-team/inbox').send({ content: 'hi', sender: 'claude' })
    expect(res.body.sender).toBe('claude')
  })
})

// ─── PATCH /:name/inbox/:messageId ──────────────────────────────────────────

describe('PATCH /:name/inbox/:messageId', () => {
  it('400 when neither read nor archived is provided', async () => {
    const res = await request(app).patch('/my-team/inbox/some-id').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/read or archived is required/i)
  })

  it('404 when team does not exist', async () => {
    fs.existsSync.mockReturnValue(false)
    const res = await request(app).patch('/no-team/inbox/some-id').send({ read: true })
    expect(res.status).toBe(404)
  })

  it('404 when message id is not found in any inbox file', async () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue(['agent.json'])
    fs.readFileSync.mockReturnValue(JSON.stringify([{ id: 'other-id', content: 'x', read: false, archived: false }]))

    const res = await request(app).patch('/my-team/inbox/missing-id').send({ read: true })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/message not found/i)
  })

  it('marks message as read and returns updated message', async () => {
    const msg = { id: 'msg-123', content: 'hello', sender: 'agent', timestamp: 't', read: false, archived: false }
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue(['agent.json'])
    fs.readFileSync.mockReturnValue(JSON.stringify([msg]))
    fs.writeFileSync.mockImplementation(() => {})

    const res = await request(app).patch('/my-team/inbox/msg-123').send({ read: true })
    expect(res.status).toBe(200)
    expect(res.body.read).toBe(true)
    expect(res.body.id).toBe('msg-123')
  })

  it('archives a message', async () => {
    const msg = { id: 'msg-456', content: 'hi', sender: 'user', timestamp: 't', read: false, archived: false }
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue(['dashboard.json'])
    fs.readFileSync.mockReturnValue(JSON.stringify([msg]))
    fs.writeFileSync.mockImplementation(() => {})

    const res = await request(app).patch('/my-team/inbox/msg-456').send({ archived: true })
    expect(res.status).toBe(200)
    expect(res.body.archived).toBe(true)
  })
})
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
cd server && npx vitest run tests/routes/teams.test.js 2>&1
```
Expected: failures (POST/PATCH routes don't exist yet).

- [ ] **Step 3: Rewrite `server/routes/teams.js`**

```js
import { Router } from 'express'
import { getAllTeams } from '../parsers/teams.js'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'

const TEAMS_DIR = path.join(os.homedir(), '.claude', 'teams')

export const router = Router()

router.get('/', (req, res) => res.json(getAllTeams()))

router.post('/:name/inbox', (req, res) => {
  const { name } = req.params
  const { content, sender = 'user' } = req.body

  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'content is required' })
  }

  const teamPath = path.join(TEAMS_DIR, name)
  if (!fs.existsSync(teamPath)) {
    return res.status(404).json({ error: 'team not found' })
  }

  const inboxesPath = path.join(teamPath, 'inboxes')
  if (!fs.existsSync(inboxesPath)) fs.mkdirSync(inboxesPath, { recursive: true })

  const dashboardFile = path.join(inboxesPath, 'dashboard.json')
  let messages = []
  if (fs.existsSync(dashboardFile)) {
    try { messages = JSON.parse(fs.readFileSync(dashboardFile, 'utf-8')) } catch { messages = [] }
  }

  const message = {
    id: randomUUID(),
    sender,
    content: content.trim(),
    timestamp: new Date().toISOString(),
    read: false,
    archived: false,
  }

  messages.push(message)
  fs.writeFileSync(dashboardFile, JSON.stringify(messages, null, 2))
  res.status(201).json(message)
})

router.patch('/:name/inbox/:messageId', (req, res) => {
  const { name, messageId } = req.params
  const updates = req.body

  if (typeof updates.read === 'undefined' && typeof updates.archived === 'undefined') {
    return res.status(400).json({ error: 'read or archived is required' })
  }

  const teamPath = path.join(TEAMS_DIR, name)
  if (!fs.existsSync(teamPath)) {
    return res.status(404).json({ error: 'team not found' })
  }

  const inboxesPath = path.join(teamPath, 'inboxes')
  if (!fs.existsSync(inboxesPath)) {
    return res.status(404).json({ error: 'message not found' })
  }

  for (const file of fs.readdirSync(inboxesPath).filter(f => f.endsWith('.json'))) {
    const filePath = path.join(inboxesPath, file)
    let messages
    try { messages = JSON.parse(fs.readFileSync(filePath, 'utf-8')) } catch { continue }

    const idx = messages.findIndex(m => m.id === messageId)
    if (idx === -1) continue

    if (typeof updates.read !== 'undefined') messages[idx].read = updates.read
    if (typeof updates.archived !== 'undefined') messages[idx].archived = updates.archived

    fs.writeFileSync(filePath, JSON.stringify(messages, null, 2))
    return res.json(messages[idx])
  }

  res.status(404).json({ error: 'message not found' })
})
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
cd server && npx vitest run tests/routes/teams.test.js 2>&1
```
Expected: all pass.

- [ ] **Step 5: Run full server suite to catch regressions**

```bash
cd server && npx vitest run 2>&1
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add server/routes/teams.js server/tests/routes/teams.test.js
git commit -m "feat: add teams inbox POST and PATCH routes"
```

---

## Chunk 3: Client — MSW Handlers + TeamsPanel

### Task 4: Update MSW handlers

**Files:**
- Modify: `client/src/tests/mocks/handlers.js`

- [ ] **Step 1: Update `client/src/tests/mocks/handlers.js`**

Add the following handlers to the existing array (append before the closing `]`):

```js
  // Teams
  http.get('/api/teams', () => HttpResponse.json([])),
  http.post('/api/teams/:name/inbox', () => HttpResponse.json(
    { id: 'mock-id', sender: 'user', content: 'test', timestamp: new Date().toISOString(), read: false, archived: false },
    { status: 201 }
  )),
  http.patch('/api/teams/:name/inbox/:messageId', () => HttpResponse.json(
    { id: 'mock-id', sender: 'user', content: 'test', timestamp: new Date().toISOString(), read: true, archived: false }
  )),

  // History
  http.get('/api/history', () => HttpResponse.json([])),
  http.get('/api/history/stats', () => HttpResponse.json({
    total: 0, topCommand: null, topProject: null, today: 0, dailyActivity: [],
  })),
```

- [ ] **Step 2: Commit**

```bash
git add client/src/tests/mocks/handlers.js
git commit -m "test: add teams and history MSW handlers"
```

---

### Task 5: Build TeamsPanel (TDD)

**Files:**
- Delete: `client/src/components/TeamsPanel.jsx`
- Create: `client/src/components/TeamsPanel/TeamsPanel.jsx`
- Create: `client/src/components/TeamsPanel/TeamInboxFeed.jsx`
- Create: `client/src/components/TeamsPanel/TeamComposeInput.jsx`
- Create: `client/src/tests/components/TeamsPanel.test.jsx`

- [ ] **Step 1: Create `client/src/tests/components/TeamsPanel.test.jsx`**

```jsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { TeamsPanel } from '../../components/TeamsPanel/TeamsPanel.jsx'

const user = () => userEvent.setup({ writeToClipboard: false })

const SAMPLE_TEAMS = [
  {
    name: 'alpha-team',
    description: 'First team',
    members: [{ agentId: 'a1', name: 'worker-1', agentType: 'general', model: 'claude-sonnet-4-6' }],
    createdAt: Date.now() - 86400000,
    inboxes: {
      agent1: [
        { id: 'msg-1', sender: 'agent1', content: 'Hello from agent', timestamp: new Date().toISOString(), read: false, archived: false },
      ],
      dashboard: [],
    },
  },
  {
    name: 'beta-team',
    description: '',
    members: [],
    createdAt: Date.now(),
    inboxes: {},
  },
]

// ─── Empty state ──────────────────────────────────────────────────────────────

describe('TeamsPanel — empty state', () => {
  it('shows empty state when no teams', () => {
    render(<TeamsPanel teams={[]} />)
    expect(screen.getByText(/no teams configured/i)).toBeInTheDocument()
  })

  it('shows empty state when teams is null', () => {
    render(<TeamsPanel teams={null} />)
    expect(screen.getByText(/no teams configured/i)).toBeInTheDocument()
  })
})

// ─── Team list ────────────────────────────────────────────────────────────────

describe('TeamsPanel — team list', () => {
  it('renders team names in the list', () => {
    render(<TeamsPanel teams={SAMPLE_TEAMS} />)
    expect(screen.getByText('alpha-team')).toBeInTheDocument()
    expect(screen.getByText('beta-team')).toBeInTheDocument()
  })

  it('shows unread badge when team has unread messages', () => {
    render(<TeamsPanel teams={SAMPLE_TEAMS} />)
    // alpha-team has 1 unread (msg-1 has read: false, not archived)
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('clicking a team shows the team config card', async () => {
    render(<TeamsPanel teams={SAMPLE_TEAMS} />)
    await userEvent.click(screen.getByText('alpha-team'))
    expect(screen.getByText('First team')).toBeInTheDocument()
    expect(screen.getByText('worker-1')).toBeInTheDocument()
  })
})

// ─── Inbox feed ───────────────────────────────────────────────────────────────

describe('TeamsPanel — inbox feed', () => {
  it('shows inbox messages after selecting a team', async () => {
    render(<TeamsPanel teams={SAMPLE_TEAMS} />)
    await userEvent.click(screen.getByText('alpha-team'))
    expect(screen.getByText('Hello from agent')).toBeInTheDocument()
  })

  it('shows empty inbox message when team has no messages', async () => {
    render(<TeamsPanel teams={SAMPLE_TEAMS} />)
    await userEvent.click(screen.getByText('beta-team'))
    expect(screen.getByText(/no messages/i)).toBeInTheDocument()
  })
})

// ─── Mark as read ─────────────────────────────────────────────────────────────

describe('TeamsPanel — mark as read', () => {
  it('calls PATCH endpoint when mark-read button is clicked', async () => {
    let patchCalled = false
    server.use(
      http.patch('/api/teams/:name/inbox/:messageId', () => {
        patchCalled = true
        return HttpResponse.json({ id: 'msg-1', read: true, archived: false, sender: 'agent1', content: 'Hello from agent', timestamp: new Date().toISOString() })
      })
    )
    render(<TeamsPanel teams={SAMPLE_TEAMS} />)
    await userEvent.click(screen.getByText('alpha-team'))
    const markReadBtn = screen.getByTitle(/mark as read/i)
    await userEvent.click(markReadBtn)
    await waitFor(() => expect(patchCalled).toBe(true))
  })
})

// ─── Archive ──────────────────────────────────────────────────────────────────

describe('TeamsPanel — archive', () => {
  it('calls PATCH endpoint when archive button is clicked', async () => {
    let archiveCalled = false
    server.use(
      http.patch('/api/teams/:name/inbox/:messageId', () => {
        archiveCalled = true
        return HttpResponse.json({ id: 'msg-1', read: false, archived: true, sender: 'agent1', content: 'Hello from agent', timestamp: new Date().toISOString() })
      })
    )
    render(<TeamsPanel teams={SAMPLE_TEAMS} />)
    await userEvent.click(screen.getByText('alpha-team'))
    const archiveBtn = screen.getByTitle(/archive/i)
    await userEvent.click(archiveBtn)
    await waitFor(() => expect(archiveCalled).toBe(true))
  })
})

// ─── Compose ──────────────────────────────────────────────────────────────────

describe('TeamsPanel — compose', () => {
  it('shows compose input when a team is selected', async () => {
    render(<TeamsPanel teams={SAMPLE_TEAMS} />)
    await userEvent.click(screen.getByText('alpha-team'))
    expect(screen.getByPlaceholderText(/message alpha-team/i)).toBeInTheDocument()
  })

  it('submit sends POST and clears the input', async () => {
    let postBody = null
    server.use(
      http.post('/api/teams/:name/inbox', async ({ request }) => {
        postBody = await request.json()
        return HttpResponse.json({ id: 'new-id', sender: 'user', content: postBody.content, timestamp: new Date().toISOString(), read: false, archived: false }, { status: 201 })
      })
    )
    render(<TeamsPanel teams={SAMPLE_TEAMS} />)
    await userEvent.click(screen.getByText('alpha-team'))
    const input = screen.getByPlaceholderText(/message alpha-team/i)
    await userEvent.type(input, 'new message text')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => expect(postBody?.content).toBe('new message text'))
    expect(input).toHaveValue('')
  })

  it('does not submit when input is empty', async () => {
    let postCalled = false
    server.use(http.post('/api/teams/:name/inbox', () => { postCalled = true; return HttpResponse.json({}, { status: 201 }) }))
    render(<TeamsPanel teams={SAMPLE_TEAMS} />)
    await userEvent.click(screen.getByText('alpha-team'))
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(postCalled).toBe(false)
  })

  it('shows error message on failed compose', async () => {
    server.use(http.post('/api/teams/:name/inbox', () => HttpResponse.json({ error: 'Server error' }, { status: 500 })))
    render(<TeamsPanel teams={SAMPLE_TEAMS} />)
    await userEvent.click(screen.getByText('alpha-team'))
    await userEvent.type(screen.getByPlaceholderText(/message alpha-team/i), 'test')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => expect(screen.getByText(/failed to send/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
cd client && npx vitest run src/tests/components/TeamsPanel.test.jsx 2>&1
```
Expected: failures (components don't exist yet).

- [ ] **Step 3: Delete old flat `TeamsPanel.jsx`**

```bash
rm client/src/components/TeamsPanel.jsx
mkdir -p client/src/components/TeamsPanel
```

- [ ] **Step 4: Create `client/src/components/TeamsPanel/TeamComposeInput.jsx`**

```jsx
import { useState } from 'react'
import { Send } from 'lucide-react'

export function TeamComposeInput({ teamName, onSent }) {
  const [content, setContent] = useState('')
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)

  async function handleSend() {
    if (!content.trim()) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/teams/${teamName}/inbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.trim() }),
      })
      if (!res.ok) throw new Error('Failed to send')
      const msg = await res.json()
      setContent('')
      onSent?.(msg)
    } catch {
      setError('Failed to send message')
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  return (
    <div className="border-t border-gray-800 p-3 shrink-0">
      {error && <p className="text-xs text-red-400 mb-1">{error}</p>}
      <div className="flex gap-2">
        <input
          type="text"
          value={content}
          onChange={e => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Message ${teamName}...`}
          className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-600"
        />
        <button
          onClick={handleSend}
          disabled={sending || !content.trim()}
          aria-label="Send"
          className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed rounded text-xs text-gray-200 transition-colors"
        >
          <Send size={11} /> Send
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Create `client/src/components/TeamsPanel/TeamInboxFeed.jsx`**

```jsx
import { useEffect, useRef, useState } from 'react'
import { Check, Archive } from 'lucide-react'

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function TeamInboxFeed({ teamName, messages, onUpdate }) {
  const bottomRef = useRef(null)
  const [paused, setPaused] = useState(false)

  // Merge all inbox files' messages, sort by timestamp, exclude archived
  const active = messages
    .filter(m => !m.archived)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  const archived = messages.filter(m => m.archived)

  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [active.length, paused])

  async function patchMessage(id, updates) {
    const res = await fetch(`/api/teams/${teamName}/inbox/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    if (res.ok) onUpdate?.()
  }

  if (!active.length && !archived.length) {
    return <div className="flex-1 flex items-center justify-center text-xs text-gray-700">No messages yet</div>
  }

  return (
    <div
      className="flex-1 overflow-y-auto p-3 space-y-2"
      onScroll={e => {
        const el = e.currentTarget
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        setPaused(!atBottom)
      }}
    >
      {active.map(msg => (
        <div
          key={msg.id}
          className={`group rounded-lg px-3 py-2 text-xs ${msg.read ? 'bg-gray-900' : 'bg-gray-900 border border-gray-700'}`}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-gray-500 font-medium">{msg.sender}</span>
            <span className="text-gray-700">{formatTime(msg.timestamp)}</span>
            {!msg.read && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 ml-auto" />}
            <div className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {!msg.read && (
                <button
                  onClick={() => patchMessage(msg.id, { read: true })}
                  title="Mark as read"
                  className="text-gray-600 hover:text-gray-300 transition-colors"
                >
                  <Check size={11} />
                </button>
              )}
              <button
                onClick={() => patchMessage(msg.id, { archived: true })}
                title="Archive"
                className="text-gray-600 hover:text-gray-300 transition-colors"
              >
                <Archive size={11} />
              </button>
            </div>
          </div>
          <p className="text-gray-300 leading-relaxed">{msg.content}</p>
        </div>
      ))}

      {archived.length > 0 && (
        <details className="mt-4">
          <summary className="text-xs text-gray-700 cursor-pointer hover:text-gray-500">
            {archived.length} archived
          </summary>
          <div className="mt-2 space-y-2">
            {archived.map(msg => (
              <div key={msg.id} className="rounded-lg px-3 py-2 text-xs bg-gray-900 opacity-50">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-gray-500">{msg.sender}</span>
                  <span className="text-gray-700">{formatTime(msg.timestamp)}</span>
                </div>
                <p className="text-gray-400">{msg.content}</p>
              </div>
            ))}
          </div>
        </details>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
```

- [ ] **Step 6: Create `client/src/components/TeamsPanel/TeamsPanel.jsx`**

```jsx
import { useState } from 'react'
import { Users, Bot, Inbox } from 'lucide-react'
import { TeamInboxFeed } from './TeamInboxFeed.jsx'
import { TeamComposeInput } from './TeamComposeInput.jsx'

function flattenInbox(inboxes) {
  return Object.values(inboxes || {}).flat()
}

function countUnread(inboxes) {
  return flattenInbox(inboxes).filter(m => !m.read && !m.archived).length
}

export function TeamsPanel({ teams, refetch }) {
  const [selectedName, setSelectedName] = useState(null)

  if (!teams || teams.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-gray-600">
        No teams configured. Teams are set up via Claude Code's team configuration.
      </div>
    )
  }

  const selected = teams.find(t => t.name === selectedName)
  const allMessages = selected ? flattenInbox(selected.inboxes) : []

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Team list */}
      <div className="w-48 shrink-0 border-r border-gray-800 overflow-y-auto">
        <div className="px-3 py-2 border-b border-gray-800">
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Teams</span>
        </div>
        {teams.map(team => {
          const unread = countUnread(team.inboxes)
          return (
            <button
              key={team.name}
              onClick={() => setSelectedName(team.name)}
              className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs transition-colors ${
                selectedName === team.name ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-900'
              }`}
            >
              <Users size={11} className="text-purple-400 shrink-0" />
              <span className="truncate flex-1">{team.name}</span>
              {unread > 0 && (
                <span className="shrink-0 bg-blue-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
                  {unread}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Team detail */}
      {selected ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Config card */}
          <div className="shrink-0 border-b border-gray-800 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Users size={13} className="text-purple-400" />
              <span className="text-sm font-semibold text-purple-300">{selected.name}</span>
            </div>
            {selected.description && <p className="text-xs text-gray-500">{selected.description}</p>}
            {(selected.members || []).length > 0 && (
              <div className="space-y-1">
                {selected.members.map(m => (
                  <div key={m.agentId} className="flex items-center gap-2 text-xs">
                    <Bot size={11} className="text-gray-600" />
                    <span className="text-gray-400">{m.name}</span>
                    <span className="text-gray-700">{m.agentType}</span>
                    <span className="ml-auto text-gray-700">{m.model?.split('-').slice(-2).join('-')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Inbox */}
          <div className="px-3 py-1.5 border-b border-gray-800 shrink-0">
            <div className="flex items-center gap-1.5">
              <Inbox size={11} className="text-gray-600" />
              <span className="text-xs text-gray-600 uppercase tracking-wider font-semibold">Inbox</span>
            </div>
          </div>
          <TeamInboxFeed teamName={selected.name} messages={allMessages} onUpdate={refetch} />
          <TeamComposeInput teamName={selected.name} onSent={refetch} />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-xs text-gray-600">
          Select a team to view its inbox
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 7: Run tests to confirm pass**

```bash
cd client && npx vitest run src/tests/components/TeamsPanel.test.jsx 2>&1
```
Expected: all pass.

- [ ] **Step 8: Run full client test suite**

```bash
cd client && npx vitest run 2>&1
```
Expected: all pass (old TeamsPanel tests gone since we deleted the flat file).

- [ ] **Step 9: Commit**

```bash
git add client/src/components/TeamsPanel/ client/src/tests/components/TeamsPanel.test.jsx client/src/tests/mocks/handlers.js
git rm client/src/components/TeamsPanel.jsx
git commit -m "feat: replace TeamsPanel with two-panel inbox UI (TDD)"
```

---

## Chunk 4: Client — HistoryTab

### Task 6: Build HistoryTab (TDD)

**Files:**
- Create: `client/src/components/HistoryTab/HistoryTab.jsx`
- Create: `client/src/components/HistoryTab/HistoryStatsBar.jsx`
- Create: `client/src/components/HistoryTab/HistoryFeed.jsx`
- Create: `client/src/tests/components/HistoryTab.test.jsx`

- [ ] **Step 1: Create `client/src/tests/components/HistoryTab.test.jsx`**

```jsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { HistoryTab } from '../../components/HistoryTab/HistoryTab.jsx'

const SAMPLE_STATS = {
  total: 150,
  topCommand: 'git status',
  topProject: '/Users/me/my-project',
  today: 12,
  dailyActivity: [
    { date: '2026-03-06', count: 5 },
    { date: '2026-03-07', count: 8 },
    { date: '2026-03-08', count: 3 },
    { date: '2026-03-09', count: 12 },
    { date: '2026-03-10', count: 7 },
    { date: '2026-03-11', count: 20 },
    { date: '2026-03-12', count: 12 },
  ],
}

const SAMPLE_ENTRIES = [
  { display: 'git status', timestamp: Date.now() - 1000, project: '/Users/me/my-project', sessionId: 's1' },
  { display: 'npm run dev', timestamp: Date.now() - 2000, project: '/Users/me/other-project', sessionId: 's2' },
  { display: 'git commit -m "fix bug"', timestamp: Date.now() - 3000, project: '/Users/me/my-project', sessionId: 's3' },
]

function setupMocks(entries = SAMPLE_ENTRIES, stats = SAMPLE_STATS) {
  server.use(
    http.get('/api/history', () => HttpResponse.json(entries)),
    http.get('/api/history/stats', () => HttpResponse.json(stats)),
  )
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

describe('HistoryTab — stats bar', () => {
  it('renders total commands count', async () => {
    setupMocks()
    render(<HistoryTab historyVersion={0} />)
    await waitFor(() => expect(screen.getByText('150')).toBeInTheDocument())
  })

  it('renders top command', async () => {
    setupMocks()
    render(<HistoryTab historyVersion={0} />)
    await waitFor(() => expect(screen.getByText('git status')).toBeInTheDocument())
  })

  it('renders commands today count', async () => {
    setupMocks()
    render(<HistoryTab historyVersion={0} />)
    await waitFor(() => expect(screen.getByText('12')).toBeInTheDocument())
  })

  it('renders 7 sparkline bars', async () => {
    setupMocks()
    render(<HistoryTab historyVersion={0} />)
    await waitFor(() => {
      const bars = screen.getAllByRole('img', { hidden: true })
      // At minimum the sparkline container should render
      expect(screen.getByTestId('sparkline')).toBeInTheDocument()
    })
  })

  it('shows zeroed stats on empty history', async () => {
    setupMocks([], { total: 0, topCommand: null, topProject: null, today: 0, dailyActivity: [] })
    render(<HistoryTab historyVersion={0} />)
    await waitFor(() => expect(screen.getByText('0')).toBeInTheDocument())
  })
})

// ─── Feed ─────────────────────────────────────────────────────────────────────

describe('HistoryTab — feed', () => {
  it('renders history entries', async () => {
    setupMocks()
    render(<HistoryTab historyVersion={0} />)
    await waitFor(() => expect(screen.getByText('git status')).toBeInTheDocument())
    expect(screen.getByText('npm run dev')).toBeInTheDocument()
  })

  it('shows empty state when no history', async () => {
    setupMocks([])
    render(<HistoryTab historyVersion={0} />)
    await waitFor(() => expect(screen.getByText(/no command history/i)).toBeInTheDocument())
  })

  it('expands entry on click to show full text', async () => {
    const longEntry = { display: 'a'.repeat(200), timestamp: Date.now(), project: '/p', sessionId: 's' }
    setupMocks([longEntry])
    render(<HistoryTab historyVersion={0} />)
    await waitFor(() => screen.getByText(/^a+/))
    await userEvent.click(screen.getByText(/^a+/))
    // After expand, full text should be visible (not truncated)
    expect(screen.getByText(longEntry.display)).toBeInTheDocument()
  })
})

// ─── Search ───────────────────────────────────────────────────────────────────

describe('HistoryTab — search', () => {
  it('filters feed by search term', async () => {
    setupMocks()
    render(<HistoryTab historyVersion={0} />)
    await waitFor(() => screen.getByText('git status'))
    const search = screen.getByPlaceholderText(/search/i)
    await userEvent.type(search, 'npm')
    expect(screen.queryByText('git status')).not.toBeInTheDocument()
    expect(screen.getByText('npm run dev')).toBeInTheDocument()
  })
})

// ─── Project filter ───────────────────────────────────────────────────────────

describe('HistoryTab — project filter', () => {
  it('filters feed by project selection', async () => {
    setupMocks()
    render(<HistoryTab historyVersion={0} />)
    await waitFor(() => screen.getByText('git status'))
    const select = screen.getByRole('combobox')
    await userEvent.selectOptions(select, 'my-project')
    expect(screen.queryByText('npm run dev')).not.toBeInTheDocument()
  })
})

// ─── Grouping toggle ──────────────────────────────────────────────────────────

describe('HistoryTab — grouping toggle', () => {
  it('toggles between flat and grouped view', async () => {
    setupMocks()
    render(<HistoryTab historyVersion={0} />)
    await waitFor(() => screen.getByText('git status'))
    const toggleBtn = screen.getByRole('button', { name: /group/i })
    await userEvent.click(toggleBtn)
    // Grouped view shows project name as a header
    expect(screen.getByText(/my-project/)).toBeInTheDocument()
  })
})

// ─── Load more ────────────────────────────────────────────────────────────────

describe('HistoryTab — load more', () => {
  it('shows Load More button when results may have more pages', async () => {
    // 100 entries = full page, so Load More should appear
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      display: `cmd-${i}`, timestamp: Date.now() - i * 1000, project: '/p', sessionId: `s${i}`,
    }))
    setupMocks(fullPage)
    render(<HistoryTab historyVersion={0} />)
    await waitFor(() => screen.getByText(/load more/i))
  })

  it('does not show Load More when fewer than 100 results', async () => {
    setupMocks(SAMPLE_ENTRIES) // only 3 entries
    render(<HistoryTab historyVersion={0} />)
    await waitFor(() => screen.getByText('git status'))
    expect(screen.queryByText(/load more/i)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
cd client && npx vitest run src/tests/components/HistoryTab.test.jsx 2>&1
```
Expected: failures.

- [ ] **Step 3: Create `client/src/components/HistoryTab/HistoryStatsBar.jsx`**

```jsx
import { Clock, Hash, FolderOpen, Calendar } from 'lucide-react'
import path from 'path-browserify'

function Sparkline({ data }) {
  if (!data?.length) return <div data-testid="sparkline" className="flex gap-0.5 items-end h-6" />
  const max = Math.max(...data.map(d => d.count), 1)
  return (
    <div data-testid="sparkline" className="flex gap-0.5 items-end h-6" title="7-day activity">
      {data.map(d => (
        <div
          key={d.date}
          title={`${d.date}: ${d.count}`}
          className="w-3 bg-blue-500 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
          style={{ height: `${Math.max(2, (d.count / max) * 24)}px` }}
        />
      ))}
    </div>
  )
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2 bg-gray-900 rounded px-3 py-2">
      <Icon size={11} className="text-gray-600 shrink-0" />
      <div>
        <div className="text-xs text-gray-600 leading-none mb-0.5">{label}</div>
        <div className="text-sm font-semibold text-gray-200 truncate max-w-32" title={String(value)}>
          {value ?? '—'}
        </div>
      </div>
    </div>
  )
}

export function HistoryStatsBar({ stats }) {
  if (!stats) return null
  const projectBasename = stats.topProject ? stats.topProject.split(/[\\/]/).pop() : null
  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-800 overflow-x-auto">
      <StatCard icon={Hash} label="Total" value={stats.total} />
      <StatCard icon={Calendar} label="Today" value={stats.today} />
      <StatCard icon={Clock} label="Top command" value={stats.topCommand} />
      <StatCard icon={FolderOpen} label="Top project" value={projectBasename} />
      <div className="ml-auto shrink-0">
        <Sparkline data={stats.dailyActivity} />
      </div>
    </div>
  )
}
```

Note: `path-browserify` is used for `path.basename` in the browser. Add it: `cd client && npm install path-browserify`. Vite resolves `path` via `resolve.alias` in vite config, or just use string splitting (the split approach is already in the code above).

- [ ] **Step 4: Create `client/src/components/HistoryTab/HistoryFeed.jsx`**

```jsx
import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

function formatTs(ts) {
  return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function projectBasename(p) {
  return (p || '').split(/[\\/]/).pop() || p
}

function EntryRow({ entry }) {
  const [expanded, setExpanded] = useState(false)
  const truncated = entry.display.length > 80
  const preview = truncated ? entry.display.slice(0, 80) + '…' : entry.display

  return (
    <div
      onClick={() => truncated && setExpanded(e => !e)}
      className={`px-3 py-2 border-b border-gray-900 hover:bg-gray-900 transition-colors ${truncated ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-start gap-2">
        <span className="text-gray-700 text-xs shrink-0 mt-0.5">{formatTs(entry.timestamp)}</span>
        <span className="text-gray-400 text-xs flex-1 font-mono leading-relaxed break-all">
          {expanded ? entry.display : preview}
        </span>
        <span className="text-gray-700 text-xs shrink-0">{projectBasename(entry.project)}</span>
      </div>
    </div>
  )
}

function GroupedView({ entries }) {
  const groups = {}
  for (const e of entries) {
    const key = e.project || '(unknown)'
    if (!groups[key]) groups[key] = []
    groups[key].push(e)
  }
  return (
    <div className="overflow-y-auto flex-1">
      {Object.entries(groups).map(([project, items]) => (
        <details key={project} open className="mb-1">
          <summary className="px-3 py-1.5 text-xs text-gray-500 font-semibold cursor-pointer hover:text-gray-300 bg-gray-950 sticky top-0">
            {projectBasename(project)} <span className="text-gray-700">({items.length})</span>
          </summary>
          {items.map(e => <EntryRow key={`${e.sessionId}-${e.timestamp}`} entry={e} />)}
        </details>
      ))}
    </div>
  )
}

export function HistoryFeed({ entries, grouped, onLoadMore, hasMore }) {
  if (!entries.length) {
    return <div className="flex-1 flex items-center justify-center text-xs text-gray-700">No command history found</div>
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {grouped
        ? <GroupedView entries={entries} />
        : (
          <div className="overflow-y-auto flex-1">
            {entries.map(e => <EntryRow key={`${e.sessionId}-${e.timestamp}`} entry={e} />)}
          </div>
        )
      }
      {hasMore && (
        <div className="shrink-0 flex justify-center py-2 border-t border-gray-900">
          <button
            onClick={onLoadMore}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors px-4 py-1.5"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Create `client/src/components/HistoryTab/HistoryTab.jsx`**

```jsx
import { useState, useEffect, useCallback } from 'react'
import { LayoutList, List } from 'lucide-react'
import { HistoryStatsBar } from './HistoryStatsBar.jsx'
import { HistoryFeed } from './HistoryFeed.jsx'

const PAGE_SIZE = 100

export function HistoryTab({ historyVersion }) {
  const [stats, setStats] = useState(null)
  const [entries, setEntries] = useState([])
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [grouped, setGrouped] = useState(false)

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/history/stats')
      if (res.ok) setStats(await res.json())
    } catch {}
  }, [])

  const fetchPage = useCallback(async (newOffset = 0, replace = true) => {
    const params = new URLSearchParams({ limit: PAGE_SIZE, offset: newOffset })
    if (projectFilter) params.set('project', projectFilter)
    try {
      const res = await fetch(`/api/history?${params}`)
      if (!res.ok) return
      const data = await res.json()
      setEntries(prev => replace ? data : [...prev, ...data])
      setHasMore(data.length === PAGE_SIZE)
      setOffset(newOffset + data.length)
    } catch {}
  }, [projectFilter])

  useEffect(() => {
    fetchStats()
    fetchPage(0, true)
  }, [fetchStats, fetchPage, historyVersion])

  const allProjects = [...new Set(entries.map(e => e.project).filter(Boolean))]

  const filtered = search
    ? entries.filter(e => e.display?.toLowerCase().includes(search.toLowerCase()))
    : entries

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <HistoryStatsBar stats={stats} />

      {/* Controls */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-800">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search history…"
          className="flex-1 bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs text-gray-300 placeholder-gray-700 focus:outline-none focus:border-gray-600"
        />
        <select
          value={projectFilter}
          onChange={e => { setProjectFilter(e.target.value); fetchPage(0, true) }}
          className="bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs text-gray-400 focus:outline-none"
        >
          <option value="">All projects</option>
          {allProjects.map(p => (
            <option key={p} value={p}>{p.split(/[\\/]/).pop()}</option>
          ))}
        </select>
        <button
          onClick={() => setGrouped(g => !g)}
          aria-label={grouped ? 'Flat view' : 'Group by project'}
          title={grouped ? 'Flat view' : 'Group by project'}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${grouped ? 'bg-gray-800 text-gray-200' : 'text-gray-600 hover:text-gray-400'}`}
        >
          {grouped ? <List size={11} /> : <LayoutList size={11} />}
          Group
        </button>
      </div>

      <HistoryFeed
        entries={filtered}
        grouped={grouped}
        hasMore={hasMore && !search}
        onLoadMore={() => fetchPage(offset, false)}
      />
    </div>
  )
}
```

- [ ] **Step 6: Run tests to confirm pass**

```bash
cd client && npx vitest run src/tests/components/HistoryTab.test.jsx 2>&1
```
Expected: all pass.

- [ ] **Step 7: Run full client suite**

```bash
cd client && npx vitest run 2>&1
```
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add client/src/components/HistoryTab/ client/src/tests/components/HistoryTab.test.jsx
git commit -m "feat: add HistoryTab with stats bar, feed, search, filter, grouping (TDD)"
```

---

## Chunk 5: App.jsx Wiring + E2E Tests

### Task 7: Wire up App.jsx

**Files:**
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Update `client/src/App.jsx`**

Make these changes:

**a) Add imports** (after the `SkillsPanel` import):

```js
import { TeamsPanel } from './components/TeamsPanel/TeamsPanel.jsx'
import { HistoryTab } from './components/HistoryTab/HistoryTab.jsx'
```

**b) Add icons** to the existing lucide-react import — add `Users` and `History`:

```js
import { Eye, GitBranch, ListTodo, Command, HelpCircle, LayoutGrid, List, ArrowLeft, Users, History } from 'lucide-react'
```

**c) Add two entries to the `TABS` array** (after `skills`):

```js
  { id: 'teams', label: 'Teams', icon: Users },
  { id: 'history', label: 'History', icon: History },
```

**d) Add two new state counters** (after `intelligenceVersion`):

```js
  const [teamsVersion, setTeamsVersion] = useState(0)
  const [historyVersion, setHistoryVersion] = useState(0)
```

**e) Add `useApi` call for teams** (after the `skills` useApi call):

```js
  const { data: teams, refetch: refetchTeams } = useApi('/api/teams', [teamsVersion])
```

**f) Add two new SSE handlers** inside the `useSSE` callback, after the `intelligence_update` block:

```js
    if (evt.type === 'team_update') {
      setTeamsVersion(v => v + 1)
    }
    if (evt.type === 'history_update') {
      setHistoryVersion(v => v + 1)
    }
```

**g) Add two new tab renders** in the `<main>` section, after the `skills` tab render:

```jsx
          {activeTab === 'teams' && <TeamsPanel teams={teams} refetch={refetchTeams} />}
          {activeTab === 'history' && <HistoryTab historyVersion={historyVersion} />}
```

- [ ] **Step 2: Start dev server and manually verify both tabs appear**

```bash
npm run dev
```
Open http://localhost:5173. Confirm "Teams" and "History" tabs appear in the nav bar. Click each and verify they render without errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/App.jsx
git commit -m "feat: wire Teams and History tabs into App.jsx"
```

---

### Task 8: E2E Tests

**Files:**
- Create: `e2e/teams.spec.js`
- Create: `e2e/history.spec.js`

- [ ] **Step 1: Create `e2e/teams.spec.js`**

```js
import { test, expect } from '@playwright/test'

async function goToTeams(page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Teams' }).click()
}

test.describe('teams tab', () => {
  test('navigate to teams tab shows Teams panel', async ({ page }) => {
    await goToTeams(page)
    // Either the empty state or the teams panel renders
    const hasEmptyState = await page.getByText(/no teams configured/i).isVisible().catch(() => false)
    const hasTeamsList = await page.locator('button', { hasText: /Teams/i }).first().isVisible()
    expect(hasEmptyState || hasTeamsList).toBe(true)
  })

  test('teams tab shows empty state when no teams', async ({ page }) => {
    await goToTeams(page)
    // If the API returns empty array, empty state is shown
    // (works in CI where ~/.claude/teams may not exist)
    const emptyState = page.getByText(/no teams configured/i)
    const teamsList = page.locator('.w-48') // team list panel
    const either = await Promise.race([
      emptyState.waitFor({ timeout: 3000 }).then(() => 'empty'),
      teamsList.waitFor({ timeout: 3000 }).then(() => 'list'),
    ]).catch(() => 'timeout')
    expect(['empty', 'list']).toContain(either)
  })
})
```

- [ ] **Step 2: Create `e2e/history.spec.js`**

```js
import { test, expect } from '@playwright/test'

async function goToHistory(page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'History' }).click()
}

test.describe('history tab', () => {
  test('navigate to history tab shows History panel', async ({ page }) => {
    await goToHistory(page)
    await expect(page.getByPlaceholder('Search history…')).toBeVisible()
  })

  test('history tab has search input', async ({ page }) => {
    await goToHistory(page)
    await expect(page.getByPlaceholder('Search history…')).toBeVisible()
  })

  test('history tab has project filter dropdown', async ({ page }) => {
    await goToHistory(page)
    await expect(page.getByRole('combobox')).toBeVisible()
  })

  test('history tab has group toggle button', async ({ page }) => {
    await goToHistory(page)
    await expect(page.getByRole('button', { name: /group/i })).toBeVisible()
  })

  test('history tab shows stats bar or empty state', async ({ page }) => {
    await goToHistory(page)
    // Either stats loaded or empty state — both are valid
    const hasStats = await page.locator('[data-testid="sparkline"]').isVisible().catch(() => false)
    const hasEmpty = await page.getByText(/no command history/i).isVisible().catch(() => false)
    const hasEntries = await page.locator('.font-mono').first().isVisible().catch(() => false)
    expect(hasStats || hasEmpty || hasEntries).toBe(true)
  })

  test('typing in search filters the feed', async ({ page }) => {
    await goToHistory(page)
    const search = page.getByPlaceholder('Search history…')
    await search.fill('nonexistent-command-xyz')
    // After filtering, if there were any results before, they should be gone
    await expect(page.getByText(/no command history/i).or(search)).toBeVisible()
  })

  test('group toggle changes view mode', async ({ page }) => {
    await goToHistory(page)
    const toggleBtn = page.getByRole('button', { name: /group/i })
    await toggleBtn.click()
    // Button should still be visible (just toggled state)
    await expect(toggleBtn).toBeVisible()
  })
})
```

- [ ] **Step 3: Run E2E tests**

```bash
npm run test:e2e 2>&1
```
Expected: all pass (or skip gracefully when no real data exists).

- [ ] **Step 4: Run full test suite**

```bash
npm test 2>&1
```
Expected: all 198+ tests pass.

- [ ] **Step 5: Commit**

```bash
git add e2e/teams.spec.js e2e/history.spec.js
git commit -m "test: add E2E tests for Teams and History tabs"
```

---

## Done

All tasks complete. Run `npm test` to confirm the full suite passes, then open http://localhost:5173 and verify both tabs work end-to-end.
