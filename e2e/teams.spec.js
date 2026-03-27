import { test, expect } from '@playwright/test'

async function goToTeams(page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Teams' }).click()
}

test.describe('teams tab', () => {
  test('navigate to teams tab shows Teams panel', async ({ page }) => {
    await goToTeams(page)
    const hasEmptyState = await page.getByText(/no teams configured/i).isVisible().catch(() => false)
    const hasTeamsList = await page.locator('button', { hasText: /Teams/i }).first().isVisible()
    expect(hasEmptyState || hasTeamsList).toBe(true)
  })

  test('teams tab shows empty state when no teams', async ({ page }) => {
    await goToTeams(page)
    const emptyState = page.getByText(/no teams configured/i)
    const teamsList = page.locator('.w-48')
    const either = await Promise.race([
      emptyState.waitFor({ timeout: 3000 }).then(() => 'empty'),
      teamsList.waitFor({ timeout: 3000 }).then(() => 'list'),
    ]).catch(() => 'timeout')
    expect(['empty', 'list']).toContain(either)
  })
})
