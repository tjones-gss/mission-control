import { http, HttpResponse } from 'msw'

export const handlers = [
  http.get('/api/workflows', () => HttpResponse.json([])),
  http.post('/api/workflows', () => HttpResponse.json({ name: 'test', description: '', steps: [], createdAt: 0, updatedAt: 0 }, { status: 201 })),
  http.put('/api/workflows/:name', () => HttpResponse.json({ name: 'test', description: '', steps: [], createdAt: 0, updatedAt: 0 })),
  http.delete('/api/workflows/:name', () => HttpResponse.json({ ok: true, name: 'test' })),
  http.post('/api/workflows/:name/export', () => HttpResponse.json({ ok: true })),
  http.get('/api/skills', () => HttpResponse.json({ userSkills: [], pluginSkills: [], plugins: [], totalSkillCount: 0 })),
  http.get('/api/skills/:name/raw', () => new HttpResponse('# skill content', { status: 200 })),
  http.put('/api/skills/:name', () => HttpResponse.json({ ok: true })),
  http.delete('/api/skills/:name', () => HttpResponse.json({ ok: true })),
  http.post('/api/skills', () => HttpResponse.json({ ok: true }, { status: 201 })),
  http.get('/api/sessions', () => HttpResponse.json([])),
  http.get('/api/tasks', () => HttpResponse.json([])),
  http.get('/api/sessions/:sessionId/messages', () => HttpResponse.json({ sessionId: 'test', messages: [] })),
  http.post('/api/sessions/:sessionId/message', () => HttpResponse.json({ ok: true, streaming: true }, { status: 202 })),
]
