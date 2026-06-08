#!/usr/bin/env node
// Harness Stop hook: enforce a session note tied to the active mission. Pure-Node
// port of stop-session-note-reminder.sh.
//   default                          → advisory reminder to stdout; exit 0
//   HARNESS_ENFORCE_SESSION_NOTE=1   → exit 2 (blocks stop) when a mission is
//                                      active and no matching note is found
import fs from 'node:fs'
import path from 'node:path'
import { readFileSafe, readYamlScalar, normalizeMission, findRecentMarkdown } from './_lib.mjs'

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
const sessionDir = path.join(projectDir, 'runs', 'session-notes')

const stateText = readFileSafe(path.join(projectDir, '.harness', 'project-state.yml'))
const mission = normalizeMission(stateText != null ? readYamlScalar(stateText, 'current', 'mission') : null)

function matchesMission(note, mid) {
  if (!note || !mid) return false
  if (path.basename(note).includes(mid)) return true // by filename
  const c = readFileSafe(note) // by content (case-insensitive)
  if (c != null && c.toLowerCase().includes(mid.toLowerCase())) return true
  return false
}

// A session note from the last 10 minutes.
const recent = findRecentMarkdown(sessionDir, 10)
const recentNote = recent.length ? recent[0] : ''

if (!mission) {
  // No active mission — reminder-only regardless of HARNESS_ENFORCE_SESSION_NOTE.
  if (recentNote) process.exit(0)
  process.stdout.write(
    '[harness reminder] No session note in runs/session-notes/ from the last 10 minutes. If meaningful work happened, write one from runs/templates/session-note-template.md before stopping. (No mission active — this is advisory only.)\n',
  )
  process.exit(0)
}

// Mission active — require a note that ties to it.
if (recentNote && matchesMission(recentNote, mission)) process.exit(0)

// Look further back (2h) for any note that matches.
const anyNote = findRecentMarkdown(sessionDir, 120).find((f) => matchesMission(f, mission))
if (anyNote) process.exit(0)

const reason =
  `Harness: no session note tied to mission ${mission} found in runs/session-notes/ (looked back 2h). ` +
  `Write one before stopping — filename or content should reference ${mission}. ` +
  `Use runs/templates/session-note-template.md or run 'tools/harness handoff' to scaffold.`

if (process.env.HARNESS_ENFORCE_SESSION_NOTE === '1') {
  process.stderr.write(reason + '\n')
  process.exit(2) // blocks Claude from stopping; stderr is shown to Claude
}

process.stdout.write('[harness reminder] ' + reason + '\n')
process.exit(0)
