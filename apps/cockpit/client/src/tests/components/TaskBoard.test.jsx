import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { server } from '../mocks/server.js'
import { http, HttpResponse } from 'msw'
import { TaskBoard } from '../../components/TaskBoard.jsx'

const SAMPLE_TASKS = [
  {
    id: '1',
    subject: 'Task A',
    status: 'in_progress',
    activeForm: 'Working on it',
    owner: 'alice',
    description: 'desc',
    blockedBy: [],
  },
  { id: '2', subject: 'Task B', status: 'pending', owner: '', description: '', blockedBy: ['1'] },
  { id: '3', subject: 'Task C', status: 'completed', owner: '', description: '', blockedBy: [] },
]

const defaultProps = () => ({
  tasks: SAMPLE_TASKS,
  loading: false,
  sessionId: 'test-session',
  refetch: vi.fn(),
})

describe('TaskBoard', () => {
  it('shows loading state text', () => {
    render(<TaskBoard tasks={[]} loading={true} sessionId="test-session" refetch={vi.fn()} />)
    expect(screen.getByText('Loading tasks...')).toBeInTheDocument()
  })

  it('shows empty state when tasks is empty array', () => {
    render(<TaskBoard tasks={[]} loading={false} sessionId="test-session" refetch={vi.fn()} />)
    expect(screen.getByText(/no tasks for this session/i)).toBeInTheDocument()
  })

  it('shows an error state with a working Retry when the fetch failed', async () => {
    const refetch = vi.fn()
    render(
      <TaskBoard
        tasks={null}
        loading={false}
        error="HTTP 500"
        sessionId="test-session"
        refetch={refetch}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 500')
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(refetch).toHaveBeenCalled()
  })

  it('groups tasks by status', () => {
    render(<TaskBoard {...defaultProps()} />)
    expect(screen.getByText('Task A')).toBeInTheDocument()
    expect(screen.getByText('Task B')).toBeInTheDocument()
    expect(screen.getByText('Task C')).toBeInTheDocument()
  })

  it('shows section headers with counts', () => {
    // Section labels were renamed to match the form values exactly
    // (commit 3b877a8): Active → In Progress, Done → Completed.
    render(<TaskBoard {...defaultProps()} />)
    expect(screen.getByText('In Progress (1)')).toBeInTheDocument()
    expect(screen.getByText('Pending (1)')).toBeInTheDocument()
    expect(screen.getByText('Completed (1)')).toBeInTheDocument()
  })

  it('shows "+ New Task" button', () => {
    render(<TaskBoard {...defaultProps()} />)
    expect(screen.getByText('+ New Task')).toBeInTheDocument()
  })

  it('clicking "+ New Task" shows create form', async () => {
    render(<TaskBoard {...defaultProps()} />)
    await userEvent.click(screen.getByText('+ New Task'))
    expect(screen.getByPlaceholderText('Subject (required)')).toBeInTheDocument()
  })

  it('Save disabled when subject is empty', async () => {
    render(<TaskBoard {...defaultProps()} />)
    await userEvent.click(screen.getByText('+ New Task'))
    const saveBtn = screen.getByText('Save')
    expect(saveBtn).toBeDisabled()
  })

  it('submits POST on save', async () => {
    let capturedBody = null
    server.use(
      http.post('/api/tasks/:sessionId', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json(
          { id: '99', subject: capturedBody.subject, status: 'pending' },
          { status: 201 },
        )
      }),
    )
    const props = defaultProps()
    render(<TaskBoard {...props} />)
    await userEvent.click(screen.getByText('+ New Task'))
    await userEvent.type(screen.getByPlaceholderText('Subject (required)'), 'New task subject')
    await userEvent.click(screen.getByText('Save'))
    await waitFor(() => {
      expect(capturedBody).toBeTruthy()
      expect(capturedBody.subject).toBe('New task subject')
    })
  })

  it('Edit button shows edit form with pre-filled values', async () => {
    render(<TaskBoard {...defaultProps()} />)
    const editButtons = screen.getAllByText('Edit')
    await userEvent.click(editButtons[0])
    const subjectInput = screen.getByDisplayValue('Task A')
    expect(subjectInput).toBeInTheDocument()
  })

  it('delete shows confirm/cancel buttons', async () => {
    render(<TaskBoard {...defaultProps()} />)
    // Click the delete button (✕)
    const deleteButtons = screen.getAllByText('✕')
    await userEvent.click(deleteButtons[0])
    expect(screen.getByText('Confirm')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('confirm delete sends DELETE request', async () => {
    let deleteCalled = false
    server.use(
      http.delete('/api/tasks/:sessionId/:taskId', () => {
        deleteCalled = true
        return HttpResponse.json({ ok: true })
      }),
    )
    const props = defaultProps()
    render(<TaskBoard {...props} />)
    const deleteButtons = screen.getAllByText('✕')
    await userEvent.click(deleteButtons[0])
    await userEvent.click(screen.getByText('Confirm'))
    await waitFor(() => {
      expect(deleteCalled).toBe(true)
    })
  })
})
