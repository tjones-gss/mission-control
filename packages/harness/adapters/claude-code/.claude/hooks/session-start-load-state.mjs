#!/usr/bin/env node
// Harness SessionStart hook: load .harness state into Claude's context. Pure-Node
// port of session-start-load-state.sh. stdout is appended to the conversation.
import fs from 'node:fs'
import path from 'node:path'
import { isDir, isFile } from './_lib.mjs'

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
const harnessDir = path.join(projectDir, '.harness')

// Bail silently if the harness isn't initialized in this project.
if (!isDir(harnessDir)) process.exit(0)

let out =
  '[Harness context — loaded by SessionStart hook]\n\n' +
  'You are operating inside the Adaptive Agentic Engineering Harness. Follow the\n' +
  'read order in AGENTS.md before any meaningful action. Current state files:\n\n'

for (const f of ['project-state.yml', 'pipeline-state.yml', 'mission-index.yml']) {
  const p = path.join(harnessDir, f)
  if (isFile(p)) {
    out += `=== .harness/${f} ===\n`
    out += fs.readFileSync(p, 'utf8')
    out += '\n'
  }
}

// Surface mission files explicitly (mission-index.yml may be empty on first run).
const missionDir = path.join(projectDir, 'runs', 'missions')
if (isDir(missionDir)) {
  let files = []
  try {
    files = fs
      .readdirSync(missionDir)
      .filter((n) => n.startsWith('MISSION-') && n.endsWith('.md'))
      .sort()
  } catch {
    files = []
  }
  if (files.length) {
    out += '=== Mission files in runs/missions/ ===\n'
    out += files.map((n) => `runs/missions/${n}`).join('\n') + '\n'
  }
}

process.stdout.write(out)
process.exit(0)
