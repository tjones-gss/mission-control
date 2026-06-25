import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeatureBrief } from '../../components/FeatureBrief/FeatureBrief.jsx'
import { BRIEFS } from '../../components/FeatureBrief/briefs.js'

// localStorage is shared across tests in jsdom; clear it so the dismissed flag
// from one test doesn't leak into the next.
beforeEach(() => {
  localStorage.clear()
})

// ─── Component ────────────────────────────────────────────────────────────────

describe('FeatureBrief — component', () => {
  it('renders the summary for a known surfaceId', () => {
    render(<FeatureBrief surfaceId="agents" />)
    expect(screen.getByText(BRIEFS.agents.summary)).toBeInTheDocument()
    // Body is hidden until expanded
    expect(screen.queryByText(BRIEFS.agents.body)).not.toBeInTheDocument()
  })

  it('expand toggles the body and flips aria-expanded', async () => {
    render(<FeatureBrief surfaceId="fleet" />)
    const expandBtn = screen.getByRole('button', { expanded: false })
    expect(expandBtn).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(expandBtn)
    expect(screen.getByText(BRIEFS.fleet.body)).toBeInTheDocument()
    expect(screen.getByRole('button', { expanded: true })).toHaveAttribute('aria-expanded', 'true')

    // aria-controls points at the rendered body region
    const controlledId = screen
      .getByRole('button', { expanded: true })
      .getAttribute('aria-controls')
    expect(document.getElementById(controlledId)).toHaveTextContent(BRIEFS.fleet.body)

    await userEvent.click(screen.getByRole('button', { expanded: true }))
    expect(screen.queryByText(BRIEFS.fleet.body)).not.toBeInTheDocument()
  })

  it('dismiss hides the bar, shows the re-opener, and persists the flag', async () => {
    render(<FeatureBrief surfaceId="tasks" />)
    expect(screen.getByText(BRIEFS.tasks.summary)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /dismiss brief/i }))

    expect(screen.queryByText(BRIEFS.tasks.summary)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /show brief/i })).toBeInTheDocument()
    expect(localStorage.getItem('mc.brief.tasks.dismissed')).toBe('true')
  })

  it('starts dismissed when the flag is set on mount', () => {
    localStorage.setItem('mc.brief.history.dismissed', 'true')
    render(<FeatureBrief surfaceId="history" />)
    expect(screen.queryByText(BRIEFS.history.summary)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /show brief/i })).toBeInTheDocument()
  })

  it('re-opener restores the bar and clears the flag', async () => {
    localStorage.setItem('mc.brief.skills.dismissed', 'true')
    render(<FeatureBrief surfaceId="skills" />)

    await userEvent.click(screen.getByRole('button', { name: /show brief/i }))

    expect(screen.getByText(BRIEFS.skills.summary)).toBeInTheDocument()
    expect(localStorage.getItem('mc.brief.skills.dismissed')).toBeNull()
  })

  it('renders nothing for an unknown surfaceId', () => {
    const { container } = render(<FeatureBrief surfaceId="nope" />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing for an empty surfaceId', () => {
    const { container } = render(<FeatureBrief surfaceId="" />)
    expect(container.innerHTML).toBe('')
  })
})

// ─── Registry ─────────────────────────────────────────────────────────────────

const EXPECTED_IDS = [
  'agents',
  'tasks',
  'runs.conductor',
  'runs.missions',
  'runs.pipeline',
  'fleet',
  'history',
  'workflows',
  'skills',
  'teams',
]

describe('FeatureBrief — registry', () => {
  it('has the agreed set of surface ids', () => {
    expect(Object.keys(BRIEFS).sort()).toEqual([...EXPECTED_IDS].sort())
  })

  it('every brief has a non-empty title, summary, and body', () => {
    for (const [id, brief] of Object.entries(BRIEFS)) {
      expect(brief.title, `${id}.title`).toBeTruthy()
      expect(brief.summary, `${id}.summary`).toBeTruthy()
      expect(brief.body, `${id}.body`).toBeTruthy()
      expect(typeof brief.title, `${id}.title type`).toBe('string')
      expect(typeof brief.summary, `${id}.summary type`).toBe('string')
      expect(typeof brief.body, `${id}.body type`).toBe('string')
    }
  })
})
