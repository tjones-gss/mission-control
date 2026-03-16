import { render, screen, fireEvent } from '@testing-library/react'
import { ToolApprovalBanner } from '../../components/ToolApprovalBanner.jsx'
import { TOOL_COLORS } from '../../components/AgentTree.jsx'

function makeApproval(overrides = {}) {
  return {
    approvalId: 'approval-1',
    toolName: 'Bash',
    input: { command: 'ls -la' },
    ...overrides,
  }
}

describe('ToolApprovalBanner', () => {
  it('renders the tool name', () => {
    render(
      <ToolApprovalBanner
        approval={makeApproval({ toolName: 'Bash' })}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
      />
    )
    expect(screen.getByText('Bash')).toBeInTheDocument()
  })

  it('known tool (Bash) gets the correct color classes from TOOL_COLORS', () => {
    render(
      <ToolApprovalBanner
        approval={makeApproval({ toolName: 'Bash' })}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
      />
    )
    const toolPill = screen.getByText('Bash')
    const expectedClasses = TOOL_COLORS['Bash'].split(' ')
    expectedClasses.forEach(cls => {
      expect(toolPill).toHaveClass(cls)
    })
  })

  it('unknown tool gets the default gray color', () => {
    render(
      <ToolApprovalBanner
        approval={makeApproval({ toolName: 'UnknownTool' })}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
      />
    )
    const toolPill = screen.getByText('UnknownTool')
    expect(toolPill).toHaveClass('bg-gray-800')
    expect(toolPill).toHaveClass('text-gray-400')
  })

  it('Allow button calls onApprove with the approvalId', () => {
    const onApprove = vi.fn()
    render(
      <ToolApprovalBanner
        approval={makeApproval({ approvalId: 'appr-42' })}
        onApprove={onApprove}
        onDeny={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Allow'))
    expect(onApprove).toHaveBeenCalledTimes(1)
    expect(onApprove).toHaveBeenCalledWith('appr-42')
  })

  it('Deny button calls onDeny with the approvalId', () => {
    const onDeny = vi.fn()
    render(
      <ToolApprovalBanner
        approval={makeApproval({ approvalId: 'appr-42' })}
        onApprove={vi.fn()}
        onDeny={onDeny}
      />
    )
    fireEvent.click(screen.getByText('Deny'))
    expect(onDeny).toHaveBeenCalledTimes(1)
    expect(onDeny).toHaveBeenCalledWith('appr-42')
  })

  it('input preview is collapsed by default — JSON not visible', () => {
    render(
      <ToolApprovalBanner
        approval={makeApproval({ input: { command: 'ls -la' } })}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
      />
    )
    expect(screen.queryByText(/"command"/)).not.toBeInTheDocument()
  })

  it('expand toggle reveals the input JSON', () => {
    const approval = makeApproval({ input: { command: 'ls -la' } })
    render(
      <ToolApprovalBanner
        approval={approval}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
      />
    )
    // The toggle button is the one that shows ChevronDown/ChevronUp (no text label)
    // It sits between the tool pill and the Allow/Deny buttons
    const expandButton = screen.getByRole('button', { name: '' })
    fireEvent.click(expandButton)
    // After expanding, the JSON pre block should be visible
    expect(screen.getByText(/"command"/, { exact: false })).toBeInTheDocument()
  })
})
