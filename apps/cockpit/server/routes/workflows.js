import { Router } from 'express'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { getAllWorkflows } from '../parsers/workflows.js'
import { validateWorkflowName as validateName } from '../utils/validate.js'
import { atomicWrite, atomicWriteJson } from '../lib/atomic-write.js'
import { runClaudeCancellable } from '../claude-cli.js'
import { awaitNewSession } from '../lib/pending-session.js'
import { logger } from '../lib/logger.js'

export const router = Router()

const WORKFLOWS_DIR = path.join(os.homedir(), '.claude', 'workflows')
const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills')

// ──────────────────────────────────────────────────────────────────────────────
// Concurrency guard
// ──────────────────────────────────────────────────────────────────────────────
// A double-click (or two clients) can otherwise spawn TWO sessions driving the
// same workflow. We track an in-memory set of in-flight operation keys. A second
// request for the same key while one is still in flight gets a clean 409
// { error: 'in_progress' } and is NOT allowed to spawn. Keys are released in a
// finally so they can't leak even when the underlying run errors. In-memory is
// the right scope here: the server is the single spawner for this route.
const inFlight = new Set()

// Reserve a key. Returns false if it is already held (caller should 409).
function acquire(key) {
  if (inFlight.has(key)) return false
  inFlight.add(key)
  return true
}

function release(key) {
  inFlight.delete(key)
}

// Test-only: clear the in-flight registry between cases. The registry is
// module-level (the server is a singleton), so tests that intentionally leave a
// run "in flight" would otherwise leak a held key into the next test.
export function __resetInFlight() {
  inFlight.clear()
}

// Render the ordered list of workflow steps as markdown sections. Shared by
// generateSkillMd (skill export) and the run-prompt builder so both stay in
// lockstep. The export path depends on this output being byte-identical to what
// generateSkillMd produced before, so this only factors out the loop — the
// per-step header + content lines are unchanged.
function renderSteps(workflow) {
  const lines = []
  ;(workflow.steps || []).forEach((step, i) => {
    lines.push(`## Step ${i + 1}: ${step.title || stepDefaultTitle(step)}`)
    lines.push('')
    lines.push(stepContent(step))
    lines.push('')
  })
  return lines
}

function generateSkillMd(workflow) {
  const lines = [
    '---',
    `name: ${workflow.name}`,
    `description: ${workflow.description || ''}`,
    '---',
    '',
    'Follow these steps in order. Complete each step fully before moving to the next.',
    '',
    ...renderSteps(workflow),
  ]

  return lines.join('\n')
}

function stepDefaultTitle(step) {
  if (step.type === 'skill') return `Invoke /${step.skillName}`
  if (step.type === 'agent') return `Spawn ${step.agentType} agent`
  if (step.type === 'instruction') return 'Instruction'
  if (step.type === 'command') return `Run: ${step.command}`
  return step.type
}

function stepContent(step) {
  if (step.type === 'skill') {
    const note = step.note ? `\n\n${step.note}` : ''
    return `Invoke the \`/${step.skillName}\` skill.${note}`
  }
  if (step.type === 'agent') {
    return `Spawn a \`${step.agentType}\` agent with this prompt: "${step.prompt}"`
  }
  if (step.type === 'instruction') {
    return step.text || ''
  }
  if (step.type === 'command') {
    return `Run: \`${step.command}\``
  }
  return ''
}

router.get('/', (req, res) => res.json(getAllWorkflows()))

router.post('/', async (req, res, next) => {
  const body = req.body ?? {}
  const { name } = body
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name is required.' })
  if (!validateName(name, res)) return

  const filePath = path.join(WORKFLOWS_DIR, `${name}.json`)
  try {
    await fs.access(filePath)
    return res.status(409).json({ error: 'A workflow with that name already exists.' })
  } catch {
    // file does not exist — proceed
  }

  const now = Date.now()
  const workflow = {
    name,
    description: body.description || '',
    steps: body.steps || [],
    createdAt: now,
    updatedAt: now,
  }

  try {
    await fs.mkdir(WORKFLOWS_DIR, { recursive: true })
    await atomicWriteJson(filePath, workflow)
  } catch (err) {
    return next(err)
  }
  res.status(201).json(workflow)
})

router.put('/:name', async (req, res, next) => {
  const { name } = req.params
  if (!validateName(name, res)) return

  const filePath = path.join(WORKFLOWS_DIR, `${name}.json`)
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(path.resolve(WORKFLOWS_DIR) + path.sep)) {
    return res.status(403).json({ error: 'Path traversal not allowed.' })
  }

  let existing = {}
  try {
    existing = JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Workflow not found.' })
    return next(err)
  }

  const body = req.body ?? {}
  const updated = {
    ...existing,
    ...body,
    name, // name stays canonical from URL param
    updatedAt: Date.now(),
  }

  try {
    await atomicWriteJson(filePath, updated)
  } catch (err) {
    return next(err)
  }
  res.json(updated)
})

router.delete('/:name', async (req, res, next) => {
  const { name } = req.params
  if (!validateName(name, res)) return

  const filePath = path.join(WORKFLOWS_DIR, `${name}.json`)
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(path.resolve(WORKFLOWS_DIR) + path.sep)) {
    return res.status(403).json({ error: 'Path traversal not allowed.' })
  }

  try {
    await fs.unlink(resolved)
    res.json({ ok: true, name })
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Workflow not found.' })
    next(err)
  }
})

