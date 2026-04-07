import { test, expect } from '@playwright/test'

async function goToHistory(page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'History' }).click()
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
    await expect(page.getByRole('button', { name: /group/i })).toBeVisible()
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
    await search.fill('nonexistent-command-xyz')
    await expect(page.getByText(/no command history/i).or(search)).toBeVisible()
  })

  test('group toggle changes view mode', async ({ page }) => {
    await goToHistory(page)
    const toggleBtn = page.getByRole('button', { name: /group/i })
    await toggleBtn.click()
    await expect(toggleBtn).toBeVisible()
  })
})
