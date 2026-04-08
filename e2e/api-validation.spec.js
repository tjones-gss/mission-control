import { test, expect } from '@playwright/test'

// API-level validation tests for the tightened skill/workflow name
// rules (Run #30). These assert the backend rejects the specific
// inputs that previously caused 500s instead of clean 400s.

const API = 'http://localhost:3001'

test.describe('api: skill name validation', () => {
  test('rejects names starting with a hyphen', async ({ request }) => {
    const res = await request.post(`${API}/api/skills`, {
      data: { name: '-leading-dash', content: 'body' },
    })
    expect(res.status()).toBe(400)
  })

  test('rejects names that are pure punctuation', async ({ request }) => {
    const res = await request.post(`${API}/api/skills`, {
      data: { name: '___', content: 'body' },
    })
    expect(res.status()).toBe(400)
  })

  test('rejects names over 100 characters', async ({ request }) => {
    const tooLong = 'a'.repeat(101)
    const res = await request.post(`${API}/api/skills`, {
      data: { name: tooLong, content: 'body' },
    })
    expect(res.status()).toBe(400)
  })

  test('rejects names containing colons (reserved on Windows)', async ({ request }) => {
    const res = await request.post(`${API}/api/skills`, {
      data: { name: 'plugin:skill', content: 'body' },
    })
    expect(res.status()).toBe(400)
  })

  test('rejects Windows reserved names (CON, PRN, etc.)', async ({ request }) => {
    const res = await request.post(`${API}/api/skills`, {
      data: { name: 'CON', content: 'body' },
    })
    expect(res.status()).toBe(400)
  })

  test('rejects names with slashes (path traversal guard)', async ({ request }) => {
    const res = await request.post(`${API}/api/skills`, {
      data: { name: '../escape', content: 'body' },
    })
    expect(res.status()).toBe(400)
  })
})

test.describe('api: workflow name validation', () => {
  test('rejects names starting with a hyphen', async ({ request }) => {
    const res = await request.post(`${API}/api/workflows`, {
      data: { name: '-leading-dash' },
    })
    expect(res.status()).toBe(400)
  })

  test('rejects names that are pure punctuation', async ({ request }) => {
    const res = await request.post(`${API}/api/workflows`, {
      data: { name: '---' },
    })
    expect(res.status()).toBe(400)
  })

  test('rejects names over 100 characters', async ({ request }) => {
    const tooLong = 'a'.repeat(101)
    const res = await request.post(`${API}/api/workflows`, {
      data: { name: tooLong },
    })
    expect(res.status()).toBe(400)
  })

  test('rejects Windows reserved names', async ({ request }) => {
    const res = await request.post(`${API}/api/workflows`, {
      data: { name: 'NUL' },
    })
    expect(res.status()).toBe(400)
  })

  test('accepts valid names and returns 201', async ({ request }) => {
    const name = `valid-wf-${Date.now()}`
    try {
      const res = await request.post(`${API}/api/workflows`, {
        data: { name, description: 'test' },
      })
      expect(res.status()).toBe(201)
      const body = await res.json()
      expect(body.name).toBe(name)
    } finally {
      await request.delete(`${API}/api/workflows/${name}`).catch(() => {})
    }
  })
})
