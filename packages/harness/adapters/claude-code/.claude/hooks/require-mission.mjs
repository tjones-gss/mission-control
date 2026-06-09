#!/usr/bin/env node
// Harness PreToolUse hook (Edit|Write|MultiEdit|NotebookEdit): enforce mission
// scope. Pure-Node port of require-mission.sh — needs neither jq nor bash. Wired
// by settings.node.json. All decisions are communicated via JSON stdout; exit 0.
import fs from 'node:fs'
import path from 'node:path'
import {
  readStdin,
  extractFilePath,
  computeRelPath,
  hasDotDotSegment,
  readFileSafe,
  readYamlScalar,
  normalizeMission,
  normalizeMode,
  isBootstrapMode,
  missionFileFromIndex,
  parseMissionSection,
  matchPattern,
  isHarnessPath,
  preToolUseDecision,
  emitDecision,
} from './_lib.mjs'

const input = await readStdin()
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()

const filePath = extractFilePath(input)
if (!filePath) process.exit(0) // no path → nothing to enforce

const rel = computeRelPath(filePath, projectDir)

// 0) Reject '..' segments — no Forbidden bypass via traversal.
if (hasDotDotSegment(rel)) {
  emitDecision(
    preToolUseDecision(
      'deny',
      `Blocked by harness path policy. Target "${rel}" contains a '..' segment. The harness requires canonical paths because '..' can mask a Forbidden target behind an Allowed prefix. Resolve the path and retry.`,
    ),
  )
  process.exit(0)
}

// Read project mode + current mission from project-state.yml.
const stateText = readFileSafe(path.join(projectDir, '.harness', 'project-state.yml'))
const mode = normalizeMode(readYamlScalar(stateText, 'project', 'mode'))
const mission = normalizeMission(readYamlScalar(stateText, 'current', 'mission'))
const bootstrap = isBootstrapMode(mode)

// Locate the active mission file (mission-index.yml, then runs/missions/<id>*.md).
let missionFile = ''
if (mission) {
  const indexText = readFileSafe(path.join(projectDir, '.harness', 'mission-index.yml'))
  const relFile = indexText != null ? missionFileFromIndex(indexText, mission) : null
  if (relFile && fs.existsSync(path.join(projectDir, relFile))) {
    missionFile = path.join(projectDir, relFile)
  }
  if (!missionFile) {
    const dir = path.join(projectDir, 'runs', 'missions')
    try {
      const cands = fs
        .readdirSync(dir)
        .filter((n) => n.startsWith(mission) && n.endsWith('.md'))
        .sort()
      if (cands.length) missionFile = path.join(dir, cands[0])
    } catch {
      /* no runs/missions dir */
    }
  }
}

// Parse Allowed / Forbidden Files from the mission markdown.
let allowed = []
let forbidden = []
if (missionFile) {
  const mtext = readFileSafe(missionFile)
  if (mtext != null) {
    allowed = parseMissionSection(mtext, /^##\s+Allowed Files/)
    forbidden = parseMissionSection(mtext, /^##\s+Forbidden Files/)
  }
}

// 1) Forbidden hard-block always wins (even for harness paths).
for (const pat of forbidden) {
  if (matchPattern(rel, pat)) {
    emitDecision(
      preToolUseDecision(
        'deny',
        `Blocked by mission scope. Target "${rel}" matches a Forbidden Files entry ("${pat}") in mission ${mission}. If this edit is genuinely required, stop and amend the mission's Forbidden Files list with human approval, then retry.`,
      ),
    )
    process.exit(0)
  }
}

// 2) Allowed Files — if listed and matched, allow.
if (allowed.length > 0) {
  for (const pat of allowed) {
    if (matchPattern(rel, pat)) process.exit(0)
  }
}

// 3) Harness-owned path handling.
if (isHarnessPath(rel)) {
  if (!mission || bootstrap) process.exit(0)
  emitDecision(
    preToolUseDecision(
      'ask',
      `Harness-owned path "${rel}" is not in mission ${mission}'s Allowed Files. Confirm this write is intentional (e.g., session note, state update), or extend the mission.`,
    ),
  )
  process.exit(0)
}

// 4) App code with no mission → ASK.
if (!mission) {
  emitDecision(
    preToolUseDecision(
      'ask',
      `Harness rule: no current mission set in .harness/project-state.yml. Application code edit requested: "${rel}". Create a mission from agents/templates/mission-template.md and set current.mission, or confirm one-shot to proceed.`,
    ),
  )
  process.exit(0)
}

// 5) App code with mission, no Allowed match → DENY.
emitDecision(
  preToolUseDecision(
    'deny',
    `Blocked by mission scope. Target "${rel}" is not in mission ${mission}'s Allowed Files. If the change belongs in this mission, amend the Allowed Files list first; otherwise create a new mission.`,
  ),
)
process.exit(0)
