import { test, expect } from '@playwright/test'
import { revealAdvanced } from './helpers.js'

test.describe('navigation', () => {
  test('app loads and shows header', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Oversight')).toBeVisible()
    await expect(page.getByText('behind the agent curtain')).toBeVisible()
  })

  test('all tabs are rendered in the header', async ({ page }) => {
    await page.goto('/')
    // Agents and Tasks are Core tabs (always visible). Workflows and Skills are
    // Advanced tabs, only rendered once Advanced is revealed (progressive
    // disclosure — see App.jsx).
    await expect(page.getByRole('button', { name: 'Agents' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Tasks' })).toBeVisible()
    await revealAdvanced(page)
    await expect(page.getByRole('button', { name: 'Workflows' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Skills' })).toBeVisible()
  })

  test('Agents tab is active by default', async ({ page }) => {
    await page.goto('/')
    // The active tab carries the themed active-surface class (token layer).
    const agentsBtn = page.getByRole('button', { name: 'Agents' })
    await expect(agentsBtn).toBeVisible()
    await expect(agentsBtn).toHaveClass(/--mc-surface-2/)
  })

  test('can switch to Workflows tab', async ({ page }) => {
    await page.goto('/')
    await revealAdvanced(page)
    await page.getByRole('button', { name: 'Workflows' }).click()
    // The Workflows panel has a "Workflows" heading in its left sidebar
    await expect(page.getByRole('button', { name: 'Workflows' })).toHaveClass(/--mc-surface-2/)
    // WorkflowsPanel renders a "Workflows" label and a "New" button.
    // Use exact:true so we don't accidentally match the sidebar's
    // "New session" button which also contains "New".
    await expect(page.getByRole('button', { name: 'New', exact: true })).toBeVisible()
  })

  test('can switch to Skills tab', async ({ page }) => {
    await page.goto('/')
    await revealAdvanced(page)
    await page.getByRole('button', { name: 'Skills' }).click()
    await expect(page.getByRole('button', { name: 'Skills' })).toHaveClass(/--mc-surface-2/)
    // SkillsPanel early-returns "Loading skills..." until /api/skills
    // resolves. The synchronous filesystem scan can take 5-30s under
    // parallel-worker load (see skills.spec.js goToSkills for details).
    await expect(page.getByRole('button', { name: /New Skill/ })).toBeVisible({ timeout: 60_000 })
  })

  test('can switch to Tasks tab', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Tasks' }).click()
    await expect(page.getByRole('button', { name: 'Tasks' })).toHaveClass(/--mc-surface-2/)
  })

  test('can cycle through all tabs', async ({ page }) => {
    await page.goto('/')
    // Workflows and Skills are Advanced tabs; reveal them before cycling.
    await revealAdvanced(page)

    for (const tabName of ['Workflows', 'Skills', 'Tasks', 'Agents']) {
      // exact:true so 'Agents' doesn't also match session-card buttons
      // whose accessible name contains the word "agent" (e.g. project
      // "behind-the-agent-curtain") — strict-mode rejects multi-match.
      await page.getByRole('button', { name: tabName, exact: true }).click()
      await expect(page.getByRole('button', { name: tabName, exact: true })).toHaveClass(
        /--mc-surface-2/,
      )
    }
  })
})
