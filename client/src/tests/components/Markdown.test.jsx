import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Markdown } from '../../components/Markdown.jsx'

describe('Markdown', () => {
  it('renders markdown text content', () => {
    render(<Markdown>Hello **world**</Markdown>)
    expect(screen.getByText('world')).toBeInTheDocument()
    expect(screen.getByText('world').tagName).toBe('STRONG')
  })

  it('handles empty/null children gracefully', () => {
    const { container } = render(<Markdown>{null}</Markdown>)
    expect(container).toBeInTheDocument()
    const { container: container2 } = render(<Markdown>{''}</Markdown>)
    expect(container2).toBeInTheDocument()
  })
})
