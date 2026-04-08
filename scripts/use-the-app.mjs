// Actually use the app like a human would.
// Pick an idle session, type a unique message, hit Send, and verify
// the message is visible on screen. Take screenshots so we can see
// what actually renders.
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const BASE = 'http://localhost:5173'
const MARK = `QA-SMOKE-${Date.now()}` // unique substring we can search for in JSONL

function tailSession(sid) {
  // Find the JSONL file by walking ~/.claude/projects/*/sid.jsonl
  const projectsDir = join(homedir(), '.claude', 'projects')
  for (const project of readdirSync(projectsDir)) {
    const p = join(projectsDir, project, `${sid}.jsonl`)
    if (existsSync(p)) return p
  }
  return null
}

function countMark(path) {
  if (!path || !existsSync(path)) return 0
  return (readFileSync(path, 'utf8').match(new RegExp(MARK, 'g')) || []).length
}

async function main() {
  console.log('MARK:', MARK)
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const page = await ctx.newPage()

  const netlog = []
  page.on('request', (r) => {
    if (r.url().includes('/api/')) netlog.push(`REQ ${r.method()} ${r.url().replace(BASE, '')}`)
  })
  page.on('response', (r) => {
    if (r.url().includes('/api/sessions/') && r.url().endsWith('/message')) {
      netlog.push(`RESP ${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`)
    }
  })
  page.on('pageerror', (e) => netlog.push(`PAGEERR ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') netlog.push(`CONSERR ${m.text()}`)
  })

  console.log('\n== 1. Open app ==')
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.getByText('Oversight').first().waitFor({ state: 'visible', timeout: 15_000 })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'scripts/screenshots/01-dashboard.png', fullPage: false })
  console.log('  screenshot: 01-dashboard.png')

  // ── Pick an idle session from the sidebar that's NOT the current primary.
  // The sidebar renders a list of SessionCard buttons with data-session-card-id.
  console.log('\n== 2. Find an idle session in sidebar ==')
  const allCards = await page.locator('[data-session-card-id]').all()
  console.log('  sidebar cards:', allCards.length)

  const CURRENT_SID = 'bac7b314-f182-4357-bc6c-f9a2071618c0'
  let targetSid = null
  let targetCard = null
  for (const card of allCards) {
    const sid = await card.getAttribute('data-session-card-id')
    if (sid === CURRENT_SID) continue
    // Prefer a card that shows IDLE or DONE status (not ACTIVE).
    const text = await card.innerText()
    if (/active/i.test(text)) continue
    targetSid = sid
    targetCard = card
    break
  }

  if (!targetSid) {
    console.log('  no idle session found; falling back to first non-current')
    for (const card of allCards) {
      const sid = await card.getAttribute('data-session-card-id')
      if (sid === CURRENT_SID) continue
      targetSid = sid
      targetCard = card
      break
    }
  }
  console.log('  target session:', targetSid)

  const jsonlPath = tailSession(targetSid)
  console.log('  jsonl path:', jsonlPath || '(not found)')
  const markBefore = countMark(jsonlPath)
  console.log(`  '${MARK}' occurrences in jsonl BEFORE:`, markBefore)

  // ── Click the target session card to select it
  console.log('\n== 3. Click target session to select it ==')
  await targetCard.scrollIntoViewIfNeeded()
  await targetCard.click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'scripts/screenshots/02-session-selected.png' })

  // ── Switch to Detail view so we see the ConversationView with the input
  console.log('\n== 4. Switch to Detail view ==')
  const detailBtn = page.getByRole('button', { name: /^Detail$/ })
  if (await detailBtn.isVisible().catch(() => false)) {
    await detailBtn.click()
    await page.waitForTimeout(1000)
  }
  await page.screenshot({ path: 'scripts/screenshots/03-detail-view.png' })

  // ── Find the message input and check its state
  console.log('\n== 5. Check message input state ==')
  const input = page.getByPlaceholder(/Send a message|Generating|Sending/)
  await input.waitFor({ state: 'visible', timeout: 15_000 })
  const placeholder = await input.getAttribute('placeholder')
  const disabled = await input.isDisabled()
  console.log('  placeholder:', JSON.stringify(placeholder))
  console.log('  disabled?', disabled)

  if (disabled) {
    console.log('  ⚠ INPUT IS DISABLED — this session is streaming. Cannot send.')
    console.log('  netlog tail:')
    for (const l of netlog.slice(-15)) console.log('   ', l)
    await browser.close()
    return
  }

  // ── Type the unique message and click Send
  console.log('\n== 6. Type message and click Send ==')
  const payload = `QA ping — ignore — ${MARK}`
  await input.fill(payload)
  await page.waitForTimeout(200)
  const sendBtn = page.getByRole('button', { name: 'Send', exact: true })
  const sendDisabled = await sendBtn.isDisabled()
  console.log('  Send button disabled?', sendDisabled)
  if (sendDisabled) {
    console.log('  ⚠ SEND BUTTON DISABLED')
    await browser.close()
    return
  }

  await sendBtn.click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'scripts/screenshots/04-after-send.png' })

  // ── Check if the typed message is VISIBLE in the conversation
  console.log('\n== 7. Verify message is visible on screen ==')
  const markLocator = page.getByText(MARK, { exact: false })
  const visible = await markLocator.first().isVisible().catch(() => false)
  const count = await markLocator.count().catch(() => 0)
  console.log('  message visible?', visible, 'count=', count)

  // Wait another few seconds for server processing
  await page.waitForTimeout(5000)
  await page.screenshot({ path: 'scripts/screenshots/05-after-wait.png' })

  // ── Check JSONL roundtrip
  console.log('\n== 8. Check JSONL for mark ==')
  const markAfter = countMark(jsonlPath)
  console.log(`  '${MARK}' occurrences in jsonl AFTER:`, markAfter, '(before was', markBefore + ')')

  console.log('\n== NETWORK LOG ==')
  for (const l of netlog) console.log(' ', l)

  await browser.close()
  console.log('\ndone. screenshots in scripts/screenshots/')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
