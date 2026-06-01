#!/usr/bin/env node
// scripts/seed-claude-fixtures.mjs
//
// Seeds synthetic Claude Code sessions into ~/.claude/projects so the cockpit
// has something real to render in an ephemeral QA environment.
//
// Why this exists: the cockpit's entire data source is a developer's *live*
// ~/.claude/projects/<project>/<session>.jsonl files. A fresh cloud container
// (a Routine run, a CI job) has none — so without seeding, every QA pass just
// "discovers" an empty dashboard and files false bugs. This writes a spread of
// sessions covering the states the UI special-cases: active, awaiting-input,
// heavy token usage, compaction, and a subagent tree.
//
// The records match the shape consumed by apps/cockpit/server/parsers/sessions.js
// (type, message.content blocks, message.usage, stop_reason, isSidechain, …).
// File mtimes are set explicitly because the parser derives isActive / needsInput
// / abandoned from how recently the file changed.
//
// Usage:
//   node scripts/seed-claude-fixtures.mjs          # seed fixtures
//   node scripts/seed-claude-fixtures.mjs --clean   # remove only the fixture project
//   CLAUDE_FIXTURE_HOME=/tmp/h node scripts/...      # override home (tests/sandboxes)
//
// Safety: everything is written under a single, clearly-named fixture project dir
// so it is trivial to identify and remove, and never collides with real sessions.

import fs from 'fs'
import os from 'os'
import path from 'path'

// A recognizable, namespaced project dir. Claude encodes the cwd path with
// dashes; this mimics that while staying obviously synthetic.
const FIXTURE_PROJECT = '-home-user-mission-control-qa-fixtures'
const FIXTURE_CWD = '/home/user/mission-control-qa-fixtures'
const VERSION = '1.0.0'
const HOME = process.env.CLAUDE_FIXTURE_HOME || os.homedir()
const PROJECTS_DIR = path.join(HOME, '.claude', 'projects')
const FIXTURE_DIR = path.join(PROJECTS_DIR, FIXTURE_PROJECT)

const MINUTE = 60_000
const HOUR = 60 * MINUTE

let uuidN = 0
const uuid = () => `fixture-${(++uuidN).toString().padStart(4, '0')}`

// Timestamps inside a session march forward from a per-session start so the
// transcript reads chronologically; the file mtime (set separately) is what the
// parser uses for liveness.
function tsFactory(startMs) {
  let t = startMs
  return () => {
    t += 7_000
    return new Date(t).toISOString()
  }
}

function userRec(next, content, extra = {}) {
  return {
    uuid: uuid(),
    type: 'user',
    timestamp: next(),
    cwd: FIXTURE_CWD,
    version: VERSION,
    gitBranch: 'main',
    isSidechain: false,
    message: { role: 'user', content },
    ...extra,
  }
}

function assistantRec(next, { content, usage, model = 'claude-opus-4-8', stopReason, sidechain = false, parentToolUseID } = {}) {
  const rec = {
    uuid: uuid(),
    type: 'assistant',
    timestamp: next(),
    isSidechain: sidechain,
    message: { role: 'assistant', model, content, ...(stopReason ? { stop_reason: stopReason } : {}), ...(usage ? { usage } : {}) },
  }
  if (sidechain && parentToolUseID) rec.parentToolUseID = parentToolUseID
  return rec
}

function systemRec(next, text) {
  return { uuid: uuid(), type: 'system', timestamp: next(), isSidechain: false, message: { role: 'system', content: text } }
}

const usage = (i, o, cr = 0, cw = 0) => ({
  input_tokens: i,
  output_tokens: o,
  cache_read_input_tokens: cr,
  cache_creation_input_tokens: cw,
})

const toolUse = (name, input) => ({ type: 'tool_use', id: uuid(), name, input })
const textBlock = (text) => ({ type: 'text', text })
const thinking = (t) => ({ type: 'thinking', thinking: t })

// ─── Scenarios ───────────────────────────────────────────────────────────────
// Each returns { id, ageMs, slug, records }. ageMs becomes the file mtime offset
// from now, which drives isActive (<5m), needsInput (5m–4h + last turn end_turn),
// and abandoned (>4h).

