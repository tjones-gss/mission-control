import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsModal } from '../../components/SettingsModal.jsx'

beforeEach(() => {
  localStorage.clear()
})

describe('SettingsModal — rendering', () => {
  it('renders the Settings title', () => {
    render(<SettingsModal onClose={vi.fn()} />)
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('renders notification section header', () => {
    render(<SettingsModal onClose={vi.fn()} />)
    expect(screen.getByText('Notifications')).toBeInTheDocument()
  })

  it('renders both toggle options', () => {
    render(<SettingsModal onClose={vi.fn()} />)
    expect(screen.getByText('Desktop notifications')).toBeInTheDocument()
    expect(screen.getByText('Sound')).toBeInTheDocument()
  })
})

describe('SettingsModal — toggle behavior', () => {
  it('toggles are checked by default (default prefs)', () => {
    render(<SettingsModal onClose={vi.fn()} />)
    const switches = screen.getAllByRole('switch')
    expect(switches[0]).toHaveAttribute('aria-checked', 'true')
    expect(switches[1]).toHaveAttribute('aria-checked', 'true')
  })

  it('clicking Desktop notifications toggle updates aria-checked', () => {
    render(<SettingsModal onClose={vi.fn()} />)
    const switches = screen.getAllByRole('switch')
    fireEvent.click(switches[0])
    expect(switches[0]).toHaveAttribute('aria-checked', 'false')
  })

  it('clicking Sound toggle updates aria-checked', () => {
    render(<SettingsModal onClose={vi.fn()} />)
    const switches = screen.getAllByRole('switch')
    fireEvent.click(switches[1])
    expect(switches[1]).toHaveAttribute('aria-checked', 'false')
  })

  it('persists preference changes to localStorage', () => {
    render(<SettingsModal onClose={vi.fn()} />)
    const switches = screen.getAllByRole('switch')
    fireEvent.click(switches[0]) // Disable notifications

    const stored = JSON.parse(localStorage.getItem('oversight.notifications'))
    expect(stored.enabled).toBe(false)
    expect(stored.sound).toBe(true)
  })

  it('loads saved preferences from localStorage', () => {
    localStorage.setItem('oversight.notifications', JSON.stringify({ enabled: false, sound: false }))
    render(<SettingsModal onClose={vi.fn()} />)
    const switches = screen.getAllByRole('switch')
    expect(switches[0]).toHaveAttribute('aria-checked', 'false')
    expect(switches[1]).toHaveAttribute('aria-checked', 'false')
  })
})

describe('SettingsModal — close behavior', () => {
  it('calls onClose when X button is clicked', () => {
    const onClose = vi.fn()
    render(<SettingsModal onClose={onClose} />)
    // The X button is inside the header
    const closeButtons = screen.getAllByRole('button')
    // First button that isn't a switch - the X close button
    const xButton = closeButtons.find(b => b.getAttribute('role') !== 'switch' && !b.textContent.includes('Settings'))
    fireEvent.click(xButton)
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when overlay backdrop is clicked', () => {
    const onClose = vi.fn()
    const { container } = render(<SettingsModal onClose={onClose} />)
    // Click the outermost overlay div
    fireEvent.click(container.firstChild)
    expect(onClose).toHaveBeenCalled()
  })

  it('does not call onClose when modal content is clicked', () => {
    const onClose = vi.fn()
    render(<SettingsModal onClose={onClose} />)
    fireEvent.click(screen.getByText('Notifications'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
