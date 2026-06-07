import { expect } from '@playwright/test'

// Workflows, Skills, and Teams are "Advanced" tabs hidden behind a persisted
// toggle (localStorage 'mc.showAdvanced', default off — see the progressive-
// disclosure block in App.jsx). A fresh browser (every CI run, no stored
// preference) renders only the Core tabs, so the advanced tab buttons don't
// exist until Advanced is revealed. Call this after page.goto('/') before
// interacting with an advanced tab.
//
// Idempotent: only clicks when the toggle is currently off, so it's safe even
// if a persisted preference already had Advanced on.
export async function revealAdvanced(page) {
  const toggle = page.getByRole('button', { name: 'Advanced' })
  await toggle.waitFor({ state: 'visible' })
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
    await toggle.click()
  }
  // Confirm it stuck so callers can immediately query the advanced tabs.
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
}
