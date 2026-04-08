// Throwaway manual smoke test: open the dashboard, try sending a message
// via ConversationView input, try dispatching via the DispatchDrawer.
// This is for interactive debugging, not CI. Run with:
//   node scripts/smoke-dispatch.mjs
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  const logs = []
  page.on('console', (msg) => logs.push(`[console.${msg.type()}] ${msg.text()}`))
  page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`))
  page.on('request', (r) => {
    if (r.url().includes('/api/')) logs.push(`[req] ${r.method()} ${r.url().replace(BASE, '')}`)
  })
  page.on('response', (r) => {
    if (r.request().method() === 'POST') {
      logs.push(`[post-resp] ${r.status()} ${r.url().replace(BASE, '')}`)
    }
  })
  page.on('requestfinished', async (req) => {
    if (req.method() === 'POST') {
      const resp = await req.response().catch(() => null)
      if (resp) {
        const body = await resp.text().catch(() => '<no body>')
        logs.push(`[fin] ${resp.status()} POST ${req.url().replace(BASE, '')} → ${body.slice(0, 150)}`)
      } else {
        logs.push(`[fin-no-resp] POST ${req.url().replace(BASE, '')}`)
      }
    }
  })
  page.on('requestfailed', (req) => {
    logs.push(`[fail] ${req.method()} ${req.url().replace(BASE, '')} — ${req.failure()?.errorText}`)
  })

  console.log('→ navigate')
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })

  // ── 0. Wait for the app shell to mount
  await page.getByText('Oversight').first().waitFor({ state: 'visible', timeout: 15_000 })
  await page.waitForTimeout(3000)

  // ── 0b. The Agents tab defaults to Board view (kanban of sessions).
  //       Click into Detail view to get the ConversationView + input.
  console.log('→ click Detail view')
  await page.getByRole('button', { name: /^Detail$/ }).click()
  await page.waitForTimeout(1500)

  // ── 1. Verify the conversation input is clickable (not covered by dispatch handle)
  console.log('→ wait for message input')
  const input = page.getByPlaceholder(/Send a message/)
  await input.waitFor({ state: 'visible', timeout: 30_000 })

  // Get bounding boxes of input + dispatch handle to confirm no overlap
  const inputBox = await input.boundingBox()
  const handle = page.getByRole('button', { name: /Open dispatch manager/ })
  const handleBox = await handle.boundingBox()
  console.log('→ input box:', inputBox)
  console.log('→ handle box:', handleBox)

  const overlap =
    inputBox &&
    handleBox &&
    handleBox.y < inputBox.y + inputBox.height &&
    handleBox.y + handleBox.height > inputBox.y
  console.log('→ handle OVERLAPS input vertically?', overlap ? '❌ YES' : '✓ no')

  // ── 2. Try to click the input. If the handle is blocking, this will fail or
  //      hit the handle instead. trial:true just tests actionability.
  console.log('→ trial click on input (tests whether handle is blocking)')
  try {
    await input.click({ trial: true, timeout: 5_000 })
    console.log('→ input is actionable ✓')
  } catch (e) {
    console.log('→ input click BLOCKED:', e.message.split('\n')[0])
  }

  // ── 3. Actually send a message
  console.log('→ fill input and submit')
  await input.fill('smoke-test ping from script — ignore')
  const sendBtn = page.getByRole('button', { name: 'Send', exact: true })
  await sendBtn.click()

  // Wait for the POST response
  await page.waitForTimeout(2000)

  // ── 4. Open dispatch drawer and try to dispatch
  console.log('→ open dispatch drawer')
  await page.getByRole('button', { name: 'Open dispatch manager' }).click()
  // Scope to the dialog — the conversation history has user messages
  // that contain the string "Dispatch Manager" verbatim.
  const drawer = page.locator('[role="dialog"][aria-label="Dispatch manager"]')
  await drawer.waitFor({ state: 'visible', timeout: 5_000 })

  // Dump the drawer contents to see what's actually rendered
  await page.waitForTimeout(1000)

  // Expand ALL manager groups so we can reach a non-active child.
  // The drawer default-expands only the FIRST manager, and the first
  // child in that group happens to be the session we just sent to —
  // which will 409 with "A query is already active".
  const collapsedManagers = drawer.locator('button').filter({ has: page.locator('svg.lucide-chevron-right') })
  const collapsedCount = await collapsedManagers.count()
  console.log('→ collapsed managers to expand:', collapsedCount)
  for (let i = 0; i < collapsedCount; i++) {
    await collapsedManagers.nth(i).click().catch(() => {})
    await page.waitForTimeout(100)
  }

  // Pick a DONE (not active) child row so we don't collide with the
  // query started by the ConversationView send above.
  const doneChildRow = drawer
    .locator('button')
    .filter({ has: page.locator('span.uppercase:has-text("done")') })
    .first()
  await doneChildRow.waitFor({ state: 'visible', timeout: 5_000 })
  const childSlug = await doneChildRow.locator('span.truncate').first().textContent().catch(() => '?')
  console.log('→ clicking done child:', childSlug)
  await doneChildRow.click()
  await page.waitForTimeout(500)

  // Check if "N selected" badge appeared
  const selectedBadge = await drawer.getByText(/\d+ selected/).textContent().catch(() => null)
  console.log('→ selected badge:', selectedBadge || '(none)')

  // Type a message
  const dispatchInput = drawer.getByPlaceholder(/Broadcast to|Select children/)
  await dispatchInput.fill('dispatch smoke-test — ignore')
  await page.waitForTimeout(300)

  const inputValue = await dispatchInput.inputValue()
  console.log('→ dispatch input value:', JSON.stringify(inputValue))

  // Click the Dispatch button inside the drawer
  const dispatchBtn = drawer.getByRole('button', { name: /^Dispatch$/ }).first()
  const disabled = await dispatchBtn.isDisabled()
  console.log('→ Dispatch button disabled?', disabled ? '❌ YES' : '✓ no')

  if (!disabled) {
    console.log('→ click Dispatch and wait for POST response (30s)')
    const respPromise = page.waitForResponse(
      (r) => /\/api\/sessions\/[^/]+\/message$/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 30_000 },
    )
    await dispatchBtn.click()
    try {
      const resp = await respPromise
      console.log(`→ dispatch POST response: ${resp.status()}`)
    } catch (e) {
      console.log('→ dispatch POST timed out:', e.message.split('\n')[0])
    }
    // Wait an extra 3s so the drawer's "ok" state and animation land.
    await page.waitForTimeout(3000)
  }

  // Dump dispatch state from the drawer to confirm the per-child badge
  const dispatchStateText = await drawer.innerText()
  const hasOk = /1 selected/.test(dispatchStateText) || /✓/.test(dispatchStateText)
  console.log('→ drawer has a success badge?', hasOk ? 'maybe' : 'no')

  console.log('\n─── captured logs (all) ───')
  for (const l of logs) console.log(l)

  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
