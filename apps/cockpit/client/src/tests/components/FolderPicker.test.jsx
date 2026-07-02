import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { FolderPicker } from '../../components/FolderPicker.jsx'

function stubFs({ home = { path: '/Users/alice', sep: '/' }, lists = {} } = {}) {
  server.use(
    http.get('/api/fs/home', () => HttpResponse.json(home)),
    http.get('/api/fs/list', ({ request }) => {
      const url = new URL(request.url)
      const p = url.searchParams.get('path')
      if (lists[p]) return HttpResponse.json(lists[p])
      return HttpResponse.json({ error: 'not found' }, { status: 404 })
    }),
  )
}

describe('FolderPicker — initial load', () => {
  it('fetches home path on mount and renders it in the breadcrumb', async () => {
    stubFs({
      home: { path: '/Users/alice', sep: '/' },
      lists: {
        '/Users/alice': {
          path: '/Users/alice',
          parent: '/Users',
          sep: '/',
          entries: [{ name: 'Projects', type: 'dir' }],
        },
      },
    })
    render(<FolderPicker onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByText('/Users/alice')).toBeInTheDocument()
    expect(await screen.findByText('Projects')).toBeInTheDocument()
  })

  it('shows loading indicator while fetching', () => {
    stubFs()
    render(<FolderPicker onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('shows error row when list fetch fails', async () => {
    server.use(
      http.get('/api/fs/home', () => HttpResponse.json({ path: '/broken', sep: '/' })),
      http.get('/api/fs/list', () =>
        HttpResponse.json({ error: 'permission denied' }, { status: 403 }),
      ),
    )
    render(<FolderPicker onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByText(/permission denied/i)).toBeInTheDocument()
  })
})

describe('FolderPicker — navigation (POSIX)', () => {
  it('descends into a child directory with POSIX separator', async () => {
    stubFs({
      home: { path: '/Users/alice', sep: '/' },
      lists: {
        '/Users/alice': {
          path: '/Users/alice',
          parent: '/Users',
          sep: '/',
          entries: [{ name: 'Projects', type: 'dir' }],
        },
        '/Users/alice/Projects': {
          path: '/Users/alice/Projects',
          parent: '/Users/alice',
          sep: '/',
          entries: [{ name: 'oversight', type: 'dir' }],
        },
      },
    })
    render(<FolderPicker onSelect={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(await screen.findByText('Projects'))
    expect(await screen.findByText('oversight')).toBeInTheDocument()
    expect(screen.getByText('/Users/alice/Projects')).toBeInTheDocument()
  })

  it('ascends via the ".." button to parent', async () => {
    stubFs({
      home: { path: '/Users/alice/Projects', sep: '/' },
      lists: {
        '/Users/alice/Projects': {
          path: '/Users/alice/Projects',
          parent: '/Users/alice',
          sep: '/',
          entries: [{ name: 'oversight', type: 'dir' }],
        },
        '/Users/alice': {
          path: '/Users/alice',
          parent: '/Users',
          sep: '/',
          entries: [{ name: 'Projects', type: 'dir' }],
        },
      },
    })
    render(<FolderPicker onSelect={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /parent directory/i }))
    expect(await screen.findByText('/Users/alice')).toBeInTheDocument()
  })

  it('hides the ".." button at filesystem root', async () => {
    stubFs({
      home: { path: '/', sep: '/' },
      lists: {
        '/': { path: '/', parent: null, sep: '/', entries: [{ name: 'Users', type: 'dir' }] },
      },
    })
    render(<FolderPicker onSelect={vi.fn()} onClose={vi.fn()} />)
    await screen.findByText('Users')
    expect(screen.queryByRole('button', { name: /parent directory/i })).not.toBeInTheDocument()
  })
})

describe('FolderPicker — navigation (Windows)', () => {
  it('joins child paths using the backslash separator returned by the API', async () => {
    stubFs({
      home: { path: 'C:\\Users\\alice', sep: '\\' },
      lists: {
        'C:\\Users\\alice': {
          path: 'C:\\Users\\alice',
          parent: 'C:\\Users',
          sep: '\\',
          entries: [{ name: 'Projects', type: 'dir' }],
        },
        'C:\\Users\\alice\\Projects': {
          path: 'C:\\Users\\alice\\Projects',
          parent: 'C:\\Users\\alice',
          sep: '\\',
          entries: [{ name: 'oversight', type: 'dir' }],
        },
      },
    })
    render(<FolderPicker onSelect={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(await screen.findByText('Projects'))
    expect(await screen.findByText('oversight')).toBeInTheDocument()
    expect(screen.getByText('C:\\Users\\alice\\Projects')).toBeInTheDocument()
  })

  it('does not double the separator when the current path already ends in one', async () => {
    stubFs({
      home: { path: 'C:\\', sep: '\\' },
      lists: {
        'C:\\': {
          path: 'C:\\',
          parent: null,
          sep: '\\',
          entries: [{ name: 'Users', type: 'dir' }],
        },
        'C:\\Users': {
          path: 'C:\\Users',
          parent: 'C:\\',
          sep: '\\',
          entries: [{ name: 'alice', type: 'dir' }],
        },
      },
    })
    render(<FolderPicker onSelect={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(await screen.findByText('Users'))
    expect(await screen.findByText('alice')).toBeInTheDocument()
    expect(screen.getByText('C:\\Users')).toBeInTheDocument()
  })
})

describe('FolderPicker — selection', () => {
  it('calls onSelect with the current path and then onClose', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    stubFs({
      home: { path: '/Users/alice', sep: '/' },
      lists: {
        '/Users/alice': { path: '/Users/alice', parent: '/Users', sep: '/', entries: [] },
      },
    })
    render(<FolderPicker onSelect={onSelect} onClose={onClose} />)
    fireEvent.click(await screen.findByRole('button', { name: /select this directory/i }))
    expect(onSelect).toHaveBeenCalledWith('/Users/alice')
    expect(onClose).toHaveBeenCalled()
  })

  it('Cancel fires onClose without onSelect', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    stubFs({
      home: { path: '/Users/alice', sep: '/' },
      lists: {
        '/Users/alice': { path: '/Users/alice', parent: '/Users', sep: '/', entries: [] },
      },
    })
    render(<FolderPicker onSelect={onSelect} onClose={onClose} />)
    await screen.findByText('/Users/alice')
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(onClose).toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('FolderPicker — recent chips', () => {
  it('renders recentCwds as clickable chips that immediately select', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    stubFs({
      home: { path: '/Users/alice', sep: '/' },
      lists: {
        '/Users/alice': { path: '/Users/alice', parent: '/Users', sep: '/', entries: [] },
      },
    })
    render(
      <FolderPicker
        onSelect={onSelect}
        onClose={onClose}
        recentCwds={['/Users/alice/Projects/one', '/Users/alice/Projects/two']}
      />,
    )
    fireEvent.click(await screen.findByText('/Users/alice/Projects/one'))
    expect(onSelect).toHaveBeenCalledWith('/Users/alice/Projects/one')
    expect(onClose).toHaveBeenCalled()
  })

  it('renders nothing in the Recent row when recentCwds is empty', async () => {
    stubFs({
      home: { path: '/Users/alice', sep: '/' },
      lists: {
        '/Users/alice': { path: '/Users/alice', parent: '/Users', sep: '/', entries: [] },
      },
    })
    render(<FolderPicker onSelect={vi.fn()} onClose={vi.fn()} recentCwds={[]} />)
    await screen.findByText('/Users/alice')
    expect(screen.queryByText(/recent/i)).not.toBeInTheDocument()
  })
})

describe('FolderPicker — hidden directories', () => {
  it('hides dot-prefixed directories by default', async () => {
    stubFs({
      home: { path: '/Users/alice', sep: '/' },
      lists: {
        '/Users/alice': {
          path: '/Users/alice',
          parent: '/Users',
          sep: '/',
          entries: [
            { name: '.claude', type: 'dir' },
            { name: 'Projects', type: 'dir' },
          ],
        },
      },
    })
    render(<FolderPicker onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByText('Projects')).toBeInTheDocument()
    expect(screen.queryByText('.claude')).not.toBeInTheDocument()
  })

  it('reveals hidden directories when the Show hidden toggle is enabled', async () => {
    stubFs({
      home: { path: '/Users/alice', sep: '/' },
      lists: {
        '/Users/alice': {
          path: '/Users/alice',
          parent: '/Users',
          sep: '/',
          entries: [
            { name: '.claude', type: 'dir' },
            { name: 'Projects', type: 'dir' },
          ],
        },
      },
    })
    render(<FolderPicker onSelect={vi.fn()} onClose={vi.fn()} />)
    await screen.findByText('Projects')
    fireEvent.click(screen.getByLabelText(/show hidden/i))
    await waitFor(() => expect(screen.getByText('.claude')).toBeInTheDocument())
  })
})

describe('FolderPicker — search and jump', () => {
  it('filters directories in the current folder', async () => {
    stubFs({
      home: { path: '/Users/alice', sep: '/' },
      lists: {
        '/Users/alice': {
          path: '/Users/alice',
          parent: '/Users',
          sep: '/',
          entries: [
            { name: 'mission-control', type: 'dir' },
            { name: 'brain', type: 'dir' },
            { name: 'second-grader', type: 'dir' },
          ],
        },
      },
    })
    render(<FolderPicker onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByText('mission-control')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/filter folders/i), { target: { value: 'brain' } })

    expect(screen.getByText('brain')).toBeInTheDocument()
    expect(screen.queryByText('mission-control')).not.toBeInTheDocument()
    expect(screen.queryByText('second-grader')).not.toBeInTheDocument()
  })

  it('jumps directly to an absolute folder path', async () => {
    stubFs({
      home: { path: '/Users/alice', sep: '/' },
      lists: {
        '/Users/alice': {
          path: '/Users/alice',
          parent: '/Users',
          sep: '/',
          entries: [{ name: 'Projects', type: 'dir' }],
        },
        '/Users/alice/Projects/mission-control': {
          path: '/Users/alice/Projects/mission-control',
          parent: '/Users/alice/Projects',
          sep: '/',
          entries: [{ name: 'apps', type: 'dir' }],
        },
      },
    })
    render(<FolderPicker onSelect={vi.fn()} onClose={vi.fn()} />)
    await screen.findByText('/Users/alice')

    fireEvent.change(screen.getByLabelText(/folder path/i), {
      target: { value: '/Users/alice/Projects/mission-control' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^go$/i }))

    expect(await screen.findByText('/Users/alice/Projects/mission-control')).toBeInTheDocument()
    expect(screen.getByText('apps')).toBeInTheDocument()
  })
})

describe('FolderPicker — Home button', () => {
  it('re-fetches /api/fs/home when Home is clicked', async () => {
    stubFs({
      home: { path: '/Users/alice', sep: '/' },
      lists: {
        '/Users/alice': {
          path: '/Users/alice',
          parent: '/Users',
          sep: '/',
          entries: [{ name: 'Projects', type: 'dir' }],
        },
        '/Users/alice/Projects': {
          path: '/Users/alice/Projects',
          parent: '/Users/alice',
          sep: '/',
          entries: [],
        },
      },
    })
    render(<FolderPicker onSelect={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(await screen.findByText('Projects'))
    await screen.findByText('/Users/alice/Projects')
    fireEvent.click(screen.getByRole('button', { name: /^home$/i }))
    expect(await screen.findByText('/Users/alice')).toBeInTheDocument()
  })
})
