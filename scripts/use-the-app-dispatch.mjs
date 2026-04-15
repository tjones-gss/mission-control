// Dispatch-drawer end-to-end: open drawer, pick an idle child, type a
// unique message, click Dispatch, verify the message lands in the
// target session's JSONL.
import { chromium } from 'playwright'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const BASE = 'http://localhost:5173'
const MARK = `QA-DISPATCH-${Date.now()}`

function findJsonl(sid) {
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
    if (/\/api\/sessions\/[^/]+\/message$/.test(r.url())) {
      netlog.push(`RESP ${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`)
    }
  })

  console.log('\n== 1. Open app ==')
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.getByText('Oversight').first().waitFor({ state: 'visible', timeout: 15_000 })
  await page.waitForTimeout(2500)

  console.log('\n== 2. Open dispatch drawer ==')
  await page.getByRole('button', { name: 'Open dispatch manager' }).click()
  const drawer = page.locator('[role="dialog"][aria-label="Dispatch manager"]')
  await drawer.waitFor({ state: 'visible', timeout: 5_000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'scripts/screenshots/d01-drawer-open.png' })

  // Expand all manager groups so we can pick any child
  console.log('\n== 3. Expand all manager groups ==')
  const collapsed = drawer
    .locator('button')
    .filter({ has: page.locator('svg.lucide-chevron-right') })
  const n = await collapsed.count()
  console.log('  collapsed groups:', n)
  for (let i = 0; i < n; i++) {
    await collapsed
      .nth(i)
      .click()
      .catch(() => {})
    await page.waitForTimeout(100)
  }

  // Pick a child whose status label is "done" (not active/needsInput)
  console.log('\n== 4. Pick a done child ==')
  const doneBtn = drawer
    .locator('button')
    .filter({ has: page.locator('span.uppercase:text("done")') })
    .first()
  await doneBtn.waitFor({ state: 'visible', timeout: 5_000 })
  const childText = await doneBtn.innerText()
  console.log('  child row text:', childText.replace(/\s+/g, ' ').slice(0, 100))

  // Extract the target session id from the ChildRow. ChildRow doesn't
  // have a data attribute, so use the managers API to match.
  // Simpler: hover the row, then observe the tooltip, OR parse by slug.
  // Simplest: select the child, let the drawer's POST happen, and grab
  // the sid from the network log.
  await doneBtn.click()
  await page.waitForTimeout(300)

  // Read selected badge
  const badge = await drawer
    .getByText(/\d+ selected/)
    .textContent()
    .catch(() => null)
  console.log('  selected badge:', badge)

  console.log('\n== 5. Type and dispatch ==')
  const dispatchInput = drawer.getByPlaceholder(/Broadcast to|Select children/)
  await dispatchInput.fill(`QA dispatch ping — ignore — ${MARK}`)
  await page.waitForTimeout(200)

  const dispatchBtn = drawer.getByRole('button', { name: /^Dispatch$/ }).first()
  const disabled = await dispatchBtn.isDisabled()
  console.log('  dispatch button disabled?', disabled)

  // Wait for the response
  const respPromise = page.waitForResponse(
    (r) => /\/api\/sessions\/[^/]+\/message$/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 30_000 },
  )
  await dispatchBtn.click()
  const resp = await respPromise.catch(() => null)
  if (!resp) {
    console.log('  ❌ POST never returned')
    await browser.close()
    return
  }
  const targetSid = resp.url().match(/\/api\/sessions\/([^/]+)\/message/)[1]
  console.log('  dispatch POST:', resp.status(), '→ target:', targetSid)

  await page.waitForTimeout(2000)
  await page.screenshot({ path: 'scripts/screenshots/d02-after-dispatch.png' })

  console.log('\n== 6. Verify JSONL roundtrip ==')
  const jsonlPath = findJsonl(targetSid)
  console.log('  jsonl path:', jsonlPath || '(not found)')
  if (jsonlPath) {
    // Poll for the mark for up to 15s (startQuery needs to boot PTY)
    let found = 0
    for (let i = 0; i < 30; i++) {
      found = countMark(jsonlPath)
      if (found > 0) break
      await page.waitForTimeout(500)
    }
    console.log(`  '${MARK}' in jsonl:`, found, found > 0 ? '✓' : '❌')
  }

  console.log('\n== NETWORK LOG (last 15) ==')
  for (const l of netlog.slice(-15)) console.log(' ', l)

  await browser.close()
  console.log('\ndone.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
