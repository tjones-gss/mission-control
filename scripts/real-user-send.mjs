// Drive the app like a real person managing Claude Code sessions.
// For each target session:
//   1. Select it in the sidebar, switch to Detail view
//   2. Verify the input is enabled
//   3. Type a unique ping and click Send
//   4. Verify the user bubble appears ON SCREEN (not just HTTP 202)
//   5. Wait for an assistant response to appear on screen (timeout 90s)
//   6. Verify the JSONL on disk also got the mark
//
// Repeats for dispatch-drawer flow.
//
// Prints a structured report at the end listing PASS/FAIL per step,
// suitable for handing to a dev sub-agent.

import { chromium } from 'playwright'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const BASE = 'http://localhost:5173'
const CURRENT_SID = 'bac7b314-f182-4357-bc6c-f9a2071618c0' // don't touch me

function findJsonl(sid) {
  const projectsDir = join(homedir(), '.claude', 'projects')
  for (const project of readdirSync(projectsDir)) {
    const p = join(projectsDir, project, `${sid}.jsonl`)
    if (existsSync(p)) return p
  }
  return null
}

function markInJsonl(sid, mark) {
  const p = findJsonl(sid)
  if (!p || !existsSync(p)) return 0
  return (readFileSync(p, 'utf8').match(new RegExp(mark, 'g')) || []).length
}

