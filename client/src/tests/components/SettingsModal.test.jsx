import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsModal } from '../../components/SettingsModal.jsx'

function createMockSoundEngine() {
  return {
    play: vi.fn(),
    playPreset: vi.fn(),
    speakText: vi.fn(),
    getPrefs: vi.fn(() => ({
      masterVolume: 0.7,
      events: {
        needsInput: { sound: 'chime', voice: true },
        sessionError: { sound: 'fail', voice: true },
        sessionComplete: { sound: 'success', voice: true },
        sessionUpdate: { sound: 'gentle', voice: false },
        newSession: { sound: 'ping', voice: false },
        taskUpdate: { sound: 'gentle', voice: false },
        intelligenceReady: { sound: 'ping', voice: false },
        teamUpdate: { sound: 'none', voice: false },
        historyUpdate: { sound: 'none', voice: false },
      },
      ttsVoice: null,
      customSounds: {},
    })),
    updatePrefs: vi.fn(function (partial) { return this.getPrefs() }),
    addCustomSound: vi.fn(() => true),
    removeCustomSound: vi.fn(),
  }
}

const defaultShortcuts = {
  nextSession: 'j', prevSession: 'k', openDetail: 'Enter', backToBoard: 'Escape',
  tabAgents: '1', tabTasks: '2', tabWorkflows: '3', tabSkills: '4',
  quickApprove: 'y', quickContinue: 'c', focusInput: '/', showHelp: '?',
  toggleSettings: ',', toggleMute: 'm',
}

// Mock speechSynthesis for SoundsVoiceTab
beforeAll(() => {
  global.speechSynthesis = {
    speak: vi.fn(),
    cancel: vi.fn(),
    getVoices: () => [],
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  global.SpeechSynthesisUtterance = vi.fn(function (text) { this.text = text })
})

beforeEach(() => {
  localStorage.clear()
})

function renderModal(props = {}) {
  return render(
    <SettingsModal
      onClose={props.onClose || vi.fn()}
      soundEngine={props.soundEngine || createMockSoundEngine()}
      shortcuts={props.shortcuts || defaultShortcuts}
      updateShortcut={props.updateShortcut || vi.fn()}
      resetShortcuts={props.resetShortcuts || vi.fn()}
    />
  )
}

describe('SettingsModal — rendering', () => {
  it('renders the Settings title', () => {
    renderModal()
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('renders all three tabs', () => {
    renderModal()
    expect(screen.getByText('Notifications')).toBeInTheDocument()
    expect(screen.getByText('Sounds & Voice')).toBeInTheDocument()
    expect(screen.getByText('Shortcuts')).toBeInTheDocument()
  })

  it('shows Notifications tab content by default', () => {
    renderModal()
    expect(screen.getByText('Desktop notifications')).toBeInTheDocument()
    expect(screen.getByText('Sound')).toBeInTheDocument()
  })
})

describe('SettingsModal — tab switching', () => {
  it('switches to Sounds & Voice tab', () => {
    renderModal()
    fireEvent.click(screen.getByText('Sounds & Voice'))
    expect(screen.getByText('Event Sounds')).toBeInTheDocument()
    expect(screen.getByText('TTS Voice')).toBeInTheDocument()
  })

  it('switches to Shortcuts tab', () => {
    renderModal()
    fireEvent.click(screen.getByText('Shortcuts'))
    expect(screen.getByText('Key Bindings')).toBeInTheDocument()
    expect(screen.getByText('Reset to defaults')).toBeInTheDocument()
  })
})

describe('SettingsModal — notifications tab', () => {
  it('toggles are checked by default (default prefs)', () => {
    renderModal()
    const switches = screen.getAllByRole('switch')
    expect(switches[0]).toHaveAttribute('aria-checked', 'true')
    expect(switches[1]).toHaveAttribute('aria-checked', 'true')
  })

  it('clicking Desktop notifications toggle updates aria-checked', () => {
    renderModal()
    const switches = screen.getAllByRole('switch')
    fireEvent.click(switches[0])
    expect(switches[0]).toHaveAttribute('aria-checked', 'false')
  })

  it('persists preference changes to localStorage', () => {
    renderModal()
    const switches = screen.getAllByRole('switch')
    fireEvent.click(switches[0]) // Disable notifications

    const stored = JSON.parse(localStorage.getItem('oversight.notifications'))
    expect(stored.enabled).toBe(false)
    expect(stored.sound).toBe(true)
  })

  it('test sound button calls playPreset', () => {
    const soundEngine = createMockSoundEngine()
    renderModal({ soundEngine })
    fireEvent.click(screen.getByText('Test sound'))
    expect(soundEngine.playPreset).toHaveBeenCalledWith('chime')
  })
})

describe('SettingsModal — close behavior', () => {
  it('calls onClose when X button is clicked', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    const closeButtons = screen.getAllByRole('button')
    const xButton = closeButtons.find(b => b.getAttribute('role') !== 'switch' && !b.textContent.includes('Settings'))
    fireEvent.click(xButton)
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when overlay backdrop is clicked', () => {
    const onClose = vi.fn()
    const { container } = renderModal({ onClose })
    fireEvent.click(container.firstChild)
    expect(onClose).toHaveBeenCalled()
  })

  it('does not call onClose when modal content is clicked', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.click(screen.getByText('Notifications'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