router.post('/:name/export', async (req, res, next) => {
  const { name } = req.params
  if (!validateName(name, res)) return

  const workflowPath = path.join(WORKFLOWS_DIR, `${name}.json`)
  let workflow
  try {
    workflow = JSON.parse(await fs.readFile(workflowPath, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Workflow not found.' })
    return next(err)
  }

  const skillPath = path.join(SKILLS_DIR, `${name}.md`)
  const overwrite = req.body?.overwrite === true

  if (!overwrite) {
    try {
      await fs.access(skillPath)
      return res.status(409).json({ error: `Skill /${name} already exists.` })
    } catch {
      // file does not exist — proceed
    }
  }

  const content = generateSkillMd(workflow)
  try {
    await fs.mkdir(SKILLS_DIR, { recursive: true })
    await atomicWrite(skillPath, content)
  } catch (err) {
    return next(err)
  }
  res.json({ ok: true, name, skillPath })
})

// Compose the driving prompt for a workflow run. Reuses the exact step-rendering
// the skill export uses (renderSteps) so a run and an exported skill drive the
// agent identically. A short preamble mirrors generateSkillMd's instruction.
function buildRunPrompt(workflow) {
  const lines = [
    `Run the "${workflow.name}" workflow.`,
    workflow.description ? `\n${workflow.description}\n` : '',
    'Follow these steps in order. Complete each step fully before moving to the next.',
    '',
    ...renderSteps(workflow),
  ]
  return lines.join('\n')
}

// ──────────────────────────────────────────────────────────────────────────────
// POST /:name/run
// Spawn a claude session driving the workflow's steps. Mirrors the missions
// execute spawn pattern: spawn via runClaudeCancellable, race the file-watcher
// early-ack (15s) against the CLI completion, ack 202 { ok, status:'started',
// sessionId } on the first signal. 404 if the workflow file does not exist,
// 409 { error:'in_progress' } on a concurrent run of the same workflow.
// ──────────────────────────────────────────────────────────────────────────────

router.post('/:name/run', async (req, res) => {
  const { name } = req.params
  if (!validateName(name, res)) return

  const workflowPath = path.join(WORKFLOWS_DIR, `${name}.json`)
  let workflow
  try {
    workflow = JSON.parse(await fs.readFile(workflowPath, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Workflow not found.' })
    logger.warn({ detail: err.message, name }, 'workflow_run_read_failed')
    return res.status(500).json({ error: err.message })
  }

  // Concurrency guard, keyed on the workflow name: a double-click must not spawn
  // TWO sessions driving the same workflow. Reserve BEFORE the spawn. The
  // lifecycle boundary is the CLI run settling (success/error) — NOT the
  // early-ack — so a second click in the window after the 202 still 409s while
  // the first run is live. Released in the taggedCli settle below.
  const lockKey = `workflow-run:${name}`
  if (!acquire(lockKey)) {
    return res.status(409).json({ error: 'in_progress' })
  }

  const prompt = buildRunPrompt(workflow)
  const cwd = process.cwd()

  // Reuse the spawn pattern: spawn via runClaudeCancellable, race the
  // file-watcher ack against the CLI completion. Early-ack 202 on first signal.
  const args = ['-p', prompt, '--output-format', 'stream-json', '--name', name]

  let cliPromise
  try {
    ;({ promise: cliPromise } = runClaudeCancellable({ args, cwd, timeoutMs: 300_000 }))
  } catch (err) {
    // Synchronous spawn failure — release the key so it can't leak, then 502.
    release(lockKey)
    logger.warn({ detail: err.message, name }, 'workflow_run_spawn_failed')
    return res.status(502).json({ ok: false, error: err.message })
  }

  // Convert the CLI promise to an always-resolving tagged promise so Node never
  // sees an unhandledRejection if the run fails after we early-ack. Release the
  // concurrency key once the run settles (success OR error) — finally-style so
  // the key can never leak.
  const taggedCli = cliPromise.then(
    (v) => ({ _tag: 'cli', value: v }),
    (err) => ({ _tag: 'cli_err', error: err }),
  )
  taggedCli.finally(() => release(lockKey))
  const taggedAck = awaitNewSession(cwd, { timeoutMs: 15_000 })
    .then((id) => ({ _tag: 'ack', sessionId: id }))
    .catch((err) => ({ _tag: 'timeout', error: err }))

  const winner = await Promise.race([taggedCli, taggedAck])

  if (winner._tag === 'cli_err') {
    const err = winner.error
    logger.warn({ detail: err.message, stderr: err.stderrOutput, name }, 'workflow_run_failed')
    return res.status(502).json({ ok: false, error: err.message })
  }

  if (winner._tag === 'ack') {
    // File-watcher fired first — ack immediately, let the CLI keep running.
    const sessionId = winner.sessionId
    taggedCli.then((t) => {
      if (t._tag === 'cli_err') {
        logger.warn(
          { sessionId, detail: t.error.message, name },
          'workflow_run_cli_failed_after_ack',
        )
      }
    })
    return res.status(202).json({ ok: true, status: 'started', sessionId })
  }

  if (winner._tag === 'cli') {
    // CLI completed before the file-watcher (fast exit). Still a started run.
    return res.status(202).json({ ok: true, status: 'started' })
  }

  // (timeout) The watcher never saw a JSONL within 15s but the CLI is still
  // running — the session was spawned successfully and may simply be slow to
  // write its first event. Ack the started run rather than kill a working
  // process. Keep watching the CLI in the background for failures.
  taggedCli.then((t) => {
    if (t._tag === 'cli_err') {
      logger.warn({ detail: t.error.message, name }, 'workflow_run_cli_failed_after_slow_ack')
    }
  })
  logger.info({ name }, 'workflow_run_slow_ack')
  return res.status(202).json({ ok: true, status: 'started' })
})
