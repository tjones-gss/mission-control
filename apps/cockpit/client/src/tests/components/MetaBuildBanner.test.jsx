import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  MetaBuildBanner,
  STEER_BUILD_MESSAGE,
} from '../../components/TriageView/MetaBuildBanner.jsx'

describe('MetaBuildBanner', () => {
  it('renders the "Building Oversight" label', () => {
    render(<MetaBuildBanner count={1} />)
    expect(screen.getByText(/building oversight/i)).toBeInTheDocument()
  })

  it('shows the meta-session count', () => {
    render(<MetaBuildBanner count={3} />)
    expect(screen.getByText(/3/)).toBeInTheDocument()
  })

  it('renders a "Steer build" button and calls onSteer when clicked', async () => {
    const onSteer = vi.fn()
    render(<MetaBuildBanner count={1} onSteer={onSteer} />)
    await userEvent.click(screen.getByRole('button', { name: /steer build/i }))
    expect(onSteer).toHaveBeenCalledTimes(1)
  })

  it('does not render a steer button without an onSteer handler', () => {
    render(<MetaBuildBanner count={1} />)
    expect(screen.queryByRole('button', { name: /steer build/i })).not.toBeInTheDocument()
  })

  it('exports the pre-composed steer message', () => {
    expect(STEER_BUILD_MESSAGE).toMatch(/last 3 commits/i)
    expect(STEER_BUILD_MESSAGE).toMatch(/npm run test:cockpit/)
  })
})
