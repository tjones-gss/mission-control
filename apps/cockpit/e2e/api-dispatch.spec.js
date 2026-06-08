import { test, expect } from '@playwright/test'

// Pure backend shape/validation tests for the dispatch surface.
//
// These used to live at the bottom of dispatch.spec.js but ran as
// page.evaluate(fetch(...)) from the dashboard, which piled onto the
// ~6 useApi calls that mount fires on first paint and produced
// head-of-line blocking past the 60s timeout when the full suite
// ran under 2 workers (see playwright.config.js comments).
//
// Moved to a dedicated API-only spec file so Playwright schedules
// them the same way as api-validation.spec.js / api-sessions-name.spec.js
// — i.e. not interleaved with UI tests hammering the same server on the
// same worker. They hit the backend directly via APIRequestContext and
// do not touch a browser page.

const API = 'http://localhost:3001'

// State-changing routes are protected by the server's originGuard (CSRF
// defense): a POST/PUT/DELETE is rejected with 403 forbidden_origin unless it
// carries an Origin in the client allowlist (or a valid API key). A real
// browser client always sends its Origin; the APIRequestContext does not, so
// pin it to the cockpit's own client origin to exercise the routes as the
// dashboard does.
test.use({ extraHTTPHeaders: { Origin: 'http://localhost:5173' } })

test.describe('api: dispatch surface', () => {
  test('GET /api/managers returns correct shape', async ({ request }) => {
    const res = await request.get(`${API}/api/managers`)
    expect(res.ok()).toBeTruthy()
    const resp = await res.json()
    expect(resp).toHaveProperty('managers')
    expect(resp).toHaveProperty('standalone')
    expect(Array.isArray(resp.managers)).toBe(true)
    expect(Array.isArray(resp.standalone)).toBe(true)
  })

  test('POST to nonexistent session returns 404', async ({ request }) => {
    const res = await request.post(`${API}/api/sessions/nonexistent-id/message`, {
      data: { message: 'test' },
    })
    expect(res.status()).toBe(404)
  })

  test('POST with empty message returns 400', async ({ request }) => {
    const sessionsRes = await request.get(`${API}/api/sessions`)
    expect(sessionsRes.ok()).toBeTruthy()
    const sessions = await sessionsRes.json()
    if (sessions.length === 0) return
    const sid = sessions[0].sessionId
    const res = await request.post(`${API}/api/sessions/${sid}/message`, {
      data: { message: '' },
    })
    expect(res.status()).toBe(400)
  })
})
