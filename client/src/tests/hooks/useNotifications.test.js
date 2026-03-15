import { renderHook, act } from '@testing-library/react'
import { useNotifications, getNotificationPrefs, setNotificationPrefs } from '../../hooks/useNotifications.js'

// Mock Notification API
const mockNotification = vi.fn()
mockNotification.requestPermission = vi.fn().mockResolvedValue('granted')

// Mock AudioContext
const mockOscillator = {
  connect: vi.fn(),
  type: 'sine',
  frequency: { value: 0 },
  start: vi.fn(),
  stop: vi.fn(),
}
const mockGain = {
  connect: vi.fn(),
  gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
}
const MockAudioContext = vi.fn(() => ({
  createOscillator: () => mockOscillator,
  createGain: () => mockGain,
  destination: {},
  currentTime: 0,
}))

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  global.Notification = Object.assign(mockNotification, {
    permission: 'granted',
    requestPermission: mockNotification.requestPermission,
  })
  global.AudioContext = MockAudioContext
})

function makeSession(id, needsInput = false) {
  return {
    sessionId: id,
    cwd: `/home/user/${id}`,
    needsInput,
    lastText: `Text for ${id}`,
  }
}

describe('getNotificationPrefs / setNotificationPrefs', () => {
  it('returns defaults when localStorage is empty', () => {
    expect(getNotificationPrefs()).toEqual({ enabled: true, sound: true })
  })

  it('returns stored prefs after setNotificationPrefs', () => {
    setNotificationPrefs({ enabled: false, sound: true })
    expect(getNotificationPrefs()).toEqual({ enabled: false, sound: true })
  })

  it('returns defaults when localStorage has invalid JSON', () => {
    localStorage.setItem('oversight.notifications', 'not-json')
    expect(getNotificationPrefs()).toEqual({ enabled: true, sound: true })
  })
})

describe('useNotifications — transition detection', () => {
  it('does not fire notifications on initial render with no needsInput sessions', () => {
    const sessions = [makeSession('s1', false)]
    renderHook(() => useNotifications(sessions))
    expect(mockNotification).not.toHaveBeenCalled()
  })

  it('fires desktop notification when session transitions to needsInput', () => {
    const sessions1 = [makeSession('s1', false)]
    const sessions2 = [makeSession('s1', true)]

    const { rerender } = renderHook(({ s }) => useNotifications(s), {
      initialProps: { s: sessions1 },
    })

    act(() => { rerender({ s: sessions2 }) })

    expect(mockNotification).toHaveBeenCalledWith('Agent needs input', expect.objectContaining({
      body: expect.stringContaining('s1'),
      tag: 's1',
    }))
  })

  it('does not re-notify for the same session on subsequent renders', () => {
    const sessions = [makeSession('s1', true)]

    const { rerender } = renderHook(({ s }) => useNotifications(s), {
      initialProps: { s: sessions },
    })

    mockNotification.mockClear()
    act(() => { rerender({ s: [...sessions] }) })

    expect(mockNotification).not.toHaveBeenCalled()
  })

  it('does not fire notifications when prefs.enabled is false', () => {
    setNotificationPrefs({ enabled: false, sound: false })
    const sessions1 = [makeSession('s1', false)]
    const sessions2 = [makeSession('s1', true)]

    const { rerender } = renderHook(({ s }) => useNotifications(s), {
      initialProps: { s: sessions1 },
    })
    act(() => { rerender({ s: sessions2 }) })

    expect(mockNotification).not.toHaveBeenCalled()
  })
})

describe('useNotifications — muting', () => {
  it('muteSession prevents notifications for that session', () => {
    const sessions1 = [makeSession('s1', false)]
    const sessions2 = [makeSession('s1', true)]

    const { result, rerender } = renderHook(({ s }) => useNotifications(s), {
      initialProps: { s: sessions1 },
    })

    act(() => { result.current.muteSession('s1') })
    act(() => { rerender({ s: sessions2 }) })

    expect(mockNotification).not.toHaveBeenCalled()
  })

  it('clears muted IDs when session leaves needsInput state', () => {
    const sessions1 = [makeSession('s1', true)]
    const sessions2 = [makeSession('s1', false)]
    const sessions3 = [makeSession('s1', true)]

    const { result, rerender } = renderHook(({ s }) => useNotifications(s), {
      initialProps: { s: sessions1 },
    })

    // Mute s1
    act(() => { result.current.muteSession('s1') })
    mockNotification.mockClear()

    // s1 leaves needsInput → mute should be cleared
    act(() => { rerender({ s: sessions2 }) })

    // s1 comes back to needsInput → should notify again
    act(() => { rerender({ s: sessions3 }) })

    expect(mockNotification).toHaveBeenCalledWith('Agent needs input', expect.objectContaining({ tag: 's1' }))
  })
})

describe('useNotifications — requestPermission', () => {
  it('requests notification permission when called', () => {
    global.Notification.permission = 'default'
    const { result } = renderHook(() => useNotifications([]))
    act(() => { result.current.requestPermission() })
    expect(mockNotification.requestPermission).toHaveBeenCalled()
  })

  it('does not request permission if already granted', () => {
    global.Notification.permission = 'granted'
    const { result } = renderHook(() => useNotifications([]))
    act(() => { result.current.requestPermission() })
    expect(mockNotification.requestPermission).not.toHaveBeenCalled()
  })
})

describe('useNotifications — null/empty sessions', () => {
  it('handles null sessions gracefully', () => {
    expect(() => {
      renderHook(() => useNotifications(null))
    }).not.toThrow()
  })

  it('handles empty sessions array', () => {
    expect(() => {
      renderHook(() => useNotifications([]))
    }).not.toThrow()
  })
})
