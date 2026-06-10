import { render, screen, fireEvent } from '@testing-library/react'
import { AppearanceTab } from '../../components/settings/AppearanceTab.jsx'
import { getTheme } from '../../hooks/useTheme.js'

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

describe('AppearanceTab', () => {
  it('renders every theme as a radio option', () => {
    render(<AppearanceTab />)
    const radios = screen.getAllByRole('radio')
    expect(radios.length).toBe(4)
    expect(screen.getByText('Classic')).toBeInTheDocument()
    expect(screen.getByText('Calm')).toBeInTheDocument()
  })

  it('marks the active theme as checked (classic by default)', () => {
    render(<AppearanceTab />)
    const classic = screen.getByRole('radio', { name: /Classic/ })
    expect(classic).toHaveAttribute('aria-checked', 'true')
  })

  it('selecting a theme persists it and applies it to the document', () => {
    render(<AppearanceTab />)
    fireEvent.click(screen.getByRole('radio', { name: /Calm/ }))
    expect(getTheme()).toBe('calm')
    expect(document.documentElement.dataset.theme).toBe('calm')
    expect(screen.getByRole('radio', { name: /Calm/ })).toHaveAttribute('aria-checked', 'true')
  })
})
