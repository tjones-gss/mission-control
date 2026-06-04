import { http, HttpResponse } from 'msw'

export const handlers = [
  http.get('/api/workflows', () => HttpResponse.json([])),
  http.post('/api/workflows', () =>
    HttpResponse.json(
      { name: 'test', description: '', steps: [], createdAt: 0, updatedAt: 0 },
      { status: 201 },
    ),
  ),
  http.put('/api/workflows/:name', () =>
    HttpResponse.json({ name: 'test', description: '', steps: [], createdAt: 0, updatedAt: 0 }),
  ),
  http.delete('/api/workflows/:name', () => HttpResponse.json({ ok: true, name: 'test' })),
  http.post('/api/workflows/:name/export', () => HttpResponse.json({ ok: true })),
  http.post('/api/workflows/:name/run', () =>
    HttpResponse.json({ ok: true, status: 'started', sessionId: 'wf-sess-1' }, { status: 202 }),
  ),
  http.get('/api/skills', () =>
    HttpResponse.json({ userSkills: [], pluginSkills: [], plugins: [], totalSkillCount: 0 }),
  ),
  http.get('/api/skills/:name/raw', () => new HttpResponse('# skill content', { status: 200 })),
  http.put('/api/skills/:name', () => HttpResponse.json({ ok: true })),
  http.delete('/api/skills/:name', () => HttpResponse.json({ ok: true })),
  http.post('/api/skills', () => HttpResponse.json({ ok: true }, { status: 201 })),
  http.get('/api/managers', () =>
    HttpResponse.json({
      managers: [
        {
          id: '/home/me/projects',
          dir: '/home/me/projects',
          slug: 'projects',
          childCount: 2,
          activeCount: 1,
          idleCount: 0,
          doneCount: 1,
          needsInputCount: 0,
          totalCost: 3.5,
          lastModified: Date.now(),
          children: [
            {
              sessionId: 'sess-a',
              cwd: '/home/me/projects/repo-a',
              slug: 'repo-a',
              isActive: true,
              needsInput: false,
              lastModified: Date.now(),
              lastText: 'Working on feature X',
              model: 'claude-sonnet-4-6',
              permissionMode: 'default',
              estimatedCost: { totalCost: 2.0 },
            },
            {
              sessionId: 'sess-b',
              cwd: '/home/me/projects/repo-b',
              slug: 'repo-b',
              isActive: false,
              needsInput: false,
              lastModified: Date.now() - 5 * 60 * 60 * 1000,
              lastText: 'Completed migration',
              model: 'claude-sonnet-4-6',
              permissionMode: 'auto',
              estimatedCost: { totalCost: 1.5 },
            },
          ],
        },
      ],
      standalone: [],
    }),
  ),
  http.get('/api/sessions', () => HttpResponse.json([])),
  http.get('/api/tasks', () => HttpResponse.json([])),
  http.get('/api/sessions/:sessionId/messages', () =>
    HttpResponse.json({ sessionId: 'test', messages: [] }),
  ),
  http.post('/api/sessions/:sessionId/message', () =>
    HttpResponse.json({ ok: true, streaming: true }, { status: 202 }),
  ),

  // Teams
  http.get('/api/teams', () => HttpResponse.json([])),
  http.post('/api/teams/:name/inbox', () =>
    HttpResponse.json(
      {
        id: 'mock-id',
        sender: 'user',
        content: 'test',
        timestamp: new Date().toISOString(),
        read: false,
        archived: false,
      },
      { status: 201 },
    ),
  ),
  http.patch('/api/teams/:name/inbox/:messageId', () =>
    HttpResponse.json({
      id: 'mock-id',
      sender: 'user',
      content: 'test',
      timestamp: new Date().toISOString(),
      read: true,
      archived: false,
    }),
  ),

  // History
  http.get('/api/history', () => HttpResponse.json([])),
  http.get('/api/history/stats', () =>
    HttpResponse.json({
      total: 0,
      topCommand: null,
      topProject: null,
      today: 0,
      dailyActivity: [],
    }),
  ),

  // Tasks
  http.get('/api/tasks/:sessionId', () => HttpResponse.json([])),
  http.post('/api/tasks/:sessionId', () =>
    HttpResponse.json({ id: '1', subject: 'test', status: 'pending' }, { status: 201 }),
  ),
  http.put('/api/tasks/:sessionId/:taskId', () =>
    HttpResponse.json({ id: '1', subject: 'updated', status: 'pending' }),
  ),
  http.delete('/api/tasks/:sessionId/:taskId', () => HttpResponse.json({ ok: true })),

  // Session actions
  http.post('/api/sessions/:sessionId/fork', () =>
    HttpResponse.json({ ok: true }, { status: 201 }),
  ),
  http.post('/api/sessions/:sessionId/name', () => HttpResponse.json({ ok: true })),
  http.post('/api/sessions/:sessionId/skill', () =>
    HttpResponse.json({ ok: true }, { status: 202 }),
  ),
  http.get('/api/sessions/:sessionId/intelligence', () =>
    HttpResponse.json({
      goal: 'test goal',
      progress: 'in progress',
      flags: [],
      subagents: 'none',
      recommendation: null,
      analyzedAt: Date.now(),
    }),
  ),
]
