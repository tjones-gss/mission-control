import { renderHook, act } from '@testing-library/react'
import { useSound, getSoundPrefs, setSoundPrefs } from '../../hooks/useSound.js'

// Mock AudioContext
const mockOscillator = {
  connect: vi.fn(),
  type: 'sine',
  frequency: { value: 0 },
  start: vi.fn(),
  stop: vi.fn(),
}
const mockGainNode = {
  connect: vi.fn(),
  gain: {
    value: 1,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  },
}
const MockAudioContext = vi.fn(function () {
  this.createOscillator = () => ({ ...mockOscillator })
  this.createGain = () => ({ ...mockGainNode, gain: { ...mockGainNode.gain } })
  this.destination = {}
  this.currentTime = 0
  this.state = 'running'
  this.resume = vi.fn()
  this.close = vi.fn()
})

// Mock speechSynthesis
const mockSpeak = vi.fn()
const mockCancel = vi.fn()
global.speechSynthesis = {
  speak: mockSpeak,
  cancel: mockCancel,
  getVoices: () => [],
}
global.SpeechSynthesisUtterance = vi.fn(function (text) {
  this.text = text
  this.volume = 1
  this.voice = null
})

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  global.AudioContext = MockAudioContext
})

// ─── getSoundPrefs / setSoundPrefs ──────────────────────────────────────────

describe('getSoundPrefs / setSoundPrefs', () => {
  it('returns defaults when localStorage is empty', () => {
    const prefs = getSoundPrefs()
    expect(prefs.masterVolume).toBe(0.7)
    expect(prefs.events.needsInput).toEqual({ sound: 'chime', voice: true })
    expect(prefs.ttsVoice).toBeNull()
    expect(prefs.customSounds).toEqual({})
  })

  it('returns stored prefs after setSoundPrefs', () => {
    setSoundPrefs({ masterVolume: 0.5, events: { needsInput: { sound: 'alert', voice: false } } })
    const prefs = getSoundPrefs()
    expect(prefs.masterVolume).toBe(0.5)
    expect(prefs.events.needsInput).toEqual({ sound: 'alert', voice: false })
    // Non-overridden events should still have defaults
    expect(prefs.events.sessionError).toEqual({ sound: 'fail', voice: true })
  })

  it('returns defaults when localStorage has invalid JSON', () => {
    localStorage.setItem('oversight.sound', '{bad json')
    expect(getSoundPrefs().masterVolume).toBe(0.7)
  })
})

// ─── useSound hook ──────────────────────────────────────────────────────────

