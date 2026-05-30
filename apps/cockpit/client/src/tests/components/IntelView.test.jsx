import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../hooks/useApi.js', () => ({
  useApi: vi.fn(),
}))

import { useApi } from '../../hooks/useApi.js'
import { IntelView } from '../../components/IntelView.jsx'

const INTEL_DATA = {
  goal: 'Build a web app',
  progress: 'Halfway done',
  flags: ['High token usage'],
  subagents: '2 active',
  recommendation: 'Consider splitting',
  analyzedAt: Date.now(),
}

const defaultProps = { sessionId: 'test-123', intelligenceVersion: 1, active: true }

describe('IntelView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('shows opt-in gate with "Enable Intel analysis" button when localStorage disabled', () => {
    localStorage.setItem('intel_enabled', 'false')
    useApi.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() })
    render(<IntelView {...defaultProps} />)
    expect(screen.getByText('Enable Intel analysis')).toBeInTheDocument()
  })

  it('clicking Enable sets localStorage and shows content', async () => {
    localStorage.setItem('intel_enabled', 'false')
    useApi.mockReturnValue({ data: INTEL_DATA, loading: false, error: null, refetch: vi.fn() })
    render(<IntelView {...defaultProps} />)
    await userEvent.click(screen.getByText('Enable Intel analysis'))
    expect(localStorage.getItem('intel_enabled')).toBe('true')
    expect(screen.getByText('Build a web app')).toBeInTheDocument()
  })

  it('shows "Analyzing..." skeleton when loading', () => {
    localStorage.setItem('intel_enabled', 'true')
    useApi.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() })
    render(<IntelView {...defaultProps} />)
    expect(screen.getByText('Analyzing...')).toBeInTheDocument()
  })

  it('renders goal, progress, flags, subagents, recommendation', () => {
    localStorage.setItem('intel_enabled', 'true')
    useApi.mockReturnValue({ data: INTEL_DATA, loading: false, error: null, refetch: vi.fn() })
    render(<IntelView {...defaultProps} />)
    expect(screen.getByText('Build a web app')).toBeInTheDocument()
    expect(screen.getByText('Halfway done')).toBeInTheDocument()
    expect(screen.getByText(/High token usage/)).toBeInTheDocument()
    expect(screen.getByText('2 active')).toBeInTheDocument()
    expect(screen.getByText('Consider splitting')).toBeInTheDocument()
  })

  it('shows error state with "Intel analysis failed"', () => {
    localStorage.setItem('intel_enabled', 'true')
    useApi.mockReturnValue({
      data: null,
      loading: false,
      error: 'analysis_failed',
      refetch: vi.fn(),
    })
    render(<IntelView {...defaultProps} />)
    expect(screen.getByText(/Intel analysis failed/)).toBeInTheDocument()
  })

  it('disable button hides content', async () => {
    localStorage.setItem('intel_enabled', 'true')
    useApi.mockReturnValue({ data: INTEL_DATA, loading: false, error: null, refetch: vi.fn() })
    render(<IntelView {...defaultProps} />)
    expect(screen.getByText('Build a web app')).toBeInTheDocument()
    await userEvent.click(screen.getByText('disable'))
    expect(localStorage.getItem('intel_enabled')).toBe('false')
    expect(screen.getByText('Enable Intel analysis')).toBeInTheDocument()
  })
})