function report(title, results) {
  console.log(`\n━━━ ${title} ━━━`)
  for (const r of results) {
    const icon = r.pass ? '✓' : '✗'
    console.log(` ${icon} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
  }
  const failed = results.filter((r) => !r.pass)
  return { ok: failed.length === 0, failed }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchJson(url) {
  const r = await fetch(url)
  return r.json()
}

const EXCLUDE = new Set([
  'bac7b314-f182-4357-bc6c-f9a2071618c0', // current primary (me)
  '55f9482d-065f-4be1-aa25-57b843394424', // tested earlier — may have stuck PTY
  'd585c50a-921a-4c21-8b62-a2d638b6ad19', // tested earlier — may have stuck PTY
  '060b1576-a961-4ab5-b230-4a557982bc59', // tested earlier
  'fdb2de61-a66c-4148-82bf-a15a44d8305c', // tested earlier
])

async function pickIdleTarget() {
  // Pick an idle session that hasn't been touched by prior test runs
  // this session, not the current primary. Prefer recent so it's in
  // the auto-expanded Recent group of the sidebar.
  const data = await fetchJson('http://localhost:3001/api/managers')
  const hourAgo = Date.now() - 60 * 60 * 1000
  const candidates = []
  for (const m of data.managers) {
    for (const c of m.children) {
      if (c.isActive) continue
      if (EXCLUDE.has(c.sessionId)) continue
      candidates.push(c)
    }
  }
  const recent = candidates.find((c) => c.lastModified > hourAgo)
  return (recent || candidates[0])?.sessionId || null
}

async function runConversationViewFlow(page, targetSid, mark) {
  const results = []
  const netlog = []
  page.on('request', (r) => {
    if (r.url().includes('/api/sessions/')) netlog.push(`REQ ${r.method()} ${r.url().replace(BASE, '')}`)
  })
  page.on('response', (r) => {
    if (/\/api\/sessions\/[^/]+\/message$/.test(r.url())) {
      netlog.push(`RESP ${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`)
    }
  })

  // Step 1: Open app
  console.log(`[CV] open app, target=${targetSid}`)
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.getByText('Oversight').first().waitFor({ state: 'visible', timeout: 15_000 })

  // Wait for the sessions API call to populate the sidebar. In headful mode
  // with slowMo, the React render + useApi fetch can take several seconds
  // past the initial DOM load, so poll for the first card to appear.
  let sidebarReady = false
  for (let i = 0; i < 30; i++) {
    const anyCard = await page.locator('[data-session-card-id]').count()
    if (anyCard > 0) {
      sidebarReady = true
      break
    }
    await sleep(300)
  }
  if (!sidebarReady) {
    results.push({ name: 'sidebar populated', pass: false, detail: 'no cards after 9s' })
    return { results, netlog }
  }

  // Step 2: Find target card. It may be in a collapsed Older group.
  let card = page.locator(`[data-session-card-id="${targetSid}"]`)
  let cardExists = await card.count().then((n) => n > 0)
  if (!cardExists) {
    // Only expand Older if it's collapsed
    const olderHeader = page.getByRole('button', { name: /^Older/ })
    if (await olderHeader.isVisible().catch(() => false)) {
      await olderHeader.click()
      await sleep(400)
      card = page.locator(`[data-session-card-id="${targetSid}"]`)
      cardExists = await card.count().then((n) => n > 0)
    }
  }
  results.push({ name: 'target session visible in sidebar', pass: cardExists })
  if (!cardExists) return { results, netlog }
  await card.scrollIntoViewIfNeeded()
  await card.click()
  await sleep(1500)

  // Step 3: Switch to Detail view
  const detailBtn = page.getByRole('button', { name: /^Detail$/ })
  if (await detailBtn.isVisible().catch(() => false)) {
    await detailBtn.click()
    await sleep(1000)
  }

  // Step 4: Verify input is ready
  const input = page.getByPlaceholder(/Send a message|Generating|Sending/)
  await input.waitFor({ state: 'visible', timeout: 15_000 })
  const placeholder = await input.getAttribute('placeholder')
  const disabled = await input.isDisabled()
  results.push({ name: 'input present', pass: true, detail: `placeholder=${JSON.stringify(placeholder)}` })
  results.push({ name: 'input not disabled', pass: !disabled })
  if (disabled) return { results, netlog }

  // Step 5: Type and click Send
  await input.fill(`QA ping — ignore — ${mark}`)
  await sleep(150)
  const sendBtn = page.getByRole('button', { name: 'Send', exact: true })
  const sendDisabled = await sendBtn.isDisabled()
  results.push({ name: 'send button enabled after typing', pass: !sendDisabled })
  if (sendDisabled) return { results, netlog }

  const postPromise = page.waitForResponse(
    (r) => /\/api\/sessions\/[^/]+\/message$/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 30_000 },
  )
  await sendBtn.click()
  const resp = await postPromise.catch(() => null)
  results.push({
    name: 'POST /api/sessions/:id/message',
    pass: resp && resp.status() === 202,
    detail: resp ? `HTTP ${resp.status()}` : 'no response',
  })

  // Step 6: Verify the user bubble appears ON SCREEN
  await sleep(800)
  const userBubble = page.getByText(mark, { exact: false }).first()
  const userBubbleVisible = await userBubble.isVisible().catch(() => false)
  results.push({ name: 'user bubble visible on screen', pass: userBubbleVisible })

  // Step 6b: Verify the conversation auto-scrolled to the bottom after
  // sending — the user must SEE their message + the generating area
  // without having to manually scroll down.
  const scrollState = await page.evaluate(() => {
    // Find the scrollable conversation container: a div with overflow-y-auto
    // that contains a "Send a message" placeholder input somewhere inside.
    const mains = Array.from(document.querySelectorAll('main'))
    for (const main of mains) {
      const scrollables = main.querySelectorAll('div')
      for (const el of scrollables) {
        const style = getComputedStyle(el)
        if (style.overflowY === 'auto' && el.scrollHeight > el.clientHeight) {
          return {
            scrollTop: el.scrollTop,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
            bottomGap: el.scrollHeight - el.scrollTop - el.clientHeight,
          }
        }
      }
    }
    return null
  })
  const atBottom = scrollState ? scrollState.bottomGap < 100 : false
  results.push({
    name: 'conversation auto-scrolled to bottom after send',
    pass: atBottom,
    detail: scrollState
      ? `bottomGap=${scrollState.bottomGap}px (scrollTop=${scrollState.scrollTop}, scrollHeight=${scrollState.scrollHeight})`
      : 'no scroll container found',
  })

  // Step 6c: Also check the user bubble is in the viewport
  const inViewport = await userBubble
    .evaluate((el) => {
      const r = el.getBoundingClientRect()
      return r.top >= 0 && r.bottom <= window.innerHeight
    })
    .catch(() => false)
  results.push({ name: 'user bubble is in viewport (not scrolled off-screen)', pass: inViewport })

  // Step 7: Verify the user message lands in the JSONL
  let jsonlHits = 0
  for (let i = 0; i < 30; i++) {
    jsonlHits = markInJsonl(targetSid, mark)
    if (jsonlHits > 0) break
    await sleep(500)
  }
  results.push({
    name: 'user message landed in JSONL',
    pass: jsonlHits > 0,
    detail: `hits=${jsonlHits}`,
  })

  // Step 8: Wait for the assistant response to actually appear on screen.
  // First find the assistant text from the server, then look for it in
  // the DOM. This guarantees we're checking "did the UI render what the
  // server produced" rather than "did the text somehow grow".
  const startTs = Date.now()
  let assistantText = null
  let gotOnServer = false
  for (let i = 0; i < 120; i++) {
    const msgs = await fetchJson(`http://localhost:3001/api/sessions/${targetSid}/messages?limit=50`).catch(
      () => null,
    )
    if (msgs?.messages) {
      for (let k = msgs.messages.length - 1; k >= 0; k--) {
        const m = msgs.messages[k]
        if (m.type !== 'assistant') continue
        const ts = Date.parse(m.timestamp || 0)
        if (ts <= startTs - 3000) continue
        // Pull the first text block
        for (const block of m.blocks || []) {
          if (block.type === 'text' && block.text) {
            assistantText = block.text
            break
          }
        }
        if (assistantText) {
          gotOnServer = true
          break
        }
      }
    }
    if (gotOnServer) break
    await sleep(500)
  }
  results.push({
    name: 'server produced an assistant response within 60s',
    pass: gotOnServer,
    detail: gotOnServer
      ? `after ${((Date.now() - startTs) / 1000).toFixed(1)}s — "${assistantText.slice(0, 60)}"`
      : 'timed out',
  })

  if (gotOnServer) {
    // Now verify that exact text is visible in the UI
    let visibleInUi = false
    const snippet = assistantText.slice(0, Math.min(30, assistantText.length))
    for (let i = 0; i < 40; i++) {
      const matches = await page.getByText(snippet, { exact: false }).count().catch(() => 0)
      if (matches > 0) {
        visibleInUi = true
        break
      }
      await sleep(500)
    }
    results.push({
      name: 'assistant response rendered in the conversation pane',
      pass: visibleInUi,
      detail: visibleInUi ? 'found on screen' : `snippet "${snippet}" not found in DOM`,
    })
  }

  return { results, netlog }
}

async function runDispatchFlow(page, mark) {
  const results = []
  const netlog = []
  page.on('request', (r) => {
    if (r.url().includes('/api/sessions/')) netlog.push(`REQ ${r.method()} ${r.url().replace(BASE, '')}`)
  })

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.getByText('Oversight').first().waitFor({ state: 'visible', timeout: 15_000 })
  await sleep(2000)

  await page.getByRole('button', { name: 'Open dispatch manager' }).click()
  const drawer = page.locator('[role="dialog"][aria-label="Dispatch manager"]')
  await drawer.waitFor({ state: 'visible', timeout: 5_000 })
  results.push({ name: 'dispatch drawer opens', pass: true })
  await sleep(800)

  // Pick an idle/done child row in the already-expanded first manager
  // group. Avoid active (streaming) children — those will 409.
  const childBtn = drawer
    .locator('button')
    .filter({
      has: page.locator('span.uppercase', { hasText: /^(idle|done)$/i }),
    })
    .first()
  const hasChild = await childBtn.count().then((n) => n > 0)
  if (!hasChild) {
    results.push({ name: 'drawer has an idle/done child to target', pass: false })
    return { results, netlog }
  }
  await childBtn.click()
  await sleep(300)

  const selectedBadge = await drawer
    .getByText(/\d+ selected/)
    .textContent()
    .catch(() => null)
  results.push({
    name: 'selection badge shows after click',
    pass: !!selectedBadge,
    detail: selectedBadge || '(none)',
  })

  const composer = drawer.getByPlaceholder(/Broadcast to|Select children/)
  await composer.fill(`dispatch ping — ignore — ${mark}`)
  const dispatchBtn = drawer.getByRole('button', { name: /^Dispatch$/ }).first()
  const dispatchDisabled = await dispatchBtn.isDisabled()
  results.push({ name: 'dispatch button enabled', pass: !dispatchDisabled })
  if (dispatchDisabled) return { results, netlog }

  const postPromise = page.waitForResponse(
    (r) => /\/api\/sessions\/[^/]+\/message$/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 30_000 },
  )
  await dispatchBtn.click()
  const resp = await postPromise.catch(() => null)
  const targetSid = resp ? resp.url().match(/\/api\/sessions\/([^/]+)\/message/)[1] : null
  results.push({
    name: 'dispatch POST returns 202',
    pass: resp && resp.status() === 202,
    detail: resp ? `${resp.status()} → ${targetSid?.slice(0, 8)}` : 'no response',
  })
  if (!resp || resp.status() !== 202) return { results, netlog }

  let hits = 0
  for (let i = 0; i < 60; i++) {
    hits = markInJsonl(targetSid, mark)
    if (hits > 0) break
    await sleep(500)
  }
  results.push({
    name: 'dispatched message landed in target JSONL',
    pass: hits > 0,
    detail: `hits=${hits}`,
  })

  return { results, netlog, targetSid }
}

