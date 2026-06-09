import { render, screen, fireEvent } from '@testing-library/react'
import { WelcomeHero } from '../../components/WelcomeHero.jsx'

describe('WelcomeHero', () => {
  it('renders the welcome heading and primary CTA', () => {
    render(<WelcomeHero onStartFirstAgent={() => {}} onOpenTrust={() => {}} />)
    expect(screen.getByText(/Welcome to Mission Control/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /start your first agent/i })).toBeInTheDocument()
  })

  it('fires onStartFirstAgent when the primary CTA is clicked', () => {
    const onStart = vi.fn()
    render(<WelcomeHero onStartFirstAgent={onStart} onOpenTrust={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /start your first agent/i }))
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('surfaces the rails/trust step and fires onOpenTrust', () => {
    const onOpenTrust = vi.fn()
    render(<WelcomeHero onStartFirstAgent={() => {}} onOpenTrust={onOpenTrust} />)
    // ADR-0005: the welcome advances the rails, not just polish.
    expect(screen.getByText(/guardrails/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /manage trusted folders/i }))
    expect(onOpenTrust).toHaveBeenCalledTimes(1)
  })
})
