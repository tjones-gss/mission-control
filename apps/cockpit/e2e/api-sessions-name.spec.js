import { test, expect } from '@playwright/test'

// API-level tests for the session display-name endpoints added in
// Run #30 + Run #31. These bypass the UI since renaming requires an
// interactive session selection, but they exercise the same code
// paths that the dashboard's clear-name button hits.

const API = 'http://localhost:3001'

// State-changing routes are Origin-pinned by the server's originGuard (CSRF
// defense) — a POST without an allowlisted Origin gets 403. The browser client
// always sends one; the APIRequestContext does not, so pin it to the cockpit's
// own client origin.
test.use({ extraHTTPHeaders: { Origin: 'http://localhost:5173' } })

// Serial mode: all of these tests hit the shared session-names.json
// file (which the server keeps in an in-memory cache + rewrites on
// mutation). Running them in parallel produces last-write-wins races
// that cause false 404s on the "second delete" assertion.
test.describe.configure({ mode: 'serial' })

test.describe('api: session display names', () => {
  // Each test uses its own synthetic session id so they can run in
  // parallel without clobbering each other.
  function freshSessionId() {
    return `e2e-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  test('POST /api/sessions/:id/name rejects empty string', async ({ request }) => {
    const res = await request.post(`${API}/api/sessions/${freshSessionId()}/name`, {
      data: { name: '' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/sessions/:id/name rejects names longer than 80 chars', async ({ request }) => {
    const sid = freshSessionId()
    const tooLong = 'x'.repeat(81)
    const res = await request.post(`${API}/api/sessions/${sid}/name`, {
      data: { name: tooLong },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/too long/i)
  })

  test('POST accepts exactly 80 chars', async ({ request }) => {
    const sid = freshSessionId()
    const maxLen = 'a'.repeat(80)
    try {
      const res = await request.post(`${API}/api/sessions/${sid}/name`, {
        data: { name: maxLen },
      })
      expect(res.ok()).toBe(true)
      const body = await res.json()
      expect(body.displayName).toBe(maxLen)
    } finally {
      await request.delete(`${API}/api/sessions/${sid}/name`).catch(() => {})
    }
  })

  test('DELETE /api/sessions/:id/name removes a previously-set name', async ({ request }) => {
    const sid = freshSessionId()
    // First set a name
    const setRes = await request.post(`${API}/api/sessions/${sid}/name`, {
      data: { name: 'my-custom-name' },
    })
    expect(setRes.ok()).toBe(true)

    // Then delete it
    const delRes = await request.delete(`${API}/api/sessions/${sid}/name`)
    expect(delRes.ok()).toBe(true)

    // Second delete returns 404 (already cleared)
    const delRes2 = await request.delete(`${API}/api/sessions/${sid}/name`)
    expect(delRes2.status()).toBe(404)
  })

  test('DELETE on a session with no custom name responds with 404', async ({ request }) => {
    const res = await request.delete(`${API}/api/sessions/${freshSessionId()}/name`)
    expect(res.status()).toBe(404)
  })
})
