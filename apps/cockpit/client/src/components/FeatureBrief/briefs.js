// Feature Briefs registry — the single source of truth for the short, in-app
// explainer shown at the top of each major surface. Maps a `surfaceId` to its
// copy: a `title`, a one-line `summary`, and a multi-line `body` (each body ends
// with a "Use it:" sentence). Voice is terse and factual, sourced from CLAUDE.md.
// See docs/superpowers/specs/2026-06-05-feature-briefs-design.md.
//
// The 8 top-level tabs each get a brief; Runs is split into two mode-specific
// briefs (runs.conductor / runs.missions) rendered from inside RunsTab.
export const BRIEFS = {
  agents: {
    title: 'Agents',
    summary: "Live view of every Claude Code session you're running.",
    body: 'The board groups sessions by Active / Idle / Done. Open one for its conversation, timeline, summary, Intel analysis, plans, and the Inspect viewer. Use it: pick a session on the left, or click a board card, to drill into detail.',
  },
  tasks: {
    title: 'Tasks',
    summary: "The selected session's task list (todos), live.",
    body: "Mirrors the agent's own task board for the selected session so you can see what it's planning and where it is. Use it: select a session on the left; the board updates live as the agent works.",
  },
  'runs.conductor': {
    title: 'Runs · Conductor',
    summary: 'Drive one accepted ADR end-to-end through 5 phases.',
    body: 'A pure orchestrator that delegates all implementation to subagents, running one ADR through bootstrap → plan → build → integration → ship. Use it: Start a run here, or run /conductor <NNNN> in any project with the harness installed.',
  },
  'runs.missions': {
    title: 'Runs · Mission Control',
    summary: 'Run harness-governed missions on-rails.',
    body: 'Harness-governed missions that graduate draft → ready → build. The cockpit never edits mission-index.yml directly — the harness CLI owns that. Use it: compile a roadmap into draft missions, mark one ready, then execute.',
  },
  fleet: {
    title: 'Fleet',
    summary: 'Fan one goal across N child agents, each in its own git worktree.',
    body: 'Each child runs under harness rails and escalates on danger; results are synthesized at the end (Fleet → child session + harness → subagents). Use it: New Fleet Run → set a goal → add one row per child (path + prompt or workflow) → optional budget/verify → Launch.',
  },
  history: {
    title: 'History',
    summary: 'A searchable audit feed of past commands and sessions across projects.',
    body: 'Stats up top (totals, today, top command/project, 7-day trend), then a filterable, infinite-scrolling log. Use it: search or filter by project to find what ran when.',
  },
  workflows: {
    title: 'Workflows',
    summary: 'Compose multi-step skill/agent pipelines — and run them.',
    body: 'Each workflow is an ordered list of steps (skill, agent, instruction, or shell command). Use it: New → add steps → Run to spawn a Claude session that executes them (or export to a skill).',
  },
  skills: {
    title: 'Skills',
    summary: 'Browse the skills installed on this machine (yours + plugins).',
    body: 'Search and filter the catalog of skills Claude Code can invoke. Use it: search by name; click a skill to see its description and source.',
  },
  teams: {
    title: 'Teams',
    summary: 'Team inboxes and configs for multi-agent collaboration.',
    body: "Teams are defined in Claude Code's team configuration. Use it: select a team to see its members and inbox feed, and post a message to the team.",
  },
}
