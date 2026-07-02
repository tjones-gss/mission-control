import { test, expect } from '@playwright/test'

async function goToHistory(page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'History' }).click()
  // Wait for the panel to finish its initial load. Under parallel
  // workers the dashboard's 6+ concurrent useApi calls saturate the
  // single-threaded Node backend, so this can take 5-15 seconds.
  // The search input is the most reliable "panel ready" signal.
  await page.getByPlaceholder(/Search history/).waitFor({ state: 'visible', timeout: 30_000 })
}

test.describe('history tab', () => {
  test('navigate to history tab shows History panel', async ({ page }) => {
    await goToHistory(page)
    await expect(page.getByPlaceholder(/Search history/)).toBeVisible()
  })

  test('history tab has search input', async ({ page }) => {
    await goToHistory(page)
    await expect(page.getByPlaceholder(/Search history/)).toBeVisible()
  })

  test('history tab has project filter dropdown', async ({ page }) => {
    await goToHistory(page)
    await expect(page.getByRole('combobox')).toBeVisible()
  })

  test('history tab has group toggle button', async ({ page }) => {
    await goToHistory(page)
    // The toggle's aria-label is "Group by project" initially, and
    // flips to "Flat view" after click. Match the initial state.
    await expect(page.getByRole('button', { name: /Group by project/i })).toBeVisible()
  })

  test('history tab shows stats bar or empty state', async ({ page }) => {
    await goToHistory(page)
    const hasStats = await page
      .locator('[data-testid="sparkline"]')
      .isVisible()
      .catch(() => false)
    const hasEmpty = await page
      .getByText(/no command history/i)
      .isVisible()
      .catch(() => false)
    const hasEntries = await page
      .locator('.font-mono')
      .first()
      .isVisible()
      .catch(() => false)
    expect(hasStats || hasEmpty || hasEntries).toBe(true)
  })

  test('typing in search filters the feed', async ({ page }) => {
    await goToHistory(page)
    const search = page.getByPlaceholder(/Search history/)
    await search.fill('nonexistent-command-xyz-12345')
    // After filtering on a definitely-no-match query, the empty-state
    // message should appear. Previously this used .or(search) as a
    // fallback but Playwright's strict mode treats two visible matches
    // as a violation, and the search input is always visible.
    await expect(page.getByText(/No command history yet/)).toBeVisible()
  })

  test('group toggle changes view mode', async ({ page }) => {
    await goToHistory(page)
    // The aria-label flips after click: "Group by project" → "Flat view".
    // Locate by initial label, click, then assert the flipped label exists.
    const toggleBtn = page.getByRole('button', { name: /Group by project/i })
    await toggleBtn.click()
    await expect(page.getByRole('button', { name: /Flat view/i })).toBeVisible()
  })
})
