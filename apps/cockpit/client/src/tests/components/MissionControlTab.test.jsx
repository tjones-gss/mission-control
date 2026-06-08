import { render, screen, fireEvent } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { MissionControlTab } from '../../components/MissionControlTab/MissionControlTab.jsx'

function mockProjects(projects) {
  server.use(http.get('/api/harness', () => HttpResponse.json({ projects })))
}

describe('MissionControlTab — new project affordance', () => {
  it('renders a "New" button in the header', async () => {
    mockProjects([])
    render(<MissionControlTab harnessVersion={0} />)
    expect(await screen.findByRole('button', { name: /^new$/i })).toBeInTheDocument()
  })

  it('offers a create button in the empty state and opens the dialog', async () => {
    mockProjects([])
    server.use(
      http.get('/api/harness/scaffold-candidates', () =>
        HttpResponse.json({ candidates: ['C:/work/fresh-app'] }),
      ),
    )
    render(<MissionControlTab harnessVersion={0} />)

    const emptyCta = await screen.findByRole('button', { name: /new harness project/i })
    fireEvent.click(emptyCta)

    // Dialog opened.
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(await screen.findByLabelText('Directory')).toHaveValue('C:/work/fresh-app')
  })

  it('opens the dialog from the header button', async () => {
    mockProjects([{ projectKey: 'k', projectLabel: 'proj', available: true, mode: 'bugfix' }])
    server.use(
      http.get('/api/harness/scaffold-candidates', () =>
        HttpResponse.json({ candidates: ['C:/work/x'] }),
      ),
    )
    render(<MissionControlTab harnessVersion={0} />)

    fireEvent.click(await screen.findByRole('button', { name: /^new$/i }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /new harness project/i })).toBeInTheDocument()
  })
})
