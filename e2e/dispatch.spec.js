import { test, expect } from '@playwright/test'

// The dispatch drawer is a bottom-anchored modal that broadcasts a
// message to multiple grouped sessions. It mounts on the dashboard
// (always present in the DOM as role="dialog") but is only visible
// when `open=true`. We open it via the "Open dispatch manager" handle
// button or the header "Dispatch" tab button.

test.describe('dispatch drawer', () => {
  test('handle button is visible at the bottom of the dashboard', async ({ page }) => {
    await page.goto('/')
    // The handle is the small chevron button at the bottom-center.
    // It uses aria-label="Open dispatch manager".
    await expect(page.getByRole('button', { name: 'Open dispatch manager' })).toBeVisible()
  })

  test('clicking the handle opens the drawer with header copy', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Open dispatch manager' }).click()
    // The dialog header label "Dispatch Manager" should now be visible.
    await expect(page.getByText('Dispatch Manager')).toBeVisible()
    // The composer textarea is visible too (placeholder shifts based
    // on selection state, so match the unselected default).
    await expect(page.getByPlaceholder('Select children above, then type a message…')).toBeVisible()
  })

  test('Dispatch button is disabled when nothing is selected', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Open dispatch manager' }).click()
    // Within the open drawer, find the footer Dispatch send button.
    // It's disabled until both a session is selected AND text is typed.
    const sendBtn = page
      .locator('[role="dialog"][aria-label="Dispatch manager"]')
      .getByRole('button', { name: 'Dispatch' })
    await expect(sendBtn).toBeDisabled()
  })

  test('drawer body shows either manager cards or the empty-state copy', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Open dispatch manager' }).click()
    // Whether or not the test machine has 2+ sessions in a shared parent
    // dir, the body should render exactly one of: manager cards (a
    // numeric "N groups" header), or the empty-state copy. Probe for
    // the header label which is always present.
    await expect(
      page
        .locator('[role="dialog"][aria-label="Dispatch manager"]')
        .getByText(/\d+ (group|groups) • \d+ (session|sessions)/),
    ).toBeVisible()
  })

  test('clicking the Close button collapses the drawer', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Open dispatch manager' }).click()
    // Drawer is open — handle button hides while open.
    await expect(page.getByRole('button', { name: 'Open dispatch manager' })).not.toBeVisible()
    // Close via the header close button (title="Close (Esc)").
    await page
      .locator('[role="dialog"][aria-label="Dispatch manager"]')
      .getByRole('button', { name: /Close/ })
      .click()
    // After closing, the handle button should reappear.
    await expect(page.getByRole('button', { name: 'Open dispatch manager' })).toBeVisible()
  })

  test('Escape key closes the drawer', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Open dispatch manager' }).click()
    await expect(page.getByText('Dispatch Manager')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Open dispatch manager' })).toBeVisible()
  })

  test('"d" keyboard shortcut opens the dispatch drawer', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(1000)
    await page.keyboard.press('d')
    await expect(page.getByText('Dispatch Manager')).toBeVisible()
  })

  test('Dispatch button in header opens the drawer', async ({ page }) => {
    await page.goto('/')
    // The header has a Dispatch button (separate from the handle)
    await page.locator('nav').getByText('Dispatch').click()
    await expect(page.getByText('Dispatch Manager')).toBeVisible()
  })

  test('dispatch handle does not overlap the conversation input', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2000)
    // This test requires at least one session so the Detail view renders
    // a ConversationView with a message input. Skip on CI where no
    // sessions exist (same pattern as layout.spec.js).
    const sessionCount = await page.locator('[data-session-card-id]').count()
    test.skip(sessionCount === 0, 'no sessions on this runner')

    // Switch to Detail view to see the ConversationView input
    await page
      .getByRole('button', { name: /^Detail$/ })
      .first()
      .click()
    await page.waitForTimeout(1000)

    const input = page.getByPlaceholder(/Send a message/)
    const handle = page.getByRole('button', { name: 'Open dispatch manager' })

    // Both should be visible and actionable
    await expect(input).toBeVisible()
    await expect(handle).toBeVisible()

    // Trial-click the input to verify it's not blocked by the handle
    await input.click({ trial: true })
  })

  test('Dispatch button stays disabled with only text (no selection)', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Open dispatch manager' }).click()
    const drawer = page.locator('[role="dialog"][aria-label="Dispatch manager"]')

    // Type a message but don't select anyone
    await drawer.getByPlaceholder('Select children above, then type a message…').fill('hello')
    const sendBtn = drawer.getByRole('button', { name: 'Dispatch' })
    await expect(sendBtn).toBeDisabled()
  })

  // Note: the corresponding pure-API shape/validation tests for the
  // dispatch surface live in api-dispatch.spec.js. Keeping them in a
  // dedicated API-only spec file matches the pattern used by
  // api-sessions-name / api-tasks / api-validation, and avoids being
  // scheduled onto a worker that is simultaneously running the UI
  // tests above (which mount the dashboard and fire ~6 useApi calls
  // in parallel against the single-threaded dev server).
})
