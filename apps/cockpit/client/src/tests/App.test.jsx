import { render, screen, fireEvent } from '@testing-library/react'

// First-run L2 proof: with zero sessions the Agents panel shows the Welcome hero
// (not a blank board); with sessions it shows the board; while loading (null) it
// shows neither. App is heavy (SSE, notifications, sound, streaming), so those
// hooks are stubbed — only the sessions data + the empty-state decision matter.
const h = vi.hoisted(() => ({ sessions: [] }))

vi.mock('../hooks/useApi.js', () => ({
  useApi: (url) => ({
    data: url === '/api/sessions' ? h.sessions : null,
    loading: false,
    error: null,
    refetch: () => {},
  }),
}))
vi.mock('../hooks/useSSE.js', () => ({ useSSE: () => ({ connected: true }) }))
vi.mock('../hooks/useNotifications.js', () => ({
  useNotifications: () => ({
    requestPermission: () => {},
    muteSession: () => {},
    mutedIds: { current: new Set() },
  }),
  getNotificationPrefs: () => ({ sound: false, desktop: false }),
}))
vi.mock('../hooks/useSound.js', () => ({ useSound: () => ({ play: () => {} }) }))
vi.mock('../hooks/useStreamingSession.js', () => ({ useStreamingSession: () => ({}) }))
vi.mock('../hooks/useKeyboardShortcuts.js', () => ({
  useKeyboardShortcuts: () => ({
    shortcuts: {},
    updateShortcut: () => {},
    resetDefaults: () => {},
  }),
}))

import App from '../App.jsx'

function renderApp(sessions) {
  h.sessions = sessions
  return render(<App />)
}

describe('App first-run (empty front door)', () => {
  it('shows the Welcome hero when there are zero sessions', () => {
    renderApp([])
    expect(screen.getByText(/Welcome to Mission Control/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /start your first agent/i })).toBeInTheDocument()
  })

  it('clicking the CTA opens the New Session form', () => {
    renderApp([])
    fireEvent.click(screen.getByRole('button', { name: /start your first agent/i }))
    // NewSessionForm appears — assert its working-directory field is present.
    expect(screen.getAllByPlaceholderText(/working directory/i).length).toBeGreaterThan(0)
  })

  it('shows the board (no hero) when sessions exist', () => {
    renderApp([{ sessionId: 's1', slug: 'demo', cwd: 'C:/proj', isActive: true, model: 'opus' }])
    expect(screen.queryByText(/Welcome to Mission Control/i)).not.toBeInTheDocument()
  })

  it('does not show the hero while sessions are still loading (null)', () => {
    renderApp(null)
    expect(screen.queryByText(/Welcome to Mission Control/i)).not.toBeInTheDocument()
  })
})

describe('App — DispatchDrawer retired (folded into the Triage SelectionBar)', () => {
  it('renders no standalone Dispatch surface', () => {
    renderApp([{ sessionId: 's1', slug: 'demo', cwd: 'C:/proj', isActive: true, model: 'opus' }])
    // The header Dispatch trigger, the bottom drawer handle, and the drawer
    // itself are all gone — the dispatch verb now lives in TriageView's
    // SelectionBar (see SCOPE.md "fold into the Triage multi-select").
    expect(screen.queryAllByRole('button', { name: /dispatch/i })).toHaveLength(0)
    expect(screen.queryByText('Dispatch Manager')).toBeNull()
  })
})
