import { test, expect } from '@playwright/test'

// API-level tests for the task routes. The key bug fix to cover is
// Run #29's read-modify-write PUT: a partial PUT like { status: ... }
// must preserve subject/description/owner from the existing record
// instead of blowing them away to empty strings.

const API = 'http://localhost:3001'

// Each test block gets its own session id so parallel workers never
// step on each other's task files.
function freshSessionId() {
  return `e2e-tasks-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function cleanupSession(request, sessionId) {
  // Best-effort cleanup: list tasks, delete each. If the session has
  // no tasks, this is a no-op.
  try {
    const listRes = await request.get(`${API}/api/tasks/${sessionId}`)
    if (!listRes.ok()) return
    const tasks = await listRes.json()
    for (const task of tasks) {
      await request.delete(`${API}/api/tasks/${sessionId}/${task.id}`).catch(() => {})
    }
  } catch {
    /* ignore */
  }
}

test.describe('api: tasks CRUD', () => {
  test('POST creates a task with a generated id', async ({ request }) => {
    const sessionId = freshSessionId()
    try {
      const res = await request.post(`${API}/api/tasks/${sessionId}`, {
        data: { subject: 'Initial task', description: 'from e2e' },
      })
      expect(res.status()).toBe(201)
      const task = await res.json()
      expect(task.id).toBeDefined()
      expect(task.subject).toBe('Initial task')
      expect(task.description).toBe('from e2e')
      expect(task.status).toBe('pending')
    } finally {
      await cleanupSession(request, sessionId)
    }
  })

  test('POST rejects empty subject', async ({ request }) => {
    const sessionId = freshSessionId()
    const res = await request.post(`${API}/api/tasks/${sessionId}`, {
      data: { subject: '' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST rejects missing subject', async ({ request }) => {
    const sessionId = freshSessionId()
    const res = await request.post(`${API}/api/tasks/${sessionId}`, {
      data: { description: 'no subject' },
    })
    expect(res.status()).toBe(400)
  })

  test('partial PUT preserves existing subject/description (Run #29 fix)', async ({ request }) => {
    const sessionId = freshSessionId()
    try {
      // 1. Create a fully-populated task
      const createRes = await request.post(`${API}/api/tasks/${sessionId}`, {
        data: {
          subject: 'Original subject',
          description: 'Original description',
          owner: 'alice',
        },
      })
      expect(createRes.status()).toBe(201)
      const created = await createRes.json()

      // 2. Partial PUT with ONLY the status field
      const putRes = await request.put(`${API}/api/tasks/${sessionId}/${created.id}`, {
        data: { status: 'in_progress' },
      })
      expect(putRes.ok()).toBe(true)
      const updated = await putRes.json()

      // 3. Subject, description, owner must be preserved — the bug
      //    was that they got silently wiped to ''.
      expect(updated.status).toBe('in_progress')
      expect(updated.subject).toBe('Original subject')
      expect(updated.description).toBe('Original description')
      expect(updated.owner).toBe('alice')
    } finally {
      await cleanupSession(request, sessionId)
    }
  })

  test('full PUT replaces named fields, preserves unnamed ones', async ({ request }) => {
    const sessionId = freshSessionId()
    try {
      const createRes = await request.post(`${API}/api/tasks/${sessionId}`, {
        data: {
          subject: 'Task A',
          description: 'desc A',
          owner: 'bob',
        },
      })
      const created = await createRes.json()

      const putRes = await request.put(`${API}/api/tasks/${sessionId}/${created.id}`, {
        data: {
          subject: 'Task B',
          description: 'desc B',
          status: 'completed',
        },
      })
      const updated = await putRes.json()
      expect(updated.subject).toBe('Task B')
      expect(updated.description).toBe('desc B')
      expect(updated.status).toBe('completed')
      // owner wasn't in the PUT body — should be preserved
      expect(updated.owner).toBe('bob')
    } finally {
      await cleanupSession(request, sessionId)
    }
  })

  test('PUT on nonexistent task returns 404', async ({ request }) => {
    const sessionId = freshSessionId()
    const res = await request.put(`${API}/api/tasks/${sessionId}/999`, {
      data: { status: 'pending' },
    })
    expect(res.status()).toBe(404)
  })

  test('DELETE removes a task', async ({ request }) => {
    const sessionId = freshSessionId()
    const createRes = await request.post(`${API}/api/tasks/${sessionId}`, {
      data: { subject: 'Will be deleted' },
    })
    const created = await createRes.json()
    const delRes = await request.delete(`${API}/api/tasks/${sessionId}/${created.id}`)
    expect(delRes.ok()).toBe(true)

    // Subsequent PUT should 404
    const putRes = await request.put(`${API}/api/tasks/${sessionId}/${created.id}`, {
      data: { status: 'pending' },
    })
    expect(putRes.status()).toBe(404)
  })
})
