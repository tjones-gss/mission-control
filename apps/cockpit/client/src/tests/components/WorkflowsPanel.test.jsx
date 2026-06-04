import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { WorkflowsPanel } from '../../components/WorkflowsPanel.jsx'

// userEvent configured to not touch clipboard (already stubbed in setup.js)
const user = () => userEvent.setup({ writeToClipboard: false })

const SAMPLE_WORKFLOWS = [
  {
    name: 'my-workflow',
    description: 'First workflow',
    steps: [
      { id: '1', type: 'instruction', text: 'Do thing' },
      { id: '2', type: 'command', command: 'npm run build' },
    ],
  },
  { name: 'empty-flow', description: '', steps: [] },
]

const SAMPLE_SKILLS = {
  userSkills: [
    { name: 'my-skill', description: 'A user skill' },
    { name: 'other-skill', description: '' },
  ],
  pluginSkills: [],
}

// ──────────────────────────────────────────────────────────────────────────────
// Empty state
// ──────────────────────────────────────────────────────────────────────────────
describe('WorkflowsPanel — empty state', () => {
  it('shows "No workflows yet." when list is empty', () => {
    render(<WorkflowsPanel workflows={[]} loading={false} refetch={vi.fn()} skills={null} />)
    expect(screen.getByText('No workflows yet.')).toBeInTheDocument()
  })

  it('shows loading text while loading', () => {
    render(<WorkflowsPanel workflows={[]} loading={true} refetch={vi.fn()} skills={null} />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows placeholder when no workflow is selected', () => {
    render(<WorkflowsPanel workflows={[]} loading={false} refetch={vi.fn()} skills={null} />)
    expect(screen.getByText('Select a workflow or create a new one.')).toBeInTheDocument()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Workflow list
// ──────────────────────────────────────────────────────────────────────────────
describe('WorkflowsPanel — workflow list', () => {
  it('renders workflow names', () => {
    render(
      <WorkflowsPanel
        workflows={SAMPLE_WORKFLOWS}
        loading={false}
        refetch={vi.fn()}
        skills={null}
      />,
    )
    expect(screen.getByText('my-workflow')).toBeInTheDocument()
    expect(screen.getByText('empty-flow')).toBeInTheDocument()
  })

  it('renders step counts', () => {
    render(
      <WorkflowsPanel
        workflows={SAMPLE_WORKFLOWS}
        loading={false}
        refetch={vi.fn()}
        skills={null}
      />,
    )
    expect(screen.getByText('2 steps')).toBeInTheDocument()
    expect(screen.getByText('0 steps')).toBeInTheDocument()
  })

  it('clicking a workflow opens the editor with name input', () => {
    render(
      <WorkflowsPanel
        workflows={SAMPLE_WORKFLOWS}
        loading={false}
        refetch={vi.fn()}
        skills={null}
      />,
    )
    fireEvent.click(screen.getByText('my-workflow'))
    const nameInput = screen.getByDisplayValue('my-workflow')
    expect(nameInput).toBeInTheDocument()
  })

  it('name input is disabled for existing workflows', () => {
    render(
      <WorkflowsPanel
        workflows={SAMPLE_WORKFLOWS}
        loading={false}
        refetch={vi.fn()}
        skills={null}
      />,
    )
    fireEvent.click(screen.getByText('my-workflow'))
    const nameInput = screen.getByDisplayValue('my-workflow')
    expect(nameInput).toBeDisabled()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// New workflow
// ──────────────────────────────────────────────────────────────────────────────
describe('WorkflowsPanel — new workflow', () => {
  it('clicking "New" button makes name input enabled', () => {
    render(<WorkflowsPanel workflows={[]} loading={false} refetch={vi.fn()} skills={null} />)
    fireEvent.click(screen.getByText('New'))
    const nameInput = screen.getByPlaceholderText('my-workflow')
    expect(nameInput).toBeEnabled()
  })

  it('Export button is disabled for new (unsaved) workflows', () => {
    render(<WorkflowsPanel workflows={[]} loading={false} refetch={vi.fn()} skills={null} />)
    fireEvent.click(screen.getByText('New'))
    const exportBtn = screen.getByRole('button', { name: /Export as Skill/i })
    expect(exportBtn).toBeDisabled()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Name input strips invalid characters
// ──────────────────────────────────────────────────────────────────────────────
describe('WorkflowsPanel — name input validation', () => {
  it('strips non-[a-zA-Z0-9_-] characters from the name field', async () => {
    render(<WorkflowsPanel workflows={[]} loading={false} refetch={vi.fn()} skills={null} />)
    fireEvent.click(screen.getByText('New'))
    const nameInput = screen.getByPlaceholderText('my-workflow')
    // Use fireEvent.change to test the onChange handler directly
    fireEvent.change(nameInput, { target: { value: 'hello world! @#$' } })
    // The onChange replaces non-valid chars: result should be 'helloworld'
    expect(nameInput.value).toMatch(/^[a-zA-Z0-9_-]*$/)
  })

  it('allows valid characters in name field', async () => {
    render(<WorkflowsPanel workflows={[]} loading={false} refetch={vi.fn()} skills={null} />)
    fireEvent.click(screen.getByText('New'))
    const nameInput = screen.getByPlaceholderText('my-workflow')
    fireEvent.change(nameInput, { target: { value: 'my-workflow_123' } })
    expect(nameInput.value).toBe('my-workflow_123')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Save — POST (new workflow)
// ──────────────────────────────────────────────────────────────────────────────
describe('WorkflowsPanel — save new workflow (POST)', () => {
  it('shows conflict error when server returns 409', async () => {
    server.use(
      http.post('/api/workflows', () =>
        HttpResponse.json({ error: 'Already exists' }, { status: 409 }),
      ),
    )
    const refetch = vi.fn()
    render(<WorkflowsPanel workflows={[]} loading={false} refetch={refetch} skills={null} />)
    fireEvent.click(screen.getByText('New'))
    const nameInput = screen.getByPlaceholderText('my-workflow')
    fireEvent.change(nameInput, { target: { value: 'my-workflow' } })
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }))
    await screen.findByText('A workflow with that name already exists.')
    expect(refetch).not.toHaveBeenCalled()
  })

  it('calls refetch() on successful POST', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined)
    render(<WorkflowsPanel workflows={[]} loading={false} refetch={refetch} skills={null} />)
    fireEvent.click(screen.getByText('New'))
    const nameInput = screen.getByPlaceholderText('my-workflow')
    fireEvent.change(nameInput, { target: { value: 'my-workflow' } })
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }))
    await waitFor(() => expect(refetch).toHaveBeenCalled())
  })

  it('save button is disabled when name is empty', () => {
    render(<WorkflowsPanel workflows={[]} loading={false} refetch={vi.fn()} skills={null} />)
    fireEvent.click(screen.getByText('New'))
    const saveBtn = screen.getByRole('button', { name: /^Save$/i })
    expect(saveBtn).toBeDisabled()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Save — PUT (existing workflow)
// ──────────────────────────────────────────────────────────────────────────────
describe('WorkflowsPanel — save existing workflow (PUT)', () => {
  it('calls refetch() on successful PUT', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined)
    render(
      <WorkflowsPanel
        workflows={SAMPLE_WORKFLOWS}
        loading={false}
        refetch={refetch}
        skills={null}
      />,
    )
    fireEvent.click(screen.getByText('my-workflow'))
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }))
    await waitFor(() => expect(refetch).toHaveBeenCalled())
  })

  it('shows error message on PUT failure', async () => {
    server.use(
      http.put('/api/workflows/:name', () =>
        HttpResponse.json({ error: 'Server error' }, { status: 500 }),
      ),
    )
    const refetch = vi.fn()
    render(
      <WorkflowsPanel
        workflows={SAMPLE_WORKFLOWS}
        loading={false}
        refetch={refetch}
        skills={null}
      />,
    )
    fireEvent.click(screen.getByText('my-workflow'))
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }))
    await screen.findByText('Failed to save workflow.')
    expect(refetch).not.toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Export
// ──────────────────────────────────────────────────────────────────────────────
describe('WorkflowsPanel — export', () => {
  it('shows conflict UI (Overwrite / Cancel) on 409 export', async () => {
    server.use(
      http.post('/api/workflows/:name/export', () =>
        HttpResponse.json({ error: 'Conflict' }, { status: 409 }),
      ),
    )
    render(
      <WorkflowsPanel
        workflows={SAMPLE_WORKFLOWS}
        loading={false}
        refetch={vi.fn()}
        skills={null}
      />,
    )
    fireEvent.click(screen.getByText('my-workflow'))
    fireEvent.click(screen.getByRole('button', { name: /Export as Skill/i }))
    expect(await screen.findByRole('button', { name: /Overwrite/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Cancel$/i })).toBeInTheDocument()
  })

  it('clicking Overwrite re-POSTs with overwrite:true', async () => {
    let capturedBody = null
    server.use(
      http.post('/api/workflows/:name/export', async ({ request }) => {
        capturedBody = await request.json()
        if (capturedBody?.overwrite) return HttpResponse.json({ ok: true })
        return HttpResponse.json({ error: 'Conflict' }, { status: 409 })
      }),
    )
    render(
      <WorkflowsPanel
        workflows={SAMPLE_WORKFLOWS}
        loading={false}
        refetch={vi.fn()}
        skills={null}
      />,
    )
    fireEvent.click(screen.getByText('my-workflow'))
    fireEvent.click(screen.getByRole('button', { name: /Export as Skill/i }))
    const overwriteBtn = await screen.findByRole('button', { name: /Overwrite/i })
    fireEvent.click(overwriteBtn)
    await waitFor(() => expect(capturedBody).toEqual({ overwrite: true }))
  })

  it('shows exported success badge on successful export', async () => {
    render(
      <WorkflowsPanel
        workflows={SAMPLE_WORKFLOWS}
        loading={false}
        refetch={vi.fn()}
        skills={null}
      />,
    )
    fireEvent.click(screen.getByText('my-workflow'))
    fireEvent.click(screen.getByRole('button', { name: /Export as Skill/i }))
    await screen.findByText(/Exported as/)
  })

  it('Cancel button in conflict UI dismisses the conflict state', async () => {
    server.use(
      http.post('/api/workflows/:name/export', () =>
        HttpResponse.json({ error: 'Conflict' }, { status: 409 }),
      ),
    )
    render(
      <WorkflowsPanel
        workflows={SAMPLE_WORKFLOWS}
        loading={false}
        refetch={vi.fn()}
        skills={null}
      />,
    )
    fireEvent.click(screen.getByText('my-workflow'))
    fireEvent.click(screen.getByRole('button', { name: /Export as Skill/i }))
    const cancelBtn = await screen.findByRole('button', { name: /^Cancel$/i })
    fireEvent.click(cancelBtn)
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Overwrite/i })).not.toBeInTheDocument(),
    )
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Run
// ──────────────────────────────────────────────────────────────────────────────
describe('WorkflowsPanel — run', () => {
  it('Run button is disabled for new (unsaved) workflows', () => {
    render(<WorkflowsPanel workflows={[]} loading={false} refetch={vi.fn()} skills={null} />)
    fireEvent.click(screen.getByText('New'))
    const runBtn = screen.getByRole('button', { name: /^Run$/i })
    expect(runBtn).toBeDisabled()
  })

  it('shows started state on a 202 run', async () => {
    let capturedUrl = null
    server.use(
      http.post('/api/workflows/:name/run', ({ request }) => {
        capturedUrl = new URL(request.url).pathname
        return HttpResponse.json(
          { ok: true, status: 'started', sessionId: 'wf-sess-9' },
          { status: 202 },
        )
      }),
    )
    render(
      <WorkflowsPanel
        workflows={SAMPLE_WORKFLOWS}
        loading={false}
        refetch={vi.fn()}
        skills={null}
      />,
    )
    fireEvent.click(screen.getByText('my-workflow'))
    fireEvent.click(screen.getByRole('button', { name: /^Run$/i }))
    await screen.findByText(/Run started/i)
    expect(capturedUrl).toBe('/api/workflows/my-workflow/run')
  })

  it('shows in-progress error when run returns 409', async () => {
    server.use(
      http.post('/api/workflows/:name/run', () =>
        HttpResponse.json({ error: 'in_progress' }, { status: 409 }),
      ),
    )
    render(
      <WorkflowsPanel
        workflows={SAMPLE_WORKFLOWS}
        loading={false}
        refetch={vi.fn()}
        skills={null}
      />,
    )
    fireEvent.click(screen.getByText('my-workflow'))
    fireEvent.click(screen.getByRole('button', { name: /^Run$/i }))
    await screen.findByText('This workflow is already running.')
    expect(screen.queryByText(/Run started/i)).not.toBeInTheDocument()
  })

  it('shows a generic error when run fails (502)', async () => {
    server.use(
      http.post('/api/workflows/:name/run', () =>
        HttpResponse.json({ ok: false, error: 'boom' }, { status: 502 }),
      ),
    )
    render(
      <WorkflowsPanel
        workflows={SAMPLE_WORKFLOWS}
        loading={false}
        refetch={vi.fn()}
        skills={null}
      />,
    )
    fireEvent.click(screen.getByText('my-workflow'))
    fireEvent.click(screen.getByRole('button', { name: /^Run$/i }))
    await screen.findByText('Failed to start workflow.')
    expect(screen.queryByText(/Run started/i)).not.toBeInTheDocument()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Add Step
// ──────────────────────────────────────────────────────────────────────────────
describe('WorkflowsPanel — add step', () => {
  it('clicking "Add Step" opens the dropdown menu', () => {
    render(
      <WorkflowsPanel
        workflows={SAMPLE_WORKFLOWS}
        loading={false}
        refetch={vi.fn()}
        skills={null}
      />,
    )
    fireEvent.click(screen.getByText('my-workflow'))
    fireEvent.click(screen.getByText('Add Step'))
    expect(screen.getByRole('button', { name: /^skill$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^agent$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^instruction$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^command$/i })).toBeInTheDocument()
  })

  it('clicking a step type adds it to the list and opens StepEditor', () => {
    render(
      <WorkflowsPanel
        workflows={SAMPLE_WORKFLOWS}
        loading={false}
        refetch={vi.fn()}
        skills={null}
      />,
    )
    fireEvent.click(screen.getByText('my-workflow'))
    fireEvent.click(screen.getByText('Add Step'))
    fireEvent.click(screen.getByRole('button', { name: /^instruction$/i }))
    // dropdown should close
    expect(screen.queryByRole('button', { name: /^skill$/i })).not.toBeInTheDocument()
    // StepEditor modal should appear — the header shows the step type; CSS capitalizes it
    // but DOM text content is still lowercase: "instruction Step"
    expect(screen.getByText(/instruction Step/i)).toBeInTheDocument()
  })

  it('clicking command type adds a command step', () => {
    render(
      <WorkflowsPanel
        workflows={[{ name: 'wf', description: '', steps: [] }]}
        loading={false}
        refetch={vi.fn()}
        skills={null}
      />,
    )
    fireEvent.click(screen.getByText('wf'))
    fireEvent.click(screen.getByText('Add Step'))
    fireEvent.click(screen.getByRole('button', { name: /^command$/i }))
    // StepEditor modal should open with command type header
    expect(screen.getByText(/command Step/i)).toBeInTheDocument()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// StepEditor
// ──────────────────────────────────────────────────────────────────────────────
describe('WorkflowsPanel — StepEditor', () => {
  it('shows a select populated from skills.userSkills for a skill step', () => {
    render(
      <WorkflowsPanel
        workflows={[{ name: 'wf', description: '', steps: [] }]}
        loading={false}
        refetch={vi.fn()}
        skills={SAMPLE_SKILLS}
      />,
    )
    fireEvent.click(screen.getByText('wf'))
    fireEvent.click(screen.getByText('Add Step'))
    fireEvent.click(screen.getByRole('button', { name: /^skill$/i }))
    // The StepEditor modal should show the skill select
    const select = screen.getByRole('combobox')
    expect(select).toBeInTheDocument()
    // Each user skill should appear as an option
    expect(screen.getByRole('option', { name: /my-skill/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /other-skill/i })).toBeInTheDocument()
  })

  it('saving the step editor updates the step at the correct index', async () => {
    render(
      <WorkflowsPanel
        workflows={[{ name: 'wf', description: '', steps: [] }]}
        loading={false}
        refetch={vi.fn()}
        skills={SAMPLE_SKILLS}
      />,
    )
    fireEvent.click(screen.getByText('wf'))
    fireEvent.click(screen.getByText('Add Step'))
    fireEvent.click(screen.getByRole('button', { name: /^instruction$/i }))
    // Type something in the instruction textarea
    const textarea = screen.getByPlaceholderText(/Plain instruction for Claude/i)
    fireEvent.change(textarea, { target: { value: 'Do the thing' } })
    // Click Save in the StepEditor modal — find it by its container (the fixed overlay)
    const modal = document.querySelector('.fixed.inset-0.z-50')
    expect(modal).toBeTruthy()
    const modalSaveBtn = modal.querySelector('button.bg-indigo-600')
    expect(modalSaveBtn).toBeTruthy()
    fireEvent.click(modalSaveBtn)
    // Modal should close (no more fixed overlay)
    await waitFor(() => expect(document.querySelector('.fixed.inset-0.z-50')).toBeNull())
    // Step should appear in the list
    expect(screen.getByText('Do the thing')).toBeInTheDocument()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Reorder steps
// ──────────────────────────────────────────────────────────────────────────────
describe('WorkflowsPanel — reorder steps', () => {
  const TWO_STEP_WORKFLOWS = [
    {
      name: 'wf',
      description: '',
      steps: [
        { id: '1', type: 'instruction', text: 'Step One' },
        { id: '2', type: 'instruction', text: 'Step Two' },
      ],
    },
  ]

  it('first step Up button is disabled', () => {
    render(
      <WorkflowsPanel
        workflows={TWO_STEP_WORKFLOWS}
        loading={false}
        refetch={vi.fn()}
        skills={null}
      />,
    )
    fireEvent.click(screen.getByText('wf'))

    const stepRows = document.querySelectorAll('.bg-gray-800\\/50')
    expect(stepRows.length).toBeGreaterThanOrEqual(1)
    const firstRowButtons = stepRows[0].querySelectorAll('button')
    const upBtn = firstRowButtons[0]
    expect(upBtn.disabled).toBe(true)
  })

  it('last step Down button is disabled', () => {
    render(
      <WorkflowsPanel
        workflows={TWO_STEP_WORKFLOWS}
        loading={false}
        refetch={vi.fn()}
        skills={null}
      />,
    )
    fireEvent.click(screen.getByText('wf'))

    const stepRows = document.querySelectorAll('.bg-gray-800\\/50')
    const lastRowButtons = stepRows[stepRows.length - 1].querySelectorAll('button')
    const downBtn = lastRowButtons[1]
    expect(downBtn.disabled).toBe(true)
  })

  it('Down button moves step down (first step becomes second)', () => {
    render(
      <WorkflowsPanel
        workflows={TWO_STEP_WORKFLOWS}
        loading={false}
        refetch={vi.fn()}
        skills={null}
      />,
    )
    fireEvent.click(screen.getByText('wf'))

    let steps = screen.getAllByText(/^Step (One|Two)$/)
    expect(steps[0].textContent).toBe('Step One')
    expect(steps[1].textContent).toBe('Step Two')

    const stepRows = document.querySelectorAll('.bg-gray-800\\/50')
    const firstRowButtons = stepRows[0].querySelectorAll('button')
    const downBtn = firstRowButtons[1]
    expect(downBtn.disabled).toBe(false)
    fireEvent.click(downBtn)

    const stepsAfter = screen.getAllByText(/^Step (One|Two)$/)
    expect(stepsAfter[0].textContent).toBe('Step Two')
    expect(stepsAfter[1].textContent).toBe('Step One')
  })

  it('Up button moves step up (when not at index 0)', () => {
    render(
      <WorkflowsPanel
        workflows={TWO_STEP_WORKFLOWS}
        loading={false}
        refetch={vi.fn()}
        skills={null}
      />,
    )
    fireEvent.click(screen.getByText('wf'))

    const stepRows = document.querySelectorAll('.bg-gray-800\\/50')
    expect(stepRows.length).toBeGreaterThanOrEqual(2)
    const secondRowButtons = stepRows[1].querySelectorAll('button')
    const upBtn = secondRowButtons[0]
    expect(upBtn.disabled).toBe(false)
    fireEvent.click(upBtn)

    const stepsAfter = screen.getAllByText(/^Step (One|Two)$/)
    expect(stepsAfter[0].textContent).toBe('Step Two')
    expect(stepsAfter[1].textContent).toBe('Step One')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Delete step
// ──────────────────────────────────────────────────────────────────────────────
describe('WorkflowsPanel — delete step', () => {
  it('clicking X on a step removes it from the list', () => {
    render(
      <WorkflowsPanel
        workflows={SAMPLE_WORKFLOWS}
        loading={false}
        refetch={vi.fn()}
        skills={null}
      />,
    )
    fireEvent.click(screen.getByText('my-workflow'))

    expect(screen.getByText('Do thing')).toBeInTheDocument()

    const stepRows = document.querySelectorAll('.bg-gray-800\\/50')
    expect(stepRows.length).toBe(2)

    // Each step row has [ChevronUp, ChevronDown, Pencil, X-delete]
    const firstRowButtons = stepRows[0].querySelectorAll('button')
    const deleteBtn = firstRowButtons[3]
    fireEvent.click(deleteBtn)

    expect(screen.queryByText('Do thing')).not.toBeInTheDocument()
    expect(screen.getAllByText(/npm run build/)).toHaveLength(1)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Delete workflow
// ──────────────────────────────────────────────────────────────────────────────
describe('WorkflowsPanel — delete workflow', () => {
  it('clicking X on a workflow in the sidebar opens confirm dialog', () => {
    render(
      <WorkflowsPanel
        workflows={SAMPLE_WORKFLOWS}
        loading={false}
        refetch={vi.fn()}
        skills={null}
      />,
    )
    const sidebarDeleteBtns = document.querySelectorAll('button[title="Delete workflow"]')
    expect(sidebarDeleteBtns.length).toBe(2)
    fireEvent.click(sidebarDeleteBtns[0])
    // The delete dialog shows the name inside a <span>, then "?" separately
    expect(screen.getByText('my-workflow', { selector: 'span.font-semibold' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Delete$/i })).toBeInTheDocument()
  })

  it('clicking Delete in confirm dialog calls DELETE and clears editor', async () => {
    let deleteCallCount = 0
    server.use(
      http.delete('/api/workflows/:name', () => {
        deleteCallCount++
        return HttpResponse.json({ ok: true })
      }),
    )
    const refetch = vi.fn().mockResolvedValue(undefined)
    render(
      <WorkflowsPanel
        workflows={SAMPLE_WORKFLOWS}
        loading={false}
        refetch={refetch}
        skills={null}
      />,
    )

    fireEvent.click(screen.getByText('my-workflow'))
    expect(screen.getByDisplayValue('my-workflow')).toBeInTheDocument()

    const sidebarButtons = document.querySelectorAll('button[title="Delete workflow"]')
    fireEvent.click(sidebarButtons[0])

    fireEvent.click(screen.getByRole('button', { name: /^Delete$/i }))

    await waitFor(() => expect(deleteCallCount).toBe(1))
    await waitFor(() => expect(refetch).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByDisplayValue('my-workflow')).not.toBeInTheDocument())
  })

  it('cancel button in delete dialog dismisses it', () => {
    render(
      <WorkflowsPanel
        workflows={SAMPLE_WORKFLOWS}
        loading={false}
        refetch={vi.fn()}
        skills={null}
      />,
    )
    const sidebarDeleteBtns = document.querySelectorAll('button[title="Delete workflow"]')
    fireEvent.click(sidebarDeleteBtns[0])
    expect(screen.getByText('my-workflow', { selector: 'span.font-semibold' })).toBeInTheDocument()
    // The cancel button is inside the modal — only one Cancel button in scope
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }))
    // The delete dialog should be gone
    expect(screen.queryByRole('button', { name: /^Delete$/i })).not.toBeInTheDocument()
  })
})
