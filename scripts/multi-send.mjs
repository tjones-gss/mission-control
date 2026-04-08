// Try sending to several different sessions in sequence. See which pass/fail.
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

function findJsonl(sid) {
  const projectsDir = join(homedir(), '.claude', 'projects')
  for (const project of readdirSync(projectsDir)) {
    const p = join(projectsDir, project, `${sid}.jsonl`)
    if (existsSync(p)) return p
  }
  return null
}

function countMark(path, mark) {
  if (!path || !existsSync(path)) return 0
  return (readFileSync(path, 'utf8').match(new RegExp(mark, 'g')) || []).length
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function trySend(sid, mark) {
  const start = Date.now()
  const res = await fetch(`http://localhost:3001/api/sessions/${sid}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `multi-test ping — ${mark}` }),
  })
  const status = res.status
  const body = await res.text()
  if (status !== 202) return { sid, status, body, landed: 0, duration: 0 }
  // Poll for mark in JSONL up to 60s
  const jsonlPath = findJsonl(sid)
  let hits = 0
  for (let i = 0; i < 120; i++) {
    hits = countMark(jsonlPath, mark)
    if (hits > 0) break
    await sleep(500)
  }
  return { sid, status, landed: hits, duration: ((Date.now() - start) / 1000).toFixed(1) }
}

async function main() {
  const mgrs = await fetch('http://localhost:3001/api/managers').then(r => r.json())
  const now = Date.now()
  const hourAgo = now - 60 * 60 * 1000
  const CURRENT = 'bac7b314-f182-4357-bc6c-f9a2071618c0'
  const candidates = []
  for (const m of mgrs.managers) {
    for (const c of m.children) {
      if (c.isActive) continue
      if (c.sessionId === CURRENT) continue
      candidates.push(c)
    }
  }
  // Pick 6 recent sessions
  const recent = candidates.filter(c => c.lastModified > hourAgo).slice(0, 6)
  console.log(`testing ${recent.length} recent idle sessions`)

  for (const c of recent) {
    const mark = `MULTI-${Date.now()}-${c.sessionId.slice(0, 8)}`
    process.stdout.write(`  ${c.sessionId.slice(0, 8)} (${c.slug}) ... `)
    const r = await trySend(c.sessionId, mark)
    const icon = r.landed > 0 ? '✓' : '✗'
    console.log(`${icon} status=${r.status} landed=${r.landed} duration=${r.duration}s`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
