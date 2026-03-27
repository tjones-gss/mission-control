import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { server } from '../mocks/server.js'
import { http, HttpResponse } from 'msw'
import { ErrorBoundary } from '../../components/ErrorBoundary.jsx'

function ThrowingChild({ shouldThrow }) {
  if (shouldThrow) throw new Error('test error')
  return <div>child content</div>
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </ErrorBoundary>
    )
    expect(screen.getByText('child content')).toBeInTheDocument()
  })

  it('shows "Something went wrong" when child throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    spy.mockRestore()
  })

  it('displays the error message', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    )
    expect(screen.getByText('test error')).toBeInTheDocument()
    spy.mockRestore()
  })

  it('"Try again" button resets error and re-renders children', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { rerender } = render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()

    // Now rerender with non-throwing child and click Try again
    rerender(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </ErrorBoundary>
    )
    await userEvent.click(screen.getByText('Try again'))
    expect(screen.getByText('child content')).toBeInTheDocument()
    spy.mockRestore()
  })

  it('calls console.error via componentDidCatch', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    )
    expect(spy).toHaveBeenCalled()
    const callArgs = spy.mock.calls.find(call => call[0] === 'ErrorBoundary caught:')
    expect(callArgs).toBeTruthy()
    expect(callArgs[1]).toBeInstanceOf(Error)
    expect(callArgs[1].message).toBe('test error')
    spy.mockRestore()
  })
})
