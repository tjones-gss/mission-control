import { speak, cancelSpeech, TTS_TEMPLATES } from '../../audio/tts.js'

const mockSpeak = vi.fn()
const mockCancel = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  global.speechSynthesis = {
    speak: mockSpeak,
    cancel: mockCancel,
    getVoices: () => [
      { name: 'Alice', lang: 'en-US' },
      { name: 'Bob', lang: 'en-GB' },
    ],
  }
  global.SpeechSynthesisUtterance = vi.fn(function (text) {
    this.text = text
    this.volume = 1
    this.voice = null
  })
})

// ─── speak ──────────────────────────────────────────────────────────────────

describe('speak', () => {
  it('creates an utterance and calls speechSynthesis.speak', () => {
    speak('Hello')
    expect(mockSpeak).toHaveBeenCalledTimes(1)
    const utterance = mockSpeak.mock.calls[0][0]
    expect(utterance.text).toBe('Hello')
  })

  it('sets volume on the utterance', () => {
    speak('Test', null, 0.5)
    const utterance = mockSpeak.mock.calls[0][0]
    expect(utterance.volume).toBe(0.5)
  })

  it('sets voice by name when matching voice found', () => {
    speak('Test', 'Alice')
    const utterance = mockSpeak.mock.calls[0][0]
    expect(utterance.voice).toEqual({ name: 'Alice', lang: 'en-US' })
  })

  it('does not set voice when name does not match', () => {
    speak('Test', 'Unknown')
    const utterance = mockSpeak.mock.calls[0][0]
    expect(utterance.voice).toBeNull()
  })

  it('does not throw when speechSynthesis is undefined', () => {
    delete global.speechSynthesis
    expect(() => speak('Test')).not.toThrow()
  })
})

// ─── cancelSpeech ───────────────────────────────────────────────────────────

describe('cancelSpeech', () => {
  it('calls speechSynthesis.cancel', () => {
    cancelSpeech()
    expect(mockCancel).toHaveBeenCalledTimes(1)
  })

  it('does not throw when speechSynthesis is undefined', () => {
    delete global.speechSynthesis
    expect(() => cancelSpeech()).not.toThrow()
  })
})

// ─── TTS_TEMPLATES ──────────────────────────────────────────────────────────

describe('TTS_TEMPLATES', () => {
  it('has templates for key events', () => {
    expect(typeof TTS_TEMPLATES.needsInput).toBe('function')
    expect(typeof TTS_TEMPLATES.sessionError).toBe('function')
    expect(typeof TTS_TEMPLATES.sessionComplete).toBe('function')
    expect(typeof TTS_TEMPLATES.newSession).toBe('function')
  })

  it('needsInput template includes project label', () => {
    const text = TTS_TEMPLATES.needsInput({ projectLabel: 'my-app' })
    expect(text).toContain('my-app')
    expect(text).toContain('input')
  })

  it('sessionError template includes project label', () => {
    const text = TTS_TEMPLATES.sessionError({ projectLabel: 'my-app' })
    expect(text).toContain('my-app')
    expect(text).toContain('error')
  })

  it('sessionComplete template includes project label', () => {
    const text = TTS_TEMPLATES.sessionComplete({ projectLabel: 'my-app' })
    expect(text).toContain('my-app')
    expect(text).toContain('completed')
  })

  it('sessionUpdate template returns null (too frequent for TTS)', () => {
    expect(TTS_TEMPLATES.sessionUpdate()).toBeNull()
  })

  it('teamUpdate template returns null', () => {
    expect(TTS_TEMPLATES.teamUpdate()).toBeNull()
  })
})
