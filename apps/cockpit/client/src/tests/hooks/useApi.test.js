import { renderHook, act, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { useApi } from '../../hooks/useApi.js'

describe('useApi', () => {
  afterEach(() => localStorage.clear())

  it('sends no Authorization header when no token is stored', async () => {
    let seenAuth = 'unset'
    server.use(
      http.get('/api/test', ({ request }) => {
        seenAuth = request.headers.get('authorization')
        return HttpResponse.json({ ok: true })
      }),
    )
    const { result } = renderHook(() => useApi('/api/test'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(seenAuth).toBeNull()
  })

  it('sends Authorization: Bearer <token> when a token is stored', async () => {
    localStorage.setItem('mc_auth_token', 'tok-xyz')
    let seenAuth = null
    server.use(
      http.get('/api/test', ({ request }) => {
        seenAuth = request.headers.get('authorization')
        return HttpResponse.json({ ok: true })
      }),
    )
    const { result } = renderHook(() => useApi('/api/test'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(seenAuth).toBe('Bearer tok-xyz')
  })

  it('url=null → no fetch, loading=false, data=null', () => {
    const { result } = renderHook(() => useApi(null))
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toBeNull()
  })

  it('initial loading state is true when url is provided', () => {
    server.use(
      http.get('/api/test', async () => {
        // Delay so we can check loading=true before it resolves
        await new Promise((r) => setTimeout(r, 50))
        return HttpResponse.json({ items: [] })
      }),
    )
    const { result } = renderHook(() => useApi('/api/test'))
    expect(result.current.loading).toBe(true)
  })

  it('fetches data on mount', async () => {
    server.use(http.get('/api/test', () => HttpResponse.json({ items: [1, 2, 3] })))
    const { result } = renderHook(() => useApi('/api/test'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual({ items: [1, 2, 3] })
    expect(result.current.error).toBeNull()
  })

  it('sets error on non-ok response using body.error field', async () => {
    server.use(
      http.get('/api/test', () => HttpResponse.json({ error: 'Not found' }, { status: 404 })),
    )
    const { result } = renderHook(() => useApi('/api/test'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Not found')
    expect(result.current.data).toBeNull()
  })

  it('sets error on non-ok response using body.detail field (takes priority)', async () => {
    server.use(
      http.get('/api/test', () =>
        HttpResponse.json({ detail: 'Validation failed', error: 'Bad request' }, { status: 422 }),
      ),
    )
    const { result } = renderHook(() => useApi('/api/test'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Validation failed')
    expect(result.current.data).toBeNull()
  })

  it('falls back to HTTP status message when body has no detail/error', async () => {
    server.use(http.get('/api/test', () => new HttpResponse(null, { status: 500 })))
    const { result } = renderHook(() => useApi('/api/test'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('HTTP 500')
    expect(result.current.data).toBeNull()
  })

  it('sets error on network failure', async () => {
    server.use(http.get('/api/test', () => HttpResponse.error()))
    const { result } = renderHook(() => useApi('/api/test'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeTruthy()
    expect(result.current.data).toBeNull()
  })

  it('refetch() triggers a new fetch and updates data', async () => {
    let callCount = 0
    server.use(
      http.get('/api/test', () => {
        callCount++
        return HttpResponse.json({ count: callCount })
      }),
    )

    const { result } = renderHook(() => useApi('/api/test'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual({ count: 1 })

    // Trigger refetch
    act(() => {
      result.current.refetch()
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual({ count: 2 })
    expect(callCount).toBe(2)
  })

  it('clears error on successful refetch after prior error', async () => {
    let shouldFail = true
    server.use(
      http.get('/api/test', () => {
        if (shouldFail) {
          return HttpResponse.json({ error: 'Temporary failure' }, { status: 503 })
        }
        return HttpResponse.json({ ok: true })
      }),
    )

    const { result } = renderHook(() => useApi('/api/test'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Temporary failure')

    shouldFail = false
    act(() => {
      result.current.refetch()
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeNull()
    expect(result.current.data).toEqual({ ok: true })
  })
})
