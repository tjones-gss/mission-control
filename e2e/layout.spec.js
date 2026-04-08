import { test, expect } from '@playwright/test'

// Regression guards for layout bugs the user hit on feature/dispatch-manager.
//
// 1. The DispatchDrawerHandle is fixed at bottom-0 left-1/2 and used to
//    sit directly on top of the ConversationView's message input, making
//    the input effectively unusable — clicks landed on the handle and
//    opened the drawer instead of focusing the input.
//
// 2. Sending a message via the regular conversation input + Send button
//    must actually POST to /api/sessions/:id/message.

test.describe('layout regressions', () => {
  test('dispatch handle does not cover the conversation message input', async ({ page }) => {
    await page.goto('/')

    // The Agents tab defaults to Board view. Click Detail to get the
    // ConversationView with its bottom-anchored message input.
    await page.getByRole('button', { name: /^Detail$/ }).click()

    // Wait for the input to render — the conversation may still be
    // loading its messages when the detail view first mounts.
    const input = page.getByPlaceholder(/Send a message/)
    await input.waitFor({ state: 'visible', timeout: 30_000 })

    const handle = page.getByRole('button', { name: 'Open dispatch manager' })
    await expect(handle).toBeVisible()

    const inputBox = await input.boundingBox()
    const handleBox = await handle.boundingBox()
    expect(inputBox).not.toBeNull()
    expect(handleBox).not.toBeNull()

    // The handle's top edge must sit strictly below the input's bottom edge.
    const inputBottom = inputBox.y + inputBox.height
    const handleTop = handleBox.y
    expect(handleTop).toBeGreaterThanOrEqual(inputBottom)

    // And the input must be actionable — i.e. Playwright can click it
    // without the handle intercepting. trial:true only performs the
    // actionability check, doesn't actually click.
    await input.click({ trial: true, timeout: 5_000 })
  })

  test('sending via conversation input POSTs to /api/sessions/:id/message', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /^Detail$/ }).click()

    const input = page.getByPlaceholder(/Send a message/)
    await input.waitFor({ state: 'visible', timeout: 30_000 })

    // Synchronize on the POST so we don't race test teardown.
    const postPromise = page.waitForResponse(
      (r) => /\/api\/sessions\/[^/]+\/message$/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 30_000 },
    )

    await input.fill('e2e layout regression test — ignore')
    await page.getByRole('button', { name: 'Send', exact: true }).click()

    const resp = await postPromise
    // Success path is 202 Accepted. A 409 "query already active" is also
    // acceptable — it means the POST reached the handler and passed
    // validation, just collided with an in-flight query from another
    // test. Anything else (400, 500, 404) is a real failure.
    expect([202, 409]).toContain(resp.status())
  })
})