function scenarios() {
  return [
    // 1. Actively running: modified seconds ago, last turn is a tool_use (mid-turn,
    //    waiting on tool results — NOT on the user).
    (() => {
      const next = tsFactory(Date.now() - 10 * MINUTE)
      return {
        id: 'qa-active-build',
        ageMs: 45_000,
        slug: 'active-build',
        records: [
          userRec(next, 'Add a health check endpoint'),
          assistantRec(next, {
            content: [thinking('Wire up /healthz and a test.'), textBlock('Adding the endpoint now.'), toolUse('Edit', { file_path: 'server/routes/health.js' })],
            usage: usage(1800, 320, 12000, 800),
            stopReason: 'tool_use',
          }),
        ],
      }
    })(),

    // 2. Awaiting human input: inactive (12m old), last main-thread turn ended.
    (() => {
      const next = tsFactory(Date.now() - 40 * MINUTE)
      return {
        id: 'qa-awaiting-input',
        ageMs: 12 * MINUTE,
        slug: 'awaiting-input',
        records: [
          userRec(next, 'Refactor the parser', { permissionMode: 'plan' }),
          assistantRec(next, {
            content: [textBlock('I split it into two modules. Want me to also update the tests?')],
            usage: usage(2400, 510),
            stopReason: 'end_turn',
          }),
        ],
      }
    })(),

    // 3. Heavy token usage + varied tools, for cost/token-breakdown rendering.
    (() => {
      const next = tsFactory(Date.now() - 90 * MINUTE)
      return {
        id: 'qa-heavy-tokens',
        ageMs: 35 * MINUTE,
        slug: 'heavy-tokens',
        records: [
          userRec(next, 'Audit the whole server for unused exports'),
          assistantRec(next, {
            content: [toolUse('Read', { file_path: 'server/index.js' }), toolUse('Bash', { command: 'grep -rn export server' }), toolUse('Read', { file_path: 'server/routes/sessions.js' })],
            usage: usage(48000, 2100, 96000, 12000),
            stopReason: 'tool_use',
          }),
          assistantRec(next, {
            content: [toolUse('Agent', { prompt: 'Find dead code across parsers' }), toolUse('Edit', { file_path: 'server/utils/export.js' }), textBlock('Removed 3 unused exports.')],
            usage: usage(15000, 1800, 140000, 4000),
            stopReason: 'end_turn',
          }),
        ],
      }
    })(),

    // 4. Compacted session: system continuation preamble → hasBeenCompacted=true.
    (() => {
      const next = tsFactory(Date.now() - 3 * HOUR)
      return {
        id: 'qa-compacted',
        ageMs: 2 * HOUR,
        slug: 'compacted-run',
        records: [
          systemRec(next, 'This session is being continued from a previous conversation that ran out of context. The prior work added the CI workflow.'),
          userRec(next, 'Continue where we left off'),
          assistantRec(next, { content: [textBlock('Resuming — CI is green, continuing with the docs.')], usage: usage(900, 200), stopReason: 'end_turn' }),
        ],
      }
    })(),

    // 5. Subagent tree: a sidechain (isSidechain) grouped under a parentToolUseID,
    //    so agentTree.subagents is populated.
    (() => {
      const next = tsFactory(Date.now() - 25 * MINUTE)
      const parentToolUseID = 'tu-explore-1'
      return {
        id: 'qa-with-subagent',
        ageMs: 6 * MINUTE,
        slug: 'with-subagent',
        records: [
          userRec(next, 'Map the codebase'),
          assistantRec(next, { content: [toolUse('Agent', { prompt: 'Explore the repo layout' })], usage: usage(1200, 300), stopReason: 'tool_use' }),
          // Sidechain (subagent) messages, linked by parentToolUseID.
          { ...userRec(next, 'Explore the repo layout'), isSidechain: true, parentToolUseID },
          assistantRec(next, { content: [textBlock('Found apps/cockpit, packages/harness, packages/contracts.')], usage: usage(3000, 600), sidechain: true, parentToolUseID }),
          // Back on the main thread, ends waiting on the user.
          assistantRec(next, { content: [textBlock('Done mapping. Anything specific to dig into?')], usage: usage(800, 150), stopReason: 'end_turn' }),
        ],
      }
    })(),
  ]
}

// ─── IO ──────────────────────────────────────────────────────────────────────

function clean() {
  if (fs.existsSync(FIXTURE_DIR)) {
    fs.rmSync(FIXTURE_DIR, { recursive: true, force: true })
    console.log(`[seed] removed fixture project: ${FIXTURE_DIR}`)
  } else {
    console.log('[seed] nothing to clean')
  }
}

function seed() {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true })
  const sessions = scenarios()
  for (const s of sessions) {
    // Tag the first record with the slug so the parser picks it up.
    s.records[0].slug = s.slug
    const file = path.join(FIXTURE_DIR, `${s.id}.jsonl`)
    fs.writeFileSync(file, s.records.map((r) => JSON.stringify(r)).join('\n') + '\n')
    const mtime = new Date(Date.now() - s.ageMs)
    fs.utimesSync(file, mtime, mtime)
    console.log(`[seed] ${s.id.padEnd(20)} (${s.records.length} records, mtime −${Math.round(s.ageMs / MINUTE)}m)`)
  }
  console.log(`\n[seed] ${sessions.length} fixture sessions → ${FIXTURE_DIR}`)
  console.log('[seed] start the cockpit (npm run up) to see them; run with --clean to remove.')
}

const arg = process.argv[2]
if (arg === '--clean') clean()
else if (arg === '--help' || arg === '-h') {
  console.log('Usage: node scripts/seed-claude-fixtures.mjs [--clean]')
  console.log('  (no args)  seed synthetic ~/.claude sessions for QA')
  console.log('  --clean    remove only the fixture project dir')
  console.log('  env CLAUDE_FIXTURE_HOME overrides the home dir')
} else seed()
