import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { HarnessDetail } from '../../components/MissionControlTab/HarnessDetail.jsx'

const PROJECT_KEY = encodeURIComponent('C:/code/demo')

function makeProject(overrides = {}) {
  return {
    projectKey: PROJECT_KEY,
    projectLabel: 'demo',
    projectPath: 'C:/code/demo',
    available: true,
    mode: 'idea-to-mvp',
    pipeline: { phase: 'build' },
    ...overrides,
  }
}

// The /api/harness/:projectKey detail returns the raw `harness status --json`
// object — missions live under a status-keyed map. Stub it with the missions
// the test cares about.
function stubStatus(missions) {
  server.use(
    http.get(`/api/harness/${PROJECT_KEY}`, () =>
      HttpResponse.json({
        project: { name: 'demo' },
        pipeline: { phase: 'build', active: 'mission' },
        missions,
      }),
    ),
  )
}

function renderDetail(project = makeProject()) {
  return render(<HarnessDetail project={project} harnessVersion={0} />)
}

describe('HarnessDetail — mission lifecycle', () => {
  it('shows a Mark ready button on DRAFT missions (no Run on-rails)', async () => {
    stubStatus({ 'MISSION-001-auth': { status: 'draft', priority: 'high' } })
    renderDetail()

    await waitFor(() => expect(screen.getByText('MISSION-001-auth')).toBeInTheDocument())

    // Draft is gated: Mark ready is offered, Run on-rails is NOT.
    expect(screen.getByRole('button', { name: /mark ready/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /run on-rails/i })).not.toBeInTheDocument()
    // And the draft notice spells out the gating.
    expect(screen.getByText(/mark ready before running/i)).toBeInTheDocument()
  })

  it('offers Run on-rails (not Mark ready) once a mission is ready', async () => {
    stubStatus({ 'MISSION-002-api': { status: 'ready', priority: 'medium' } })
    renderDetail()

    await waitFor(() => expect(screen.getByText('MISSION-002-api')).toBeInTheDocument())

    expect(screen.getByRole('button', { name: /run on-rails/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /mark ready/i })).not.toBeInTheDocument()
  })

  it('does not offer Run on-rails for in-progress / review / complete missions', async () => {
    stubStatus({
      'M-inprog': { status: 'in-progress' },
      'M-review': { status: 'review' },
      'M-done': { status: 'complete' },
    })
    renderDetail()

    await waitFor(() => expect(screen.getByText('M-inprog')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: /run on-rails/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /mark ready/i })).not.toBeInTheDocument()
  })

  it('Mark ready POSTs to the ready endpoint and surfaces success', async () => {
    stubStatus({ 'MISSION-001-auth': { status: 'draft' } })

    let capturedUrl = null
    let capturedMethod = null
    server.use(
      http.post(
        '/api/harness/:projectKey/missions/:missionId/ready',
        async ({ request, params }) => {
          capturedUrl = request.url
          capturedMethod = request.method
          return HttpResponse.json({
            ok: true,
            missionId: decodeURIComponent(params.missionId),
            summary: 'mission marked ready',
          })
        },
      ),
    )

    renderDetail()
    await waitFor(() => expect(screen.getByText('MISSION-001-auth')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /mark ready/i }))

    await waitFor(() => {
      expect(capturedMethod).toBe('POST')
      expect(capturedUrl).toContain(`/api/harness/${PROJECT_KEY}/missions/`)
      expect(capturedUrl).toContain(`${encodeURIComponent('MISSION-001-auth')}/ready`)
    })

    // Success toast confirms the flip and points at the now-available run path.
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/marked ready/i),
    )
  })

  it('Mark ready surfaces an error toast when the endpoint fails', async () => {
    stubStatus({ 'MISSION-001-auth': { status: 'draft' } })
    server.use(
      http.post('/api/harness/:projectKey/missions/:missionId/ready', () =>
        HttpResponse.json(
          { ok: false, error: 'mission is `ready`, not `draft`' },
          { status: 502 },
        ),
      ),
    )

    renderDetail()
    await waitFor(() => expect(screen.getByText('MISSION-001-auth')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /mark ready/i }))

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/could not mark .* ready/i),
    )
    // The row stays a draft (still gated) after a failed flip.
    expect(screen.queryByRole('button', { name: /run on-rails/i })).not.toBeInTheDocument()
  })

  it('renders a lifecycle stepper that marks the current step', async () => {
    stubStatus({ 'MISSION-001-auth': { status: 'ready' } })
    renderDetail()

    await waitFor(() => expect(screen.getByText('MISSION-001-auth')).toBeInTheDocument())

    const stepper = screen.getByLabelText(/lifecycle: ready/i)
    // All four lifecycle columns are present.
    expect(within(stepper).getByText('draft')).toBeInTheDocument()
    expect(within(stepper).getByText('ready')).toBeInTheDocument()
    expect(within(stepper).getByText('in-progress')).toBeInTheDocument()
    expect(within(stepper).getByText('complete')).toBeInTheDocument()
  })
})
