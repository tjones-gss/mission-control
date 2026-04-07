import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../hooks/useKeyboardShortcuts.js', () => ({
  ACTION_LABELS: { selectNext: 'Next session', selectPrev: 'Previous session' },
}))

import { ShortcutsTab } from '../../components/settings/ShortcutsTab.jsx'

const defaultProps = {
  shortcuts: { selectNext: 'j', selectPrev: 'k' },
  updateShortcut: vi.fn(),
  resetShortcuts: vi.fn(),
}

describe('ShortcutsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders shortcut list with action labels and current keys', () => {
    render(<ShortcutsTab {...defaultProps} />)
    expect(screen.getByText('Next session')).toBeInTheDocument()
    expect(screen.getByText('Previous session')).toBeInTheDocument()
    expect(screen.getByText('j')).toBeInTheDocument()
    expect(screen.getByText('k')).toBeInTheDocument()
  })

  it('clicking a key button starts rebinding (shows "Press a key...")', async () => {
    render(<ShortcutsTab {...defaultProps} />)
    await userEvent.click(screen.getByText('j'))
    expect(screen.getByText('Press a key...')).toBeInTheDocument()
  })

  it('Reset to defaults button calls resetShortcuts', async () => {
    render(<ShortcutsTab {...defaultProps} />)
    await userEvent.click(screen.getByText('Reset to defaults'))
    expect(defaultProps.resetShortcuts).toHaveBeenCalled()
  })
})
