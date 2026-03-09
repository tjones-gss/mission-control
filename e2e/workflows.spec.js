import { test, expect } from '@playwright/test'

async function goToWorkflows(page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Workflows' }).click()
}

test.describe('workflows', () => {
  test('navigate to workflows tab shows panel', async ({ page }) => {
    await goToWorkflows(page)
    // The left panel always shows the "Workflows" section label
    await expect(page.locator('text=Workflows').first()).toBeVisible()
    // The New button is always present at the bottom of the left panel
    await expect(page.getByRole('button', { name: /New/ })).toBeVisible()
  })

  test('empty state shows placeholder text', async ({ page }) => {
    await goToWorkflows(page)
    // When no workflow is selected, the right panel shows this message
    await expect(page.getByText('Select a workflow or create a new one.')).toBeVisible()
  })

  test('clicking New opens a blank editor', async ({ page }) => {
    await goToWorkflows(page)
    await page.getByRole('button', { name: /New/ }).click()

    // The right panel should now show a Name field and a Description field
    await expect(page.getByPlaceholder('my-workflow')).toBeVisible()
    await expect(page.getByPlaceholder('What this workflow does…')).toBeVisible()

    // The Save button should be present (disabled when name is empty)
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible()
  })

  test('Save button is disabled when name is empty', async ({ page }) => {
    await goToWorkflows(page)
    await page.getByRole('button', { name: /New/ }).click()

    const saveBtn = page.getByRole('button', { name: 'Save' })
    await expect(saveBtn).toBeDisabled()
  })

  test('Save button becomes enabled after entering a name', async ({ page }) => {
    await goToWorkflows(page)
    await page.getByRole('button', { name: /New/ }).click()

    await page.getByPlaceholder('my-workflow').fill('test-wf-preview')
    const saveBtn = page.getByRole('button', { name: 'Save' })
    await expect(saveBtn).toBeEnabled()
  })

  test('create a new workflow and verify it appears in the list', async ({ page }) => {
    const name = `test-wf-${Date.now()}`
    await goToWorkflows(page)
    await page.getByRole('button', { name: /New/ }).click()

    await page.getByPlaceholder('my-workflow').fill(name)
    await page.getByPlaceholder('What this workflow does…').fill('Created by E2E test')

    await page.getByRole('button', { name: 'Save' }).click()

    // After save the workflow should appear in the left panel list
    await expect(page.getByText(name)).toBeVisible()

    // Clean up: delete the workflow we just created
    // Hover over the list item to reveal the delete (X) button
    const listItem = page.locator(`text=${name}`).first()
    await listItem.hover()
    const deleteBtn = page.locator('.group').filter({ hasText: name }).getByTitle('Delete workflow')
    await deleteBtn.click()

    // Confirm deletion in the modal
    await page.getByRole('button', { name: 'Delete' }).click()

    // The workflow should no longer appear in the list
    await expect(page.getByText(name)).not.toBeVisible()
  })

  test('workflow editor shows Add Step button', async ({ page }) => {
    await goToWorkflows(page)
    await page.getByRole('button', { name: /New/ }).click()

    await page.getByPlaceholder('my-workflow').fill('temp-step-test')
    await expect(page.getByRole('button', { name: /Add Step/ })).toBeVisible()
  })

  test('Add Step menu shows step type options', async ({ page }) => {
    await goToWorkflows(page)
    await page.getByRole('button', { name: /New/ }).click()

    await page.getByRole('button', { name: /Add Step/ }).click()

    // The dropdown should show the four step types
    await expect(page.getByRole('button', { name: 'skill' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'agent' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'instruction' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'command' })).toBeVisible()
  })

  test('Export as Skill button is disabled for unsaved (new) workflows', async ({ page }) => {
    await goToWorkflows(page)
    await page.getByRole('button', { name: /New/ }).click()

    await page.getByPlaceholder('my-workflow').fill('unsaved-export-test')

    // Export button should be disabled until the workflow has been saved
    const exportBtn = page.getByRole('button', { name: /Export as Skill/ })
    await expect(exportBtn).toBeDisabled()
  })

  test('create workflow then export as skill', async ({ page }) => {
    const name = `test-wf-exp-${Date.now()}`
    await goToWorkflows(page)
    await page.getByRole('button', { name: /New/ }).click()

    await page.getByPlaceholder('my-workflow').fill(name)
    await page.getByRole('button', { name: 'Save' }).click()

    // After save the workflow is persisted; Export button should now be enabled
    const exportBtn = page.getByRole('button', { name: new RegExp(`Export as Skill /${name}`) })
    await expect(exportBtn).toBeEnabled()

    await exportBtn.click()

    // Either success message or conflict message should appear
    const successMsg = page.getByText(new RegExp(`Exported as`))
    const conflictMsg = page.getByText(new RegExp(`already exists`))
    await expect(successMsg.or(conflictMsg)).toBeVisible()

    // Clean up: delete the workflow
    const listItem = page.locator(`text=${name}`).first()
    await listItem.hover()
    const deleteBtn = page.locator('.group').filter({ hasText: name }).getByTitle('Delete workflow')
    await deleteBtn.click()
    await page.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText(name)).not.toBeVisible()
  })
})
