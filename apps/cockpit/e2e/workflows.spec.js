import { test, expect } from '@playwright/test'
import { revealAdvanced } from './helpers.js'

async function goToWorkflows(page) {
  await page.goto('/')
  await revealAdvanced(page)
  await page.getByRole('button', { name: 'Workflows' }).click()
  // Wait for the WorkflowsPanel "New" button to be visible (the most
  // reliable "panel mounted with data" signal). Under parallel
  // workers the dashboard's 6+ concurrent useApi calls saturate the
  // single-threaded Node backend, so this can take 5-15 seconds.
  await page
    .getByRole('button', { name: 'New', exact: true })
    .waitFor({ state: 'visible', timeout: 30_000 })
}

test.describe('workflows', () => {
  test('navigate to workflows tab shows panel', async ({ page }) => {
    await goToWorkflows(page)
    // The left panel always shows the "Workflows" section label
    await expect(page.locator('text=Workflows').first()).toBeVisible()
    // The New button is always present at the bottom of the left panel
    await expect(page.getByRole('button', { name: 'New', exact: true })).toBeVisible()
  })

  test('empty state shows placeholder text', async ({ page }) => {
    await goToWorkflows(page)
    // When no workflow is selected, the right panel shows this message
    await expect(page.getByText('Select a workflow or create a new one.')).toBeVisible()
  })

  test('clicking New opens a blank editor', async ({ page }) => {
    await goToWorkflows(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()

    // The right panel should now show a Name field and a Description field
    await expect(page.getByPlaceholder('my-workflow')).toBeVisible()
    await expect(page.getByPlaceholder('What this workflow does…')).toBeVisible()

    // The Save button should be present (disabled when name is empty)
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible()
  })

  test('Save button is disabled when name is empty', async ({ page }) => {
    await goToWorkflows(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()

    const saveBtn = page.getByRole('button', { name: 'Save' })
    await expect(saveBtn).toBeDisabled()
  })

  test('Save button becomes enabled after entering a name', async ({ page }) => {
    await goToWorkflows(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()

    await page.getByPlaceholder('my-workflow').fill('test-wf-preview')
    const saveBtn = page.getByRole('button', { name: 'Save' })
    await expect(saveBtn).toBeEnabled()
  })

  test('create a new workflow and verify it appears in the list', async ({ page }) => {
    const name = `test-wf-${Date.now()}`
    await goToWorkflows(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()

    await page.getByPlaceholder('my-workflow').fill(name)
    await page.getByPlaceholder('What this workflow does…').fill('Created by E2E test')

    // Synchronize on the POST response so the workflow is persisted
    // before we try to interact with it in the list.
    const postPromise = page.waitForResponse(
      (r) => r.url().endsWith('/api/workflows') && r.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'Save' }).click()
    await postPromise

    // After save the workflow should appear in the left panel list
    const groupRow = page.locator('.group').filter({ hasText: name })
    await expect(groupRow).toBeVisible({ timeout: 20_000 })

    // Clean up: delete the workflow we just created. The delete (X)
    // button is opacity-0 group-hover:opacity-100, which means hover
    // visibility — Playwright's click() waits for actionability and
    // hover isn't always sticky in headless. Force-click bypasses
    // the visibility check; the click handler still fires.
    await groupRow.hover()
    await groupRow.getByTitle('Delete workflow').click({ force: true })

    // Wait for the confirmation modal to appear before clicking Delete.
    const modal = page.locator('.fixed.inset-0').filter({ hasText: 'This cannot be undone.' })
    await expect(modal).toBeVisible()

    // Synchronize on the DELETE response so the list update has landed
    // before we assert the row is gone.
    const deletePromise = page.waitForResponse(
      (r) => r.url().includes('/api/workflows/') && r.request().method() === 'DELETE',
    )
    await modal.getByRole('button', { name: 'Delete' }).click()
    await deletePromise

    // The workflow should no longer appear in the LEFT-PANE LIST.
    await expect(page.locator('.group').filter({ hasText: name })).toHaveCount(0, {
      timeout: 10_000,
    })
  })

  test('workflow editor shows Add Step button', async ({ page }) => {
    await goToWorkflows(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()

    await page.getByPlaceholder('my-workflow').fill('temp-step-test')
    await expect(page.getByRole('button', { name: /Add Step/ })).toBeVisible()
  })

  test('Add Step menu shows step type options', async ({ page }) => {
    await goToWorkflows(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()

    await page.getByRole('button', { name: /Add Step/ }).click()

    // The dropdown should show the four step types. Use exact:true on
    // 'skill' so it doesn't collide with the header tab "Skills" or the
    // "Export as Skill /..." button.
    await expect(page.getByRole('button', { name: 'skill', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'agent', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'instruction', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'command', exact: true })).toBeVisible()
  })

  test('Export as Skill button is disabled for unsaved (new) workflows', async ({ page }) => {
    await goToWorkflows(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()

    await page.getByPlaceholder('my-workflow').fill('unsaved-export-test')

    // Export button should be disabled until the workflow has been saved
    const exportBtn = page.getByRole('button', { name: /Export as Skill/ })
    await expect(exportBtn).toBeDisabled()
  })

  test('create workflow then export as skill', async ({ page }) => {
    const name = `test-wf-exp-${Date.now()}`
    await goToWorkflows(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()

    await page.getByPlaceholder('my-workflow').fill(name)

    // Synchronize on the POST /api/workflows response before asserting
    // on the Export button. Under parallel workers, the default
    // Playwright click→expect pipeline races against the client's
    // setIsNew(false) state update, leaving the Export button stuck
    // disabled with title="Save first before exporting".
    const postPromise = page.waitForResponse(
      (r) => r.url().endsWith('/api/workflows') && r.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'Save' }).click()
    await postPromise

    // Wait for the workflow to actually appear in the list — that's
    // the reliable "save finished + refetch landed" signal.
    await expect(page.locator('.group').filter({ hasText: name })).toBeVisible({ timeout: 20_000 })

    // After save the workflow is persisted; Export button should now be enabled
    const exportBtn = page.getByRole('button', { name: new RegExp(`Export as Skill /${name}`) })
    await expect(exportBtn).toBeEnabled()

    await exportBtn.click()

    // Either success message or conflict message should appear
    const successMsg = page.getByText(new RegExp(`Exported as`))
    const conflictMsg = page.getByText(new RegExp(`already exists`))
    await expect(successMsg.or(conflictMsg)).toBeVisible()

    // Clean up: delete the workflow
    const groupRow = page.locator('.group').filter({ hasText: name })
    await groupRow.hover()
    await groupRow.getByTitle('Delete workflow').click({ force: true })

    const modal = page.locator('.fixed.inset-0').filter({ hasText: 'This cannot be undone.' })
    await expect(modal).toBeVisible()

    const deletePromise = page.waitForResponse(
      (r) => r.url().includes('/api/workflows/') && r.request().method() === 'DELETE',
    )
    await modal.getByRole('button', { name: 'Delete' }).click()
    await deletePromise

    await expect(page.locator('.group').filter({ hasText: name })).toHaveCount(0, {
      timeout: 10_000,
    })
  })
})
