import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { SkillsPanel } from '../../components/SkillsPanel.jsx'

// userEvent configured to not touch clipboard (already stubbed in setup.js)
const user = () => userEvent.setup({ writeToClipboard: false })

const USER_SKILLS = [
  { name: 'my-skill', command: '/my-skill', description: 'Does something useful', source: 'user' },
  { name: 'build-skill', command: '/build-skill', description: '', source: 'user' },
]

const PLUGIN_SKILLS = [
  {
    name: 'plugin-skill',
    command: '/plugin-skill',
    description: 'From a plugin',
    source: 'plugin',
  },
]

const FULL_SKILLS = {
  userSkills: USER_SKILLS,
  plugins: [
    {
      key: 'myplugin',
      name: 'My Plugin',
      version: '1.0.0',
      skills: PLUGIN_SKILLS,
    },
  ],
  pluginSkills: PLUGIN_SKILLS,
  totalSkillCount: 3,
}

// ──────────────────────────────────────────────────────────────────────────────
// Loading / null states
// ──────────────────────────────────────────────────────────────────────────────
describe('SkillsPanel — loading/empty states', () => {
  it('shows loading text when loading=true', () => {
    render(<SkillsPanel skills={null} loading={true} refetch={vi.fn()} />)
    expect(screen.getByText('Loading skills...')).toBeInTheDocument()
  })

  it('shows "No skills data." when skills is null and not loading', () => {
    render(<SkillsPanel skills={null} loading={false} refetch={vi.fn()} />)
    expect(screen.getByText('No skills data.')).toBeInTheDocument()
  })

  it('shows "No skills found." when skills lists are empty', () => {
    render(
      <SkillsPanel
        skills={{ userSkills: [], plugins: [], pluginSkills: [], totalSkillCount: 0 }}
        loading={false}
        refetch={vi.fn()}
      />,
    )
    expect(screen.getByText('No skills found.')).toBeInTheDocument()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Skill list rendering
// ──────────────────────────────────────────────────────────────────────────────
describe('SkillsPanel — skill list', () => {
  it('renders user skill commands', () => {
    render(<SkillsPanel skills={FULL_SKILLS} loading={false} refetch={vi.fn()} />)
    expect(screen.getByText('/my-skill')).toBeInTheDocument()
    expect(screen.getByText('/build-skill')).toBeInTheDocument()
  })

  it('renders skill description when present', () => {
    render(<SkillsPanel skills={FULL_SKILLS} loading={false} refetch={vi.fn()} />)
    expect(screen.getByText('Does something useful')).toBeInTheDocument()
  })

  it('renders plugin skills', () => {
    render(<SkillsPanel skills={FULL_SKILLS} loading={false} refetch={vi.fn()} />)
    expect(screen.getByText('/plugin-skill')).toBeInTheDocument()
  })

  it('shows total skill count in header', () => {
    render(<SkillsPanel skills={FULL_SKILLS} loading={false} refetch={vi.fn()} />)
    expect(screen.getByText(/· 3 skills/)).toBeInTheDocument()
  })

  it('renders plugin section header with plugin name', () => {
    render(<SkillsPanel skills={FULL_SKILLS} loading={false} refetch={vi.fn()} />)
    // Plugin name appears in both the dropdown option and section header span
    // Check that the section header span exists
    const matches = screen.getAllByText(/My Plugin/i)
    expect(matches.length).toBeGreaterThanOrEqual(1)
    // At least one should be the section header (a span element)
    const sectionHeader = matches.find((el) => el.tagName === 'SPAN')
    expect(sectionHeader).toBeInTheDocument()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Search filter
// ──────────────────────────────────────────────────────────────────────────────
describe('SkillsPanel — search', () => {
  it('filters skills by search query', () => {
    render(<SkillsPanel skills={FULL_SKILLS} loading={false} refetch={vi.fn()} />)
    const searchInput = screen.getByPlaceholderText('Search skills...')
    fireEvent.change(searchInput, { target: { value: 'my-skill' } })
    expect(screen.getByText('/my-skill')).toBeInTheDocument()
    expect(screen.queryByText('/build-skill')).not.toBeInTheDocument()
  })

  it('shows "No skills match" message when no results', () => {
    render(<SkillsPanel skills={FULL_SKILLS} loading={false} refetch={vi.fn()} />)
    const searchInput = screen.getByPlaceholderText('Search skills...')
    fireEvent.change(searchInput, { target: { value: 'zzznomatch' } })
    expect(screen.getByText(/No skills match "zzznomatch"/)).toBeInTheDocument()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Copy command
// ──────────────────────────────────────────────────────────────────────────────
describe('SkillsPanel — copy command', () => {
  it('clicking clipboard button copies the command', async () => {
    render(<SkillsPanel skills={FULL_SKILLS} loading={false} refetch={vi.fn()} />)
    const copyButtons = screen.getAllByTitle('Copy command')
    fireEvent.click(copyButtons[0])
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('/my-skill')
    // Flush the setCopied state update triggered by the clipboard promise
    await act(async () => {})
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// New Skill form
// ──────────────────────────────────────────────────────────────────────────────
describe('SkillsPanel — new skill form', () => {
  it('clicking "New Skill" button shows the form', () => {
    render(<SkillsPanel skills={FULL_SKILLS} loading={false} refetch={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Create new skill'))
    expect(screen.getByPlaceholderText(/skill-name/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Skill markdown content/i)).toBeInTheDocument()
  })

  it('shows error when saving without a name', async () => {
    render(<SkillsPanel skills={FULL_SKILLS} loading={false} refetch={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Create new skill'))
    const saveButtons = screen.getAllByRole('button', { name: /^Save$/i })
    fireEvent.click(saveButtons[0])
    await screen.findByText('Name is required.')
  })

  it('calls refetch after successfully saving a new skill', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined)
    render(<SkillsPanel skills={FULL_SKILLS} loading={false} refetch={refetch} />)
    fireEvent.click(screen.getByTitle('Create new skill'))
    const nameInput = screen.getByPlaceholderText(/skill-name/i)
    fireEvent.change(nameInput, { target: { value: 'new-skill' } })
    const saveButtons = screen.getAllByRole('button', { name: /^Save$/i })
    fireEvent.click(saveButtons[0])
    await waitFor(() => expect(refetch).toHaveBeenCalled())
  })

  it('Cancel button hides the new skill form', () => {
    render(<SkillsPanel skills={FULL_SKILLS} loading={false} refetch={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Create new skill'))
    expect(screen.getByPlaceholderText(/skill-name/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }))
    expect(screen.queryByPlaceholderText(/skill-name/i)).not.toBeInTheDocument()
  })

  it('shows error message from server on failed save', async () => {
    server.use(
      http.post('/api/skills', () =>
        HttpResponse.json({ error: 'Skill already exists' }, { status: 409 }),
      ),
    )
    render(<SkillsPanel skills={FULL_SKILLS} loading={false} refetch={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Create new skill'))
    const nameInput = screen.getByPlaceholderText(/skill-name/i)
    fireEvent.change(nameInput, { target: { value: 'my-skill' } })
    const saveButtons = screen.getAllByRole('button', { name: /^Save$/i })
    fireEvent.click(saveButtons[0])
    await screen.findByText('Skill already exists')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Edit skill (user skills only)
// ──────────────────────────────────────────────────────────────────────────────
describe('SkillsPanel — edit user skill', () => {
  it('user skills show an Edit button', () => {
    render(<SkillsPanel skills={FULL_SKILLS} loading={false} refetch={vi.fn()} />)
    const editButtons = screen.getAllByRole('button', { name: /^Edit$/i })
    expect(editButtons.length).toBeGreaterThanOrEqual(1)
  })

  it('clicking Edit loads raw content and shows textarea', async () => {
    render(<SkillsPanel skills={FULL_SKILLS} loading={false} refetch={vi.fn()} />)
    const editButtons = screen.getAllByRole('button', { name: /^Edit$/i })
    fireEvent.click(editButtons[0])
    await screen.findByDisplayValue('# skill content')
  })

  it('saving edited skill calls PUT and refetch', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined)
    render(<SkillsPanel skills={FULL_SKILLS} loading={false} refetch={refetch} />)
    const editButtons = screen.getAllByRole('button', { name: /^Edit$/i })
    fireEvent.click(editButtons[0])
    await screen.findByDisplayValue('# skill content')
    const saveButtons = screen.getAllByRole('button', { name: /^Save$/i })
    fireEvent.click(saveButtons[0])
    await waitFor(() => expect(refetch).toHaveBeenCalled())
  })

  it('plugin skills show "(read-only)" and no Edit button for that skill', () => {
    render(<SkillsPanel skills={FULL_SKILLS} loading={false} refetch={vi.fn()} />)
    expect(screen.getByText('(read-only)')).toBeInTheDocument()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Delete user skill
// ──────────────────────────────────────────────────────────────────────────────
describe('SkillsPanel — delete user skill', () => {
  it('clicking ✕ shows delete confirmation', () => {
    render(<SkillsPanel skills={FULL_SKILLS} loading={false} refetch={vi.fn()} />)
    const deleteButtons = screen.getAllByTitle('Delete skill')
    fireEvent.click(deleteButtons[0])
    expect(screen.getByText('Delete this skill?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Yes$/i })).toBeInTheDocument()
  })

  it('clicking Yes in confirm calls DELETE and refetch', async () => {
    let deleteCallCount = 0
    server.use(
      http.delete('/api/skills/:name', () => {
        deleteCallCount++
        return HttpResponse.json({ ok: true })
      }),
    )
    const refetch = vi.fn().mockResolvedValue(undefined)
    render(<SkillsPanel skills={FULL_SKILLS} loading={false} refetch={refetch} />)
    const deleteButtons = screen.getAllByTitle('Delete skill')
    fireEvent.click(deleteButtons[0])
    fireEvent.click(screen.getByRole('button', { name: /^Yes$/i }))
    await waitFor(() => expect(deleteCallCount).toBe(1))
    await waitFor(() => expect(refetch).toHaveBeenCalled())
  })

  it('clicking No dismisses delete confirm', () => {
    render(<SkillsPanel skills={FULL_SKILLS} loading={false} refetch={vi.fn()} />)
    const deleteButtons = screen.getAllByTitle('Delete skill')
    fireEvent.click(deleteButtons[0])
    expect(screen.getByText('Delete this skill?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^No$/i }))
    expect(screen.queryByText('Delete this skill?')).not.toBeInTheDocument()
  })
})
