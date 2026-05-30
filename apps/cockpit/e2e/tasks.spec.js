import { test, expect } from '@playwright/test'

// TaskBoard renders per-session TODOs grouped by status. The column
// headers are "In Progress / Pending / Completed", matching the form
// labels — this is the result of the board column rename fix.

async function goToTasks(page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Tasks' }).click()
  // Wait for the Tasks section label (the tab root renders "Tasks"
  // as an uppercase semi-header once it mounts, regardless of whether
  // a session is selected or tasks have loaded).
  await page
    .getByText('Tasks', { exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
}

test.describe('tasks tab', () => {
  test('navigating to Tasks tab renders the TaskBoard root', async ({ page }) => {
    await goToTasks(page)
    // The tab button is highlighted.
    await expect(page.getByRole('button', { name: 'Tasks' })).toHaveClass(/bg-gray-800/)
  })

  test('TaskBoard shows the uppercase "Tasks" section label', async ({ page }) => {
    await goToTasks(page)
    // The board root renders "Tasks" inside the <span class="uppercase"> header.
    await expect(page.locator('span.uppercase').getByText('Tasks', { exact: true })).toBeVisible()
  })

  test('TaskBoard shows either "New Task" button or empty state', async ({ page }) => {
    await goToTasks(page)
    // Depending on whether a session is selected, the board shows either
    // the "+ New Task" button (session present) OR the "No tasks for
    // this session" empty state OR the grouped columns with real tasks.
    // All three render the Tasks section label, so probe for any of
    // those follow-up elements.
    const newTaskBtn = page.getByRole('button', { name: /New Task/ })
    const emptyState = page.getByText('No tasks for this session')
    const pendingHeader = page.getByRole('heading', { name: /Pending \(\d+\)/ })
    const inProgressHeader = page.getByRole('heading', { name: /In Progress \(\d+\)/ })
    const completedHeader = page.getByRole('heading', { name: /Completed \(\d+\)/ })
    // .first() so strict mode tolerates multiple recognizable elements
    // being visible at once (the board can render "+ New Task" alongside
    // populated column headers when the active session has tasks).
    await expect(
      newTaskBtn.or(emptyState).or(pendingHeader).or(inProgressHeader).or(completedHeader).first(),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('column headers use renamed labels (no legacy "Todo"/"Doing"/"Done")', async ({ page }) => {
    await goToTasks(page)
    // After the board column rename fix, the legacy labels should NEVER
    // appear. Check that none of them render inside the main task board.
    // (They could still appear in the form's "Status" select, but that's
    // not shown until the user clicks "+ New Task".)
    const main = page.locator('main')
    await expect(main.getByRole('heading', { name: 'Todo' })).toHaveCount(0)
    await expect(main.getByRole('heading', { name: 'Doing' })).toHaveCount(0)
    await expect(main.getByRole('heading', { name: 'Done' })).toHaveCount(0)
  })
})