describe('useSound — initialization', () => {
  it('returns stable object reference (useMemo)', () => {
    const { result, rerender } = renderHook(() => useSound())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  it('exposes expected API', () => {
    const { result } = renderHook(() => useSound())
    expect(typeof result.current.play).toBe('function')
    expect(typeof result.current.playPreset).toBe('function')
    expect(typeof result.current.speakText).toBe('function')
    expect(typeof result.current.getPrefs).toBe('function')
    expect(typeof result.current.updatePrefs).toBe('function')
    expect(typeof result.current.addCustomSound).toBe('function')
    expect(typeof result.current.removeCustomSound).toBe('function')
  })

  it('initializes AudioContext on first document click', () => {
    renderHook(() => useSound())
    expect(MockAudioContext).not.toHaveBeenCalled()

    act(() => {
      document.dispatchEvent(new Event('click'))
    })
    expect(MockAudioContext).toHaveBeenCalledTimes(1)
  })

  it('only initializes AudioContext once across multiple clicks', () => {
    renderHook(() => useSound())
    act(() => {
      document.dispatchEvent(new Event('click'))
    })
    act(() => {
      document.dispatchEvent(new Event('click'))
    })
    expect(MockAudioContext).toHaveBeenCalledTimes(1)
  })
})

describe('useSound — getPrefs / updatePrefs', () => {
  it('getPrefs returns current preferences', () => {
    const { result } = renderHook(() => useSound())
    const prefs = result.current.getPrefs()
    expect(prefs.masterVolume).toBe(0.7)
  })

  it('updatePrefs merges and persists changes', () => {
    const { result } = renderHook(() => useSound())

    act(() => {
      result.current.updatePrefs({ masterVolume: 0.3 })
    })

    expect(result.current.getPrefs().masterVolume).toBe(0.3)
    const stored = JSON.parse(localStorage.getItem('oversight.sound'))
    expect(stored.masterVolume).toBe(0.3)
  })

  it('updatePrefs merges event overrides without losing other events', () => {
    const { result } = renderHook(() => useSound())

    act(() => {
      result.current.updatePrefs({ events: { needsInput: { sound: 'alert', voice: false } } })
    })

    const prefs = result.current.getPrefs()
    expect(prefs.events.needsInput).toEqual({ sound: 'alert', voice: false })
    expect(prefs.events.sessionError).toEqual({ sound: 'fail', voice: true })
  })
})

describe('useSound — addCustomSound / removeCustomSound', () => {
  it('addCustomSound stores and persists base64 data', () => {
    const { result } = renderHook(() => useSound())

    let ok
    act(() => {
      ok = result.current.addCustomSound('ding', 'AQID')
    })

    expect(ok).toBe(true)
    expect(result.current.getPrefs().customSounds.ding).toBe('AQID')
    const stored = JSON.parse(localStorage.getItem('oversight.sound'))
    expect(stored.customSounds.ding).toBe('AQID')
  })

  it('addCustomSound rejects files over 500KB', () => {
    const { result } = renderHook(() => useSound())
    const huge = 'A'.repeat(700 * 1024)

    let ok
    act(() => {
      ok = result.current.addCustomSound('big', huge)
    })

    expect(ok).toBe(false)
    expect(result.current.getPrefs().customSounds.big).toBeUndefined()
  })

  it('addCustomSound rejects names with special characters', () => {
    const { result } = renderHook(() => useSound())

    let ok
    act(() => {
      ok = result.current.addCustomSound('bad name!', 'AQID')
    })
    expect(ok).toBe(false)

    act(() => {
      ok = result.current.addCustomSound('../path', 'AQID')
    })
    expect(ok).toBe(false)

    act(() => {
      ok = result.current.addCustomSound('good-name_1', 'AQID')
    })
    expect(ok).toBe(true)
  })

  it('addCustomSound rejects when aggregate budget exceeded', () => {
    const { result } = renderHook(() => useSound())

    // Add a sound that's under per-file cap but will fill aggregate budget
    const chunk = 'A'.repeat(600 * 1024) // ~600KB base64
    let ok
    act(() => {
      ok = result.current.addCustomSound('s1', chunk)
    })
    expect(ok).toBe(true)

    act(() => {
      ok = result.current.addCustomSound('s2', chunk)
    })
    expect(ok).toBe(true)

    act(() => {
      ok = result.current.addCustomSound('s3', chunk)
    })
    expect(ok).toBe(true)

    // 4th should exceed 2MB aggregate
    act(() => {
      ok = result.current.addCustomSound('s4', chunk)
    })
    expect(ok).toBe(false)
  })

  it('removeCustomSound deletes and persists', () => {
    const { result } = renderHook(() => useSound())

    act(() => {
      result.current.addCustomSound('ding', 'AQID')
    })
    act(() => {
      result.current.removeCustomSound('ding')
    })

    expect(result.current.getPrefs().customSounds.ding).toBeUndefined()
  })
})

describe('useSound — play', () => {
  it('play with "none" sound does not init audio', () => {
    const { result } = renderHook(() => useSound())
    act(() => {
      result.current.updatePrefs({ events: { teamUpdate: { sound: 'none', voice: false } } })
    })

    // No click to init AudioContext
    act(() => {
      result.current.play('teamUpdate')
    })
    // Should not throw
  })

  it('play with unknown event name does not throw', () => {
    const { result } = renderHook(() => useSound())
    act(() => {
      document.dispatchEvent(new Event('click'))
    })

    expect(() => {
      act(() => {
        result.current.play('unknownEvent')
      })
    }).not.toThrow()
  })

  it('play triggers TTS when voice is enabled and sessionContext provided', () => {
    const { result } = renderHook(() => useSound())
    act(() => {
      document.dispatchEvent(new Event('click'))
    })

    act(() => {
      result.current.play('needsInput', { projectLabel: 'my-project' })
    })

    expect(mockSpeak).toHaveBeenCalled()
    const utterance = mockSpeak.mock.calls[0][0]
    expect(utterance.text).toContain('my-project')
  })

  it('play does not trigger TTS when voice is disabled', () => {
    const { result } = renderHook(() => useSound())
    act(() => {
      document.dispatchEvent(new Event('click'))
    })

    act(() => {
      result.current.updatePrefs({ events: { needsInput: { sound: 'chime', voice: false } } })
    })

    act(() => {
      result.current.play('needsInput', { projectLabel: 'test' })
    })

    expect(mockSpeak).not.toHaveBeenCalled()
  })

  it('play does not trigger TTS when no sessionContext', () => {
    const { result } = renderHook(() => useSound())
    act(() => {
      document.dispatchEvent(new Event('click'))
    })

    act(() => {
      result.current.play('needsInput')
    })

    expect(mockSpeak).not.toHaveBeenCalled()
  })
})

describe('useSound — speakText', () => {
  it('calls speechSynthesis.speak with text', () => {
    const { result } = renderHook(() => useSound())

    act(() => {
      result.current.speakText('Hello world')
    })

    expect(mockSpeak).toHaveBeenCalled()
    expect(mockSpeak.mock.calls[0][0].text).toBe('Hello world')
  })
})
