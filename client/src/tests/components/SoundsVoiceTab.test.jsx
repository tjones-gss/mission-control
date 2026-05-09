import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../audio/tts.js', () => ({
  getAvailableVoices: vi.fn(() => Promise.resolve([])),
}))

import { SoundsVoiceTab } from '../../components/settings/SoundsVoiceTab.jsx'

const mockSoundEngine = {
  getPrefs: vi.fn(() => ({
    masterVolume: 0.8,
    ttsVoice: null,
    customSounds: {},
    events: {
      needsInput: { sound: 'chime', voice: false },
      newSession: { sound: 'ping', voice: false },
    },
  })),
  updatePrefs: vi.fn((partial) => ({ ...mockSoundEngine.getPrefs(), ...partial })),
  playPreset: vi.fn(),
  speakText: vi.fn(),
  addCustomSound: vi.fn(() => true),
  removeCustomSound: vi.fn(),
}

describe('SoundsVoiceTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders event sound mapping rows (Needs input, New session, etc.)', () => {
    render(<SoundsVoiceTab soundEngine={mockSoundEngine} />)
    expect(screen.getByText('Needs input')).toBeInTheDocument()
    expect(screen.getByText('New session')).toBeInTheDocument()
  })

  it('shows Upload sound button', () => {
    render(<SoundsVoiceTab soundEngine={mockSoundEngine} />)
    expect(screen.getByText('Upload sound (max 500KB)')).toBeInTheDocument()
  })
})
