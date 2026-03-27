import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { server } from '../mocks/server.js'
import { http, HttpResponse } from 'msw'
import { LiveFeed } from '../../components/LiveFeed.jsx'

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

const SAMPLE_EVENTS = [
  { type: 'session_update', data: { filePath: 'projects/C--Users-me-my-project/abc123.jsonl', ts: 1711500000000 } },
  { type: 'task_update', data: { filePath: 'tasks/sess1/1.json', ts: 1711500001000 } },
  { type: 'heartbeat', data: { ts: 1711500002000 } },
]

describe('LiveFeed', () => {
  it('shows "Watching for changes..." when events is empty', () => {
    render(<LiveFeed events={[]} />)
    expect(screen.getByText('Watching for changes...')).toBeInTheDocument()
  })

  it('renders event count badge', () => {
    render(<LiveFeed events={SAMPLE_EVENTS} />)
    // heartbeat is filtered, so 2 visible events
    expect(screen.getByText('2 events')).toBeInTheDocument()
  })

  it('filters out heartbeat events', () => {
    render(<LiveFeed events={SAMPLE_EVENTS} />)
    // There should be 2 visible event rows, not 3
    const items = screen.getAllByText(/session updated|task changed/)
    expect(items).toHaveLength(2)
  })

  it('displays session_update event with project name', () => {
    render(<LiveFeed events={SAMPLE_EVENTS} />)
    // describeEvent extracts project name via split('-').pop(), yielding 'project'
    expect(screen.getByText(/session updated · project/)).toBeInTheDocument()
  })

  it('displays new_session, task_update, team_update events', () => {
    const events = [
      { type: 'new_session', data: { filePath: 'projects/C--Users-me-app/new.jsonl', ts: 1711500000000 } },
      { type: 'task_update', data: { filePath: 'tasks/sess1/1.json', ts: 1711500001000 } },
      { type: 'team_update', data: { filePath: 'teams/alpha/inbox.json', ts: 1711500002000 } },
    ]
    render(<LiveFeed events={events} />)
    expect(screen.getByText(/new session/)).toBeInTheDocument()
    expect(screen.getByText(/task changed/)).toBeInTheDocument()
    expect(screen.getByText(/team update/)).toBeInTheDocument()
  })

  it('displays history_update event', () => {
    const events = [
      { type: 'history_update', data: { ts: 1711500000000 } },
    ]
    render(<LiveFeed events={events} />)
    expect(screen.getByText('history updated')).toBeInTheDocument()
  })

  it('handles unknown event type', () => {
    const events = [
      { type: 'custom_unknown', data: { ts: 1711500000000 } },
    ]
    render(<LiveFeed events={events} />)
    expect(screen.getByText('custom_unknown')).toBeInTheDocument()
  })
})
