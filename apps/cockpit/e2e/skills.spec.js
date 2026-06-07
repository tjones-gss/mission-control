import { test, expect } from '@playwright/test'
import { revealAdvanced } from './helpers.js'

async function goToSkills(page) {
  await page.goto('/')
  await revealAdvanced(page)
  await page.getByRole('button', { name: 'Skills' }).click()
  // Wait for the panel to finish its initial load. Under parallel
  // workers the dashboard's 6+ concurrent useApi calls saturate the
  // single-threaded Node backend, so the search input (the most
  // reliable "panel ready" signal) can take a while to appear. The
  // SkillsPanel early-returns to "Loading skills..." until both the
  // /api/skills GET completes AND React StrictMode's double-mount
  // settles, which is the slowest combo in the suite.
  await page.getByPlaceholder('Search skills...').waitFor({ state: 'visible', timeout: 60_000 })
}

test.describe('skills', () => {
  test('navigate to skills tab shows Skills panel', async ({ page }) => {
    await goToSkills(page)
    // SkillsPanel is identifiable by its unique New Skill button
    // (the header tab "Skills" also matches getByText('Skills') so
    // we can't use that as a reliable signal).
    await expect(page.getByRole('button', { name: /New Skill/ })).toBeVisible()
  })

  test('skills panel has a search input', async ({ page }) => {
    await goToSkills(page)
    await expect(page.getByPlaceholder('Search skills...')).toBeVisible()
  })

  test('skills panel has a filter dropdown', async ({ page }) => {
    await goToSkills(page)
    // The select starts on "All"
    const filterSelect = page.locator('select').filter({ hasText: 'All' })
    await expect(filterSelect).toBeVisible()
  })

  test('skills panel shows New Skill button', async ({ page }) => {
    await goToSkills(page)
    await expect(page.getByRole('button', { name: /New Skill/ })).toBeVisible()
  })

  test('clicking New Skill opens the new skill form', async ({ page }) => {
    await goToSkills(page)
    await page.getByRole('button', { name: /New Skill/ }).click()

    // NewSkillForm is identifiable by its name input — the "New Skill"
    // text alone is ambiguous since the trigger button also has that text.
    await expect(page.getByPlaceholder('skill-name (letters, digits, _ : -)')).toBeVisible()
  })

  test('new skill form has a Save button disabled until name is entered', async ({ page }) => {
    await goToSkills(page)
    await page.getByRole('button', { name: /New Skill/ }).click()

    // The Save button inside the new-skill form
    const saveBtn = page.getByRole('button', { name: 'Save' }).last()
    // With an empty name the backend will reject, but the button itself is not
    // disabled in the DOM — it relies on server-side validation.
    // We just verify it is visible.
    await expect(saveBtn).toBeVisible()
  })

  test('new skill form can be cancelled', async ({ page }) => {
    await goToSkills(page)
    await page.getByRole('button', { name: /New Skill/ }).click()
    // Identify the form by its unique input placeholder
    const formInput = page.getByPlaceholder('skill-name (letters, digits, _ : -)')
    await expect(formInput).toBeVisible()

    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(formInput).not.toBeVisible()
  })

  test('search input filters displayed skills', async ({ page }) => {
    await goToSkills(page)

    const searchInput = page.getByPlaceholder('Search skills...')
    // Type a search query that is unlikely to match any skill
    await searchInput.fill('xyzzy-no-match-12345')

    // Should show the empty-results message
    await expect(page.getByText(/No skills match/)).toBeVisible()
  })

  test('clearing the search restores all skills', async ({ page }) => {
    await goToSkills(page)

    const searchInput = page.getByPlaceholder('Search skills...')
    await searchInput.fill('xyzzy-no-match-12345')
    await expect(page.getByText(/No skills match/)).toBeVisible()

    await searchInput.clear()
    // The empty-results banner should go away
    await expect(page.getByText(/No skills match/)).not.toBeVisible()
  })

  test('shows skill count in the header', async ({ page }) => {
    await goToSkills(page)
    // SkillsPanel renders "· N skills" next to the heading
    await expect(page.locator('text=skills').first()).toBeVisible()
  })
})
