import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// App is heavy (SSE, notifications, sound, streaming); stub those hooks but
// keep the real layout so the mobile drawer wiring is exercised end to end.
const h = vi.hoisted(() => ({ sessions: [] }))

vi.mock('../../hooks/useApi.js', () => ({
  useApi: (url) => ({
    data: url === '/api/sessions' ? h.sessions : null,
    loading: false,
    error: null,
    refetch: () => {},
  }),
}))
vi.mock('../../hooks/useSSE.js', () => ({ useSSE: () => ({ connected: true }) }))
vi.mock('../../hooks/useNotifications.js', () => ({
  useNotifications: () => ({
    requestPermission: () => {},
    muteSession: () => {},
    mutedIds: { current: new Set() },
  }),
  getNotificationPrefs: () => ({ sound: false, desktop: false }),
}))
vi.mock('../../hooks/useSound.js', () => ({ useSound: () => ({ play: () => {} }) }))
vi.mock('../../hooks/useStreamingSession.js', () => ({ useStreamingSession: () => ({}) }))

import App from '../../App.jsx'

const SESSIONS = [
  {
    sessionId: 'sess-1',
    slug: 'alpha',
    cwd: 'C:/work/alpha',
    isActive: true,
    needsInput: false,
    lastModified: Date.now(),
  },
]

beforeEach(() => {
  localStorage.clear()
  h.sessions = SESSIONS
})

describe('App — mobile-responsive drawers', () => {
  it('opens the Sessions sidebar as a drawer from the header toggle', async () => {
    render(<App />)
    expect(screen.queryByRole('dialog', { name: /^sessions$/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /open sessions/i }))
    expect(screen.getByRole('dialog', { name: /^sessions$/i })).toBeInTheDocument()
  })

  it('opens the activity feed as a drawer from the header toggle', () => {
    render(<App />)
    expect(screen.queryByRole('dialog', { name: /activity feed/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /open activity feed/i }))
    expect(screen.getByRole('dialog', { name: /activity feed/i })).toBeInTheDocument()
  })

  it('closes the sessions drawer on Escape', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /open sessions/i }))
    expect(screen.getByRole('dialog', { name: /^sessions$/i })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /^sessions$/i })).not.toBeInTheDocument(),
    )
  })
})
