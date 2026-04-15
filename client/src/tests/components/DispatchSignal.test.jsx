import { render, act } from '@testing-library/react'
import { DispatchSignal } from '../../components/DispatchSignal.jsx'

describe('DispatchSignal', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(performance.now() + 1000) // simulate past the duration
      return 1
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null when from is null', () => {
    const { container } = render(
      <DispatchSignal from={null} to={{ x: 100, y: 100 }} onComplete={() => {}} />,
    )
    expect(container.querySelector('svg')).toBeNull()
  })

  it('returns null when to is null', () => {
    const { container } = render(
      <DispatchSignal from={{ x: 0, y: 0 }} to={null} onComplete={() => {}} />,
    )
    expect(container.querySelector('svg')).toBeNull()
  })

  it('renders SVG overlay when both from and to provided', () => {
    const { container } = render(
      <DispatchSignal from={{ x: 100, y: 500 }} to={{ x: 300, y: 200 }} onComplete={() => {}} />,
    )
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveClass('pointer-events-none')
  })

  it('renders path and circle elements', () => {
    const { container } = render(
      <DispatchSignal from={{ x: 100, y: 500 }} to={{ x: 300, y: 200 }} onComplete={() => {}} />,
    )
    // Should have path elements (the beam trail and dim path)
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBeGreaterThanOrEqual(2)

    // Should have circle elements (head glow)
    const circles = container.querySelectorAll('circle')
    expect(circles.length).toBeGreaterThanOrEqual(1)
  })

  it('calls onComplete after animation', async () => {
    const onComplete = vi.fn()
    render(
      <DispatchSignal
        from={{ x: 100, y: 500 }}
        to={{ x: 300, y: 200 }}
        onComplete={onComplete}
        durationMs={10}
      />,
    )
    // The rAF mock immediately calls the callback with t >= duration
    expect(onComplete).toHaveBeenCalled()
  })
})
