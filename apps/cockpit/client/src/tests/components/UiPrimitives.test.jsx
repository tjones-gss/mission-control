import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from '../../components/ui/Button.jsx'
import { LoadingState, ErrorState } from '../../components/ui/States.jsx'

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
