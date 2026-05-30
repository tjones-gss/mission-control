import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../hooks/useNotifications.js', () => ({
  getNotificationPrefs: vi.fn(() => ({ enabled: true, sound: true })),
  setNotificationPrefs: vi.fn(),
}))

import { NotificationsTab } from '../../components/settings/NotificationsTab.jsx'

const mockSoundEngine = {
  getPrefs: vi.fn(() => ({ masterVolume: 0.8 })),
  updatePrefs: vi.fn(),
  playPreset: vi.fn(),
}

describe('NotificationsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSoundEngine.getPrefs.mockReturnValue({ masterVolume: 0.8 })
  })

  it('renders Desktop notifications and Sound toggles', () => {
    render(<NotificationsTab soundEngine={mockSoundEngine} />)
    expect(screen.getByText('Desktop notifications')).toBeInTheDocument()
    expect(screen.getByText('Sound')).toBeInTheDocument()
  })

  it('renders volume slider with percentage display', () => {
    render(<NotificationsTab soundEngine={mockSoundEngine} />)
    const slider = screen.getByRole('slider')
    expect(slider).toBeInTheDocument()
    expect(slider).toHaveValue('0.8')
    expect(screen.getByText('80%')).toBeInTheDocument()
  })

  it('Test sound button calls soundEngine.playPreset("chime")', async () => {
    render(<NotificationsTab soundEngine={mockSoundEngine} />)
    await userEvent.click(screen.getByText('Test sound'))
    expect(mockSoundEngine.playPreset).toHaveBeenCalledWith('chime')
  })
})