async function main() {
  const mark = `QA-REAL-${Date.now()}`
  console.log(`MARK: ${mark}`)

  try {
    const h = await fetch('http://localhost:3001/api/health')
    if (!h.ok) throw new Error('health not ok')
  } catch {
    console.log('✗ backend not reachable at localhost:3001')
    process.exit(2)
  }

  const target = await pickIdleTarget()
  if (!target) {
    console.log('✗ no idle session to use as target')
    process.exit(2)
  }
  console.log(`CV target idle session: ${target}`)

  const browser = await chromium.launch({ headless: false, slowMo: 150 })
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERR:', e.message))

  // Flow 1: ConversationView
  const cv = await runConversationViewFlow(page, target, mark + '-CV')
  const cvReport = report('ConversationView → send → receive response in UI', cv.results)

  // Flow 2: Dispatch drawer
  const page2 = await ctx.newPage()
  page2.on('pageerror', (e) => console.log('PAGEERR:', e.message))
  const disp = await runDispatchFlow(page2, mark + '-DISP')
  const dispReport = report('DispatchDrawer → pick child → send → verify landed', disp.results)

  const allOk = cvReport.ok && dispReport.ok
  if (!allOk) {
    console.log('\n━━━ CV NETWORK LOG (last 15) ━━━')
    for (const l of cv.netlog.slice(-15)) console.log(' ', l)
    console.log('\n━━━ DISP NETWORK LOG (last 15) ━━━')
    for (const l of disp.netlog.slice(-15)) console.log(' ', l)
  }

  await browser.close()

  if (!allOk) {
    console.log('\n❌ FAIL — report to dev agent')
    process.exit(1)
  }
  console.log('\n✓ ALL PASS — both flows work end-to-end through the UI')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
