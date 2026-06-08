import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { TrustedFoldersTab } from '../../components/settings/TrustedFoldersTab.jsx'

// Stub FolderPicker so the grant flow is testable without the fs-browser modal:
// it just renders a button that selects a fixed path.
vi.mock('../../components/FolderPicker.jsx', () => ({
  FolderPicker: ({ onSelect }) => (
    <button onClick={() => onSelect('C:/work/to-trust')}>pick-folder</button>
  ),
}))

describe('TrustedFoldersTab', () => {
  it('lists trusted folders and shows the danger warning', async () => {
    server.use(http.get('/api/trust', () => HttpResponse.json({ trusted: ['C:/work/a'] })))
    render(<TrustedFoldersTab />)
    expect(await screen.findByText('C:/work/a')).toBeInTheDocument()
    expect(screen.getByText(/--dangerously-skip-permissions/)).toBeInTheDocument()
  })

  it('shows the empty state when nothing is trusted', async () => {
    server.use(http.get('/api/trust', () => HttpResponse.json({ trusted: [] })))
    render(<TrustedFoldersTab />)
    expect(await screen.findByText(/No trusted folders/i)).toBeInTheDocument()
  })

  it('grants trust for the picked folder (POST) and refreshes the list', async () => {
    server.use(
      http.get('/api/trust', () => HttpResponse.json({ trusted: [] })),
      http.post('/api/trust', async ({ request }) => {
        const body = await request.json()
        return HttpResponse.json({ ok: true, trusted: [body.cwd] })
      }),
    )
    render(<TrustedFoldersTab />)
    await screen.findByText(/No trusted folders/i)
    fireEvent.click(screen.getByRole('button', { name: /trust a folder/i }))
    fireEvent.click(screen.getByText('pick-folder'))
    expect(await screen.findByText('C:/work/to-trust')).toBeInTheDocument()
  })

  it('revokes trust (DELETE) and removes the folder', async () => {
    let deleted = null
    server.use(
      http.get('/api/trust', () => HttpResponse.json({ trusted: ['C:/work/a'] })),
      http.delete('/api/trust', async ({ request }) => {
        deleted = (await request.json()).cwd
        return HttpResponse.json({ ok: true, trusted: [] })
      }),
    )
    render(<TrustedFoldersTab />)
    fireEvent.click(await screen.findByRole('button', { name: /Revoke trust for C:\/work\/a/i }))
    await waitFor(() => expect(deleted).toBe('C:/work/a'))
    await waitFor(() => expect(screen.queryByText('C:/work/a')).not.toBeInTheDocument())
  })
})
