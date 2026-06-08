import { render, screen, fireEvent } from '@testing-library/react'
import { ParserDegradedBanner } from '../../components/ParserDegradedBanner.jsx'

describe('ParserDegradedBanner', () => {
  it('renders nothing when there are no degraded parsers', () => {
    const { container } = render(<ParserDegradedBanner degraded={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when degraded prop is missing', () => {
    const { container } = render(<ParserDegradedBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a warning when a parser is degraded', () => {
    render(<ParserDegradedBanner degraded={[{ parser: 'sessions', reason: 'format-change' }]} />)
    // The headline must point the user at the likely cause: a Claude Code update.
    expect(screen.getByText(/can't read your Claude data/i)).toBeInTheDocument()
    expect(screen.getByText(/Claude Code update/i)).toBeInTheDocument()
  })

  it('names the affected parser(s)', () => {
    render(
      <ParserDegradedBanner
        degraded={[
          { parser: 'sessions', reason: 'format-change' },
          { parser: 'hooks', reason: 'parse-failed' },
        ]}
      />,
    )
    expect(screen.getByText(/sessions/)).toBeInTheDocument()
    expect(screen.getByText(/hooks/)).toBeInTheDocument()
  })

  it('can be dismissed', () => {
    render(<ParserDegradedBanner degraded={[{ parser: 'config', reason: 'parse-failed' }]} />)
    expect(screen.getByText(/can't read your Claude data/i)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/dismiss/i))
    expect(screen.queryByText(/can't read your Claude data/i)).not.toBeInTheDocument()
  })
})
