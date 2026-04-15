import { renderHook, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { useStreamingSession } from '../../hooks/useStreamingSession.js'

// Capture fetch calls via MSW request tracking
let capturedRequests = []

beforeEach(() => {
  capturedRequests = []

  // Default: query-status returns inactive
  server.use(
    http.get('/api/sessions/:sessionId/query-status', () => HttpResponse.json({ active: false })),
    http.post('/api/sessions/:sessionId/tool-approval', async ({ request }) => {
      capturedRequests.push({
        url: request.url,
        method: request.method,
        body: await request.json(),
      })
      return HttpResponse.json({ ok: true })
    }),
    http.post('/api/sessions/:sessionId/cancel', ({ request }) => {
      capturedRequests.push({ url: request.url, method: request.method })
      return HttpResponse.json({ ok: true })
    }),
  )
})

describe('useStreamingSession', () => {
  it('initial state: isStreaming=false, pendingApprovals=[], sdkError=null', async () => {
    const { result } = renderHook(() => useStreamingSession('sess-1'))
    await act(async () => {})
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.pendingApprovals).toEqual([])
    expect(result.current.sdkError).toBeNull()
  })

  it('handleSdkEvent sdk_message sets isStreaming=true', async () => {
    const { result } = renderHook(() => useStreamingSession('sess-1'))
    await act(async () => {})
    act(() => {
      result.current.handleSdkEvent({ type: 'sdk_message', data: { sessionId: 'sess-1' } })
    })
    expect(result.current.isStreaming).toBe(true)
  })

  it('handleSdkEvent tool_approval_request adds to pendingApprovals', async () => {
    const { result } = renderHook(() => useStreamingSession('sess-1'))
    await act(async () => {})
    act(() => {
      result.current.handleSdkEvent({
        type: 'tool_approval_request',
        data: { sessionId: 'sess-1', approvalId: 'a1', toolName: 'Bash', input: { command: 'ls' } },
      })
    })
    expect(result.current.pendingApprovals).toHaveLength(1)
    expect(result.current.pendingApprovals[0]).toEqual({
      approvalId: 'a1',
      toolName: 'Bash',
      input: { command: 'ls' },
    })
  })

  it('handleSdkEvent tool_approval_resolved removes from pendingApprovals', async () => {
    const { result } = renderHook(() => useStreamingSession('sess-1'))
    await act(async () => {})
    act(() => {
      result.current.handleSdkEvent({
        type: 'tool_approval_request',
        data: { sessionId: 'sess-1', approvalId: 'a1', toolName: 'Bash', input: {} },
      })
    })
    expect(result.current.pendingApprovals).toHaveLength(1)
    act(() => {
      result.current.handleSdkEvent({
        type: 'tool_approval_resolved',
        data: { sessionId: 'sess-1', approvalId: 'a1' },
      })
    })
    expect(result.current.pendingApprovals).toHaveLength(0)
  })

  it('handleSdkEvent sdk_result clears isStreaming, pendingApprovals, and sdkError', async () => {
    const { result } = renderHook(() => useStreamingSession('sess-1'))
    await act(async () => {})
    act(() => {
      result.current.handleSdkEvent({ type: 'sdk_message', data: { sessionId: 'sess-1' } })
    })
    act(() => {
      result.current.handleSdkEvent({
        type: 'tool_approval_request',
        data: { sessionId: 'sess-1', approvalId: 'a1', toolName: 'Read', input: {} },
      })
    })
    act(() => {
      result.current.handleSdkEvent({ type: 'sdk_result', data: { sessionId: 'sess-1' } })
    })
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.pendingApprovals).toEqual([])
    expect(result.current.sdkError).toBeNull()
  })

  it('handleSdkEvent sdk_error sets sdkError with message and errorType', async () => {
    const { result } = renderHook(() => useStreamingSession('sess-1'))
    await act(async () => {})
    act(() => {
      result.current.handleSdkEvent({
        type: 'sdk_error',
        data: { sessionId: 'sess-1', error: 'fail', errorType: 'query_failed' },
      })
    })
    expect(result.current.sdkError).toEqual({ message: 'fail', errorType: 'query_failed' })
    expect(result.current.isStreaming).toBe(false)
  })

  it('session change resets all state', async () => {
    const { result, rerender } = renderHook(({ id }) => useStreamingSession(id), {
      initialProps: { id: 'sess-1' },
    })
    await act(async () => {})
    act(() => {
      result.current.handleSdkEvent({ type: 'sdk_message', data: { sessionId: 'sess-1' } })
    })
    act(() => {
      result.current.handleSdkEvent({
        type: 'tool_approval_request',
        data: { sessionId: 'sess-1', approvalId: 'a1', toolName: 'Bash', input: {} },
      })
    })
    expect(result.current.isStreaming).toBe(true)
    expect(result.current.pendingApprovals).toHaveLength(1)

    await act(async () => {
      rerender({ id: 'sess-2' })
    })
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.pendingApprovals).toEqual([])
    expect(result.current.sdkError).toBeNull()
  })

  it('approve sends POST to tool-approval with decision=allow', async () => {
    const { result } = renderHook(() => useStreamingSession('sess-1'))
    await act(async () => {})
    await act(async () => {
      await result.current.approve('a1')
    })
    const req = capturedRequests.find((r) => r.url.includes('tool-approval'))
    expect(req).toBeDefined()
    expect(req.method).toBe('POST')
    expect(req.body).toEqual({ approvalId: 'a1', decision: 'allow' })
    expect(req.url).toContain('/api/sessions/sess-1/tool-approval')
  })

  it('deny sends POST to tool-approval with decision=deny', async () => {
    const { result } = renderHook(() => useStreamingSession('sess-1'))
    await act(async () => {})
    await act(async () => {
      await result.current.deny('a1')
    })
    const req = capturedRequests.find((r) => r.url.includes('tool-approval'))
    expect(req).toBeDefined()
    expect(req.method).toBe('POST')
    expect(req.body).toEqual({ approvalId: 'a1', decision: 'deny' })
    expect(req.url).toContain('/api/sessions/sess-1/tool-approval')
  })

  it('cancel sends POST to /api/sessions/{id}/cancel', async () => {
    const { result } = renderHook(() => useStreamingSession('sess-1'))
    await act(async () => {})
    await act(async () => {
      await result.current.cancel()
    })
    const req = capturedRequests.find((r) => r.url.includes('cancel'))
    expect(req).toBeDefined()
    expect(req.method).toBe('POST')
    expect(req.url).toContain('/api/sessions/sess-1/cancel')
  })

  it('markStreaming sets isStreaming=true', async () => {
    const { result } = renderHook(() => useStreamingSession('sess-1'))
    await act(async () => {})
    act(() => {
      result.current.markStreaming()
    })
    expect(result.current.isStreaming).toBe(true)
  })

  it('clearError sets sdkError=null', async () => {
    const { result } = renderHook(() => useStreamingSession('sess-1'))
    await act(async () => {})
    act(() => {
      result.current.handleSdkEvent({
        type: 'sdk_error',
        data: { sessionId: 'sess-1', error: 'oops', errorType: 'query_failed' },
      })
    })
    expect(result.current.sdkError).not.toBeNull()
    act(() => {
      result.current.clearError()
    })
    expect(result.current.sdkError).toBeNull()
  })

  it('events for a different sessionId are ignored', async () => {
    const { result } = renderHook(() => useStreamingSession('sess-1'))
    await act(async () => {})
    act(() => {
      result.current.handleSdkEvent({ type: 'sdk_message', data: { sessionId: 'sess-OTHER' } })
    })
    expect(result.current.isStreaming).toBe(false)
  })

  it('approve removes approval from local state on server 404', async () => {
    server.use(
      http.post('/api/sessions/:sessionId/tool-approval', () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 }),
      ),
    )
    const { result } = renderHook(() => useStreamingSession('sess-1'))
    await act(async () => {})
    act(() => {
      result.current.handleSdkEvent({
        type: 'tool_approval_request',
        data: { sessionId: 'sess-1', approvalId: 'a1', toolName: 'Bash', input: {} },
      })
    })
    expect(result.current.pendingApprovals).toHaveLength(1)
    await act(async () => {
      await result.current.approve('a1')
    })
    expect(result.current.pendingApprovals).toHaveLength(0)
  })

  it('deny removes approval from local state on network error', async () => {
    server.use(http.post('/api/sessions/:sessionId/tool-approval', () => HttpResponse.error()))
    const { result } = renderHook(() => useStreamingSession('sess-1'))
    await act(async () => {})
    act(() => {
      result.current.handleSdkEvent({
        type: 'tool_approval_request',
        data: { sessionId: 'sess-1', approvalId: 'a1', toolName: 'Bash', input: {} },
      })
    })
    expect(result.current.pendingApprovals).toHaveLength(1)
    await act(async () => {
      await result.current.deny('a1')
    })
    expect(result.current.pendingApprovals).toHaveLength(0)
  })

  it('resync on mount: fetches query-status and applies active state with pending approvals', async () => {
    const pendingApproval = { approvalId: 'b1', toolName: 'Write', input: { path: '/tmp/x' } }

    server.use(
      http.get('/api/sessions/sess-resync/query-status', () =>
        HttpResponse.json({ active: true, pendingApprovals: [pendingApproval] }),
      ),
    )

    const { result } = renderHook(() => useStreamingSession('sess-resync'))
    await act(async () => {})

    expect(result.current.isStreaming).toBe(true)
    expect(result.current.pendingApprovals).toEqual([pendingApproval])
  })
})
