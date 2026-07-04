import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from '../../components/ui/Button.jsx'
import { LoadingState, ErrorState } from '../../components/ui/States.jsx'
import { Chip } from '../../components/ui/Chip.jsx'
import { Card } from '../../components/ui/Card.jsx'
import { Input } from '../../components/ui/Input.jsx'

describe('ui/Button', () => {
  it('renders children and fires onClick', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Launch</Button>)
    const btn = screen.getByRole('button', { name: 'Launch' })
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalled()
  })

  it('applies the primary variant styling', () => {
    render(<Button variant="primary">Go</Button>)
    expect(screen.getByRole('button', { name: 'Go' }).className).toContain('--mc-accent')
  })

  it('does not fire onClick while disabled', () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Nope
      </Button>,
    )
    const btn = screen.getByRole('button', { name: 'Nope' })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('ui/States', () => {
  it('LoadingState shows its label with a status role', () => {
    render(<LoadingState label="Loading runs…" />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading runs…')
  })

  it('ErrorState shows the message and a working Retry button', () => {
    const onRetry = vi.fn()
    render(<ErrorState message="HTTP 503" onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 503')
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('ErrorState omits Retry when no handler is given', () => {
    render(<ErrorState message="boom" />)
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
  })
})

describe('ui/Chip', () => {
  it('renders as a non-interactive span by default', () => {
    render(<Chip tone="warn">blocked</Chip>)
    const chip = screen.getByText('blocked')
    expect(chip.tagName).toBe('SPAN')
    expect(chip.className).toContain('--mc-warn')
  })

  it('renders as a button and fires onClick when interactive', () => {
    const onClick = vi.fn()
    render(<Chip onClick={onClick}>filter</Chip>)
    fireEvent.click(screen.getByRole('button', { name: 'filter' }))
    expect(onClick).toHaveBeenCalled()
  })

  it('falls back to the neutral tone for unknown tones', () => {
    render(<Chip tone="nope">x</Chip>)
    expect(screen.getByText('x').className).toContain('--mc-surface-2')
  })
})

describe('ui/Card', () => {
  it('renders a div surface by default', () => {
    render(<Card data-testid="card">body</Card>)
    const card = screen.getByTestId('card')
    expect(card.tagName).toBe('DIV')
    expect(card.className).toContain('--mc-surface')
  })

  it('renders as a full-width button when onClick is given', () => {
    const onClick = vi.fn()
    render(<Card onClick={onClick}>open</Card>)
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    expect(onClick).toHaveBeenCalled()
  })

  it('applies the glass variant', () => {
    render(
      <Card data-testid="glass" variant="glass">
        g
      </Card>,
    )
    expect(screen.getByTestId('glass').className).toContain('--mc-glass')
  })
})

describe('ui/Input', () => {
  it('renders a token-styled text input that accepts typing', () => {
    render(<Input aria-label="Goal" defaultValue="" />)
    const input = screen.getByRole('textbox', { name: 'Goal' })
    fireEvent.change(input, { target: { value: 'ship it' } })
    expect(input.value).toBe('ship it')
    expect(input.className).toContain('--mc-accent')
  })
})
