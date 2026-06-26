import { describe, it, expect } from 'vitest'
import { CORE_TABS, ADVANCED_TABS } from '../App.jsx'

// SCOPE.md + ADR-0006 + the "Pipeline" IA ruling: Runs is the single
// orchestration surface. Conductor and MissionControl/Missions are MODES inside
// Runs (see RunsTab.jsx), never sibling top-level tabs. This guard fails if a
// future change re-promotes either overlap to a standalone tab — enforcing the
// SCOPE.md freeze rule ("no new tab without retiring or merging an overlap").
describe('top-level tab manifest', () => {
  const allTabs = [...CORE_TABS, ...ADVANCED_TABS]
  const ids = allTabs.map((t) => t.id.toLowerCase())
  const labels = allTabs.map((t) => t.label.toLowerCase())

  it('keeps Runs as a core orchestration surface', () => {
    expect(CORE_TABS.map((t) => t.id)).toContain('runs')
  })

  it('does not expose Conductor as a standalone tab', () => {
    expect(ids).not.toContain('conductor')
    expect(labels).not.toContain('conductor')
  })

  it('does not expose MissionControl / Missions as a standalone tab', () => {
    for (const forbidden of ['missioncontrol', 'mission-control', 'missions']) {
      expect(ids).not.toContain(forbidden)
      expect(labels).not.toContain(forbidden)
    }
  })

  it('does not expose Pipeline as a standalone tab (it is a mode inside Runs)', () => {
    expect(ids).not.toContain('pipeline')
    expect(labels).not.toContain('pipeline')
  })
})
