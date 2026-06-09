import { Router } from 'express'
import path from 'path'
import { promises as fsp } from 'fs'
import {
  getHarnessProjects,
  getHarnessProjectByPath,
  getKnownHarnessRoots,
  getScaffoldCandidates,
  runHarnessScaffold,
  VALID_HARNESS_MODES,
} from '../parsers/harness.js'
import { runClaude, runClaudeCancellable } from '../claude-cli.js'
import { atomicWrite } from '../lib/atomic-write.js'
import { awaitNewSession } from '../lib/pending-session.js'
import { logger } from '../lib/logger.js'
import { parseStreamJsonStdout } from './sessions.js'

export const router = Router()

// ──────────────────────────────────────────────────────────────────────────────
// Concurrency guard
// ──────────────────────────────────────────────────────────────────────────────
// A double-click (or two clients) can otherwise spawn TWO governed implementers
// into the same project/mission, or overwrite a SPEC mid-write. We track an
// in-memory set of in-flight operation keys. A second request for the same key
// while one is still in flight gets a clean 409 { error: 'in_progress' } and is
// NOT allowed to spawn/write. Keys are released in a finally so they can't leak
// even when the underlying run errors. In-memory is the right scope here: the
// server is the single writer/spawner for these routes.
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

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

// Decode a :projectKey path param. Returns null when it is not valid URI
// encoding so the caller can return a clean 400 instead of throwing.
function decodeProjectKey(projectKey) {
  try {
    return decodeURIComponent(projectKey)
  } catch {
    return null
  }
}

// Whitelist membership check. The python parser owns the canonical set of known
// harness roots (session cwds containing .harness/project-state.yml). We reuse
// it here so we NEVER write to or spawn into an arbitrary path. Returns true
// only when projectPath is a member of that set.
function isKnownHarnessRoot(projectPath) {
  let roots
  try {
    roots = getKnownHarnessRoots()
  } catch {
    return false
  }
  return Array.isArray(roots) && roots.includes(projectPath)
}

// Derive a filesystem-safe slug from a title (or fall back to a timestamp).
// Lowercased, non-alphanumerics collapsed to single hyphens, trimmed, capped so
// the resulting filename stays sane. Never returns an empty string.
function slugify(title) {
  if (typeof title === 'string') {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '')
    if (slug) return slug
  }
  // Timestamp fallback: 2026-05-30T12-34-56-789Z → drop colons/dots for fs-safety.
  return new Date().toISOString().replace(/[:.]/g, '-')
}

// ──────────────────────────────────────────────────────────────────────────────
// Read endpoints
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/harness:
 *   get:
 *     summary: List harness projects (via the harness CLI status contract).
 *     tags: [Harness]
 *     responses:
 *       200:
 *         description: Harness projects.
 */
router.get('/', async (_req, res) => {
  res.json({ projects: await getHarnessProjects() })
})

// Candidate directories the user can scaffold a new harness project into:
// session cwds that are NOT already harness roots. Powers the create dialog's
// directory picker. MUST be registered BEFORE '/:projectKey' so the literal
// path is not captured as a projectKey.
router.get('/scaffold-candidates', (_req, res) => {
  let candidates = []
  try {
    candidates = getScaffoldCandidates()
  } catch {
    candidates = []
  }
  res.json({ candidates: Array.isArray(candidates) ? candidates : [] })
})

/**
 * @openapi
 * /api/harness/{projectKey}:
 *   get:
 *     summary: Status for a single harness project (URL-encoded project path key).
 *     tags: [Harness]
 *     parameters:
 *       - in: path
 *         name: projectKey
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The harness project status.
 *       400:
 *         description: Invalid project key.
 *       404:
 *         description: Project not found or not whitelisted.
 */
router.get('/:projectKey', async (req, res) => {
  const { projectKey } = req.params
  const projectPath = decodeProjectKey(projectKey)
  if (projectPath === null) {
    return res.status(400).json({ error: 'invalid_project_key' })
  }
  // Whitelist check lives in the parser: getHarnessProjectByPath returns null
  // when projectPath is not a known harness root, so we never shell out to an
  // arbitrary path.
  const detail = await getHarnessProjectByPath(projectPath)
  if (!detail) return res.status(404).json({ error: 'not_found' })
  res.json(detail)
})

// ──────────────────────────────────────────────────────────────────────────────
// POST /create
// Create a NEW harness project in a directory that is not yet one. Validates the
// mode and the target against the scaffold-candidate allowlist (session cwds that
// are NOT already harness roots), then shells out to `harness scaffold`. The
// cockpit writes NO harness files itself — the CLI is the sole author. The
// watcher then sees the new .harness/ and emits harness_update, so the client
// picks the project up automatically.
// ──────────────────────────────────────────────────────────────────────────────

router.post('/create', async (req, res) => {
  const { projectPath, mode } = req.body || {}

  // Validate the mode against the known enum BEFORE touching anything.
  if (typeof mode !== 'string' || !VALID_HARNESS_MODES.includes(mode)) {
    return res.status(400).json({ error: 'invalid_mode' })
  }
  if (typeof projectPath !== 'string' || !projectPath) {
    return res.status(400).json({ error: 'invalid_target' })
  }

  // Whitelist membership check BEFORE any spawn. The target must be a known
  // session cwd that is NOT already a harness project — never scaffold into an
  // arbitrary path.
  let candidates
  try {
    candidates = getScaffoldCandidates()
  } catch {
    candidates = []
  }
  if (!Array.isArray(candidates) || !candidates.includes(projectPath)) {
    return res.status(403).json({ error: 'path_not_allowed' })
  }

  // Concurrency guard, keyed on projectPath: a double-click must not spawn two
  // scaffolds into the same directory. Reserve BEFORE the spawn; release in a
  // finally so it can never leak.
  const lockKey = `create:${projectPath}`
  if (!acquire(lockKey)) {
    return res.status(409).json({ error: 'in_progress' })
  }

  try {
    let result
    try {
      result = await runHarnessScaffold(projectPath, mode)
    } catch (err) {
      logger.warn({ detail: err.message, projectPath }, 'harness_create_run_failed')
      return res.status(502).json({ ok: false, error: err.message })
    }

    if (result && result.ok) {
      return res.status(201).json(result)
    }

    // The CLI refused or errored (it emits its own machine-readable result).
    // Map a clean "already a harness project" refusal to 409; anything else 502.
    const status = result && result.error === 'already_initialized' ? 409 : 502
    return res.status(status).json(result || { ok: false, error: 'scaffold_failed' })
  } finally {
    release(lockKey)
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// POST /:projectKey/roadmap/compile
// Persist the user's plain-language roadmap as a spec file, then spawn a one-shot
// claude run to slice it into bounded, sequenced missions registered as
// status: draft. Never implements anything.
//
// The prompt is SELF-CONTAINED — it does NOT invoke the `/mission-writer` slash
// command. That command only exists in projects that have installed the harness
// Claude adapter (.claude/skills/), and the cockpit compiles roadmaps in
// arbitrary harness projects. An unrecognized slash command in `claude -p` does
// not error — it exits 0 with result "Unknown command: /mission-writer" and does
// NOTHING, which would otherwise read as a silent success that produced zero
// missions. Inlining the mission-writing directives makes compile work in any
// harness project regardless of adapter state.
// ──────────────────────────────────────────────────────────────────────────────

router.post('/:projectKey/roadmap/compile', async (req, res) => {
  // This handler awaits a full mission-writer run synchronously (up to the
  // runClaude 300s budget below). The global 30s socket timeout
  // (middleware/performance.js) would otherwise sever the connection mid-run —
  // the client would see a network error while the orphaned CLI keeps working.
  // Lift the socket timeout above the work budget for THIS route only; the
  // global 30s protection stays intact everywhere else, and runClaude's own
  // timer still hard-bounds the actual work. The gap over runClaude's 300s
  // budget (20s) is deliberate headroom so a 300s-timeout rejection can still
  // run its cleanup (unlink) and write the 504 response before the socket dies.
  req.setTimeout(320_000)
  res.setTimeout(320_000)

  const { projectKey } = req.params
  const { roadmap, title } = req.body || {}

  // Validate body BEFORE touching the filesystem or spawning.
  if (!roadmap || typeof roadmap !== 'string' || !roadmap.trim()) {
    return res.status(400).json({ error: 'roadmap is required' })
  }

  const projectPath = decodeProjectKey(projectKey)
  if (projectPath === null) {
    return res.status(400).json({ error: 'invalid_project_key' })
  }

  // Whitelist membership check BEFORE any write or spawn — never write/spawn
  // into an arbitrary path.
  if (!isKnownHarnessRoot(projectPath)) {
    return res.status(404).json({ error: 'not_found' })
  }

  // Resolve the spec path: <project>/docs/specs/SPEC-<slug>.md
  const slug = slugify(title)
  const specsDir = path.join(projectPath, 'docs', 'specs')
  const specFileName = `SPEC-${slug}.md`
  const specPath = path.join(specsDir, specFileName)
  // Relative path (POSIX-style) for the prompt so the skill resolves it from cwd.
  const relSpecPath = path.join('docs', 'specs', specFileName).split(path.sep).join('/')

  // Concurrency guard, keyed on the resolved specPath: a double-submit for the
  // same spec must not overwrite the file mid-write or spawn a second
  // mission-writer over the top of the first. Reserve BEFORE the write/spawn.
  const lockKey = `compile:${specPath}`
  if (!acquire(lockKey)) {
    return res.status(409).json({ error: 'in_progress' })
  }

  try {
    // Compose the spec file with a small header noting provenance.
    const heading = (typeof title === 'string' && title.trim()) || slug
    const specBody = [
      `# SPEC: ${heading}`,
      '',
      '> Authored via the cockpit roadmap compiler.',
      `> Generated: ${new Date().toISOString()}`,
      '',
      '## Roadmap',
      '',
      roadmap.trim(),
      '',
    ].join('\n')

    // Did a spec at this path already exist (e.g. a prior successful compile of
    // the same title)? If so we must NOT delete it on a later failed re-compile —
    // that would leave its already-registered missions pointing at a missing
    // file. Only the orphan cleanup of a freshly-created spec is safe.
    const specPreexisted = await fileExists(specPath)

    // Atomic write — create docs/specs first if missing.
    try {
      await fsp.mkdir(specsDir, { recursive: true })
      await atomicWrite(specPath, specBody)
    } catch (err) {
      logger.warn({ detail: err.message, specPath }, 'roadmap_compile_write_failed')
      return res.status(502).json({ ok: false, error: `failed to write spec: ${err.message}` })
    }

    // Self-contained mission-writer prompt — no `/mission-writer` slash command
    // (see the route header). Inlines the essential directives + points at the
    // mission template that ships in every harness project.
    const prompt = buildMissionWriterPrompt(relSpecPath)

    try {
      const { stdout, stderr } = await runClaude({
        args: buildCompileArgs(prompt),
        cwd: projectPath,
        timeoutMs: 300_000,
      })
      const result = parseStreamJsonStdout(stdout)

      // Guard against a silent no-op: a real completion is a stream-json object
      // with type:'result' and is_error !== true. Anything else (no result
      // event, or an error result) means the run did NOT do the work — surface
      // it as a failure instead of returning ok:true with an empty summary.
      const completed = result && result.type === 'result' && result.is_error !== true
      if (!completed) {
        logger.warn({ specPath, result }, 'roadmap_compile_no_result')
        if (!specPreexisted) await unlinkQuietly(specPath)
        return res.status(502).json({
          ok: false,
          error: 'mission compilation did not complete',
          detail: (result && typeof result.result === 'string' && result.result) || null,
        })
      }

      const summary = typeof result.result === 'string' ? result.result : ''
      return res.json({
        ok: true,
        specPath,
        summary,
        raw: stderr ? `${stdout || ''}\n${stderr}` : stdout || undefined,
      })
    } catch (err) {
      logger.warn(
        { detail: err.message, stderr: err.stderrOutput, specPath },
        'roadmap_compile_run_failed',
      )
      // The spec was written before the spawn; on failure a freshly-created one
      // is orphaned (no missions) — remove it so a retry starts clean. But never
      // delete a spec that pre-existed (a prior compile's missions reference it).
      if (!specPreexisted) await unlinkQuietly(specPath)
      // Timeouts are a gateway-timeout (504), not a generic bad-gateway (502).
      const status = /timed out/i.test(err.message || '') ? 504 : 502
      return res.status(status).json({
        ok: false,
        error: err.message,
        stderr: capStderr(err.stderrOutput),
      })
    }
  } finally {
    // The compile run is fully synchronous from our side (we await runClaude to
    // completion), so the lifecycle boundary is "request settled" — release here.
    release(lockKey)
  }
})

// Args for the one-shot mission-writer compile run.
// `--permission-mode acceptEdits` is REQUIRED: a headless `claude -p` denies
// file edits by default (no interactive approver), so without it the
// mission-writer cannot write mission files or update mission-index.yml — the
// run "succeeds" but produces zero missions. acceptEdits auto-approves file
// edits only (not arbitrary Bash), which is exactly the mission-writer's needs.
// `--verbose` is injected centrally in claude-cli.js (stream-json print mode
// requires it), so it is intentionally absent here.
function buildCompileArgs(prompt) {
  return ['-p', prompt, '--output-format', 'stream-json', '--permission-mode', 'acceptEdits']
}

// Self-contained mission-writer instructions. Mirrors the essence of the
// mission-writer skill (packages/harness/.claude/skills/mission-writer) but does
// NOT depend on that skill being installed in the target project — it points at
// the mission template that ships in every harness project (agents/templates/).
function buildMissionWriterPrompt(relSpecPath) {
  return (
    `You are acting as a mission-writer for the Adaptive Agentic Engineering Harness. ` +
    `Read the roadmap spec at ${relSpecPath} and the project's .harness/project-state.yml. ` +
    `Slice the spec into bounded, sequenced missions — each completable in one session and ` +
    `reviewable as a single PR. For each mission, write a file at ` +
    `runs/missions/MISSION-<id>-<slug>.md following the template at ` +
    `agents/templates/mission-template.md, filling every section (Goal, Context To Read, ` +
    `Allowed Files, Forbidden Files, Required Plan, Required Tests, Validation Commands, ` +
    `Acceptance Criteria, Stop Conditions) — no placeholders. Register each mission in ` +
    `.harness/mission-index.yml with status: draft (NOT ready). Keep missions bounded and ` +
    `sequenced. Do NOT implement anything — only write mission files and update the index.`
  )
}

// Best-effort unlink that never throws — used to clean up a just-written spec
// when the compile run fails, so a retry starts from a clean slate.
async function unlinkQuietly(filePath) {
  try {
    await fsp.unlink(filePath)
  } catch {
    /* already gone or never written — nothing to clean up */
  }
}

// True if the path exists. Never throws (a missing file or stat error → false).
async function fileExists(filePath) {
  try {
    await fsp.access(filePath)
    return true
  } catch {
    return false
  }
}

// Bound the CLI stderr we echo back to the client. We deliberately surface it
// (the actionable cause, e.g. "requires --verbose", must reach the UI) but cap
// the length so a multi-KB traceback can't bloat the response. The full payload
// is still logged server-side.
function capStderr(stderr, max = 4000) {
  if (typeof stderr !== 'string' || !stderr) return null
  return stderr.length > max ? `${stderr.slice(0, max)}\n… (truncated)` : stderr
}

// ──────────────────────────────────────────────────────────────────────────────
// POST /:projectKey/missions/:missionId/execute
// Spawn a claude implementer session in the project cwd, instructed to execute
// THAT mission on-rails. Reuses the POST /api/sessions/new spawn pattern with an
// early-ack. The watcher emits harness_update as the run mutates state.
// ──────────────────────────────────────────────────────────────────────────────

router.post('/:projectKey/missions/:missionId/execute', async (req, res) => {
  const { projectKey, missionId } = req.params

  const projectPath = decodeProjectKey(projectKey)
  if (projectPath === null) {
    return res.status(400).json({ error: 'invalid_project_key' })
  }

  // Whitelist membership check BEFORE any spawn.
  if (!isKnownHarnessRoot(projectPath)) {
    return res.status(404).json({ error: 'not_found' })
  }

  // Resolve the mission file path from harness status --json missions map. The
  // parser performs its own whitelist check, so this also returns null for an
  // unknown / unavailable project.
  const detail = await getHarnessProjectByPath(projectPath)
  const missions = detail && typeof detail === 'object' ? detail.missions : null
  const mission = missions && typeof missions === 'object' ? missions[missionId] : undefined
  const missionFile = mission && typeof mission === 'object' ? mission.file : undefined

  if (!missionFile || typeof missionFile !== 'string') {
    return res.status(404).json({ error: 'not_found' })
  }

  // Defense-in-depth: the mission file path comes from .harness/mission-index.yml.
  // If that state were tampered with, a value like "../../secret" would point the
  // spawned agent outside the project. Refuse anything that resolves out of tree.
  const resolvedRoot = path.resolve(projectPath)
  const resolvedMissionFile = path.resolve(projectPath, missionFile)
  if (
    resolvedMissionFile !== resolvedRoot &&
    !resolvedMissionFile.startsWith(resolvedRoot + path.sep)
  ) {
    return res.status(404).json({ error: 'not_found' })
  }

  // Concurrency guard, keyed on projectPath+missionId: a double-click must not
  // spawn TWO governed implementers into the same mission. Reserve BEFORE the
  // spawn. The lifecycle boundary is the CLI run settling (success/error) — NOT
  // the early-ack — so a second click in the window after the 202 still 409s
  // while the first implementer is live. Released in the taggedCli settle below.
  const lockKey = `execute:${projectPath}:${missionId}`
  if (!acquire(lockKey)) {
    return res.status(409).json({ error: 'in_progress' })
  }

  // On-rails implementer prompt. Mirrors the harness-implementer contract:
  // read the mission file + .harness state, stay within Allowed Files, run the
  // mission's Validation Commands, obey Stop Conditions, follow AGENTS.md/hooks,
  // do not exceed scope.
  const prompt =
    `Execute ${missionId} on-rails. Read ${missionFile} and the .harness ` +
    `state first. Implement strictly within the mission's Allowed Files. Run ` +
    `the mission's Validation Commands. Obey the mission's Stop Conditions. ` +
    `Follow AGENTS.md and the harness hooks. Do not exceed the mission scope.`

  // Reuse the POST /new spawn pattern: spawn via runClaudeCancellable, race the
  // file-watcher ack against the CLI completion. Early-ack 202 on first signal.
  // `--permission-mode acceptEdits` lets the headless implementer actually edit
  // files (a default `claude -p` denies edits with no interactive approver).
  // Note: running the mission's Validation Commands (Bash) needs a broader mode
  // than acceptEdits — tracked as a follow-up; this at least unblocks edits.
  const args = [
    '-p',
    prompt,
    '--output-format',
    'stream-json',
    '--permission-mode',
    'acceptEdits',
    '--name',
    missionId,
  ]

  let cliPromise
  try {
    ;({ promise: cliPromise } = runClaudeCancellable({
      args,
      cwd: projectPath,
      timeoutMs: 300_000,
    }))
  } catch (err) {
    // Synchronous spawn failure — release the key so it can't leak, then 502.
    release(lockKey)
    logger.warn(
      { detail: err.message, stderr: err.stderrOutput, missionId },
      'mission_execute_spawn_failed',
    )
    return res
      .status(502)
      .json({ ok: false, error: err.message, stderr: capStderr(err.stderrOutput) })
  }

  // Convert the CLI promise to an always-resolving tagged promise so Node never
  // sees an unhandledRejection if the run fails after we early-ack. Release the
  // concurrency key once the run settles (success OR error) — this is the
  // lifecycle boundary, and finally-style so the key can never leak.
  const taggedCli = cliPromise.then(
    (v) => ({ _tag: 'cli', value: v }),
    (err) => ({ _tag: 'cli_err', error: err }),
  )
  taggedCli.finally(() => release(lockKey))
  const taggedAck = awaitNewSession(projectPath, { timeoutMs: 15_000 })
    .then((id) => ({ _tag: 'ack', sessionId: id }))
    .catch((err) => ({ _tag: 'timeout', error: err }))

  const winner = await Promise.race([taggedCli, taggedAck])

  if (winner._tag === 'cli_err') {
    const err = winner.error
    logger.warn(
      { detail: err.message, stderr: err.stderrOutput, missionId },
      'mission_execute_failed',
    )
    const status = /timed out/i.test(err.message || '') ? 504 : 502
    return res
      .status(status)
      .json({ ok: false, error: err.message, stderr: capStderr(err.stderrOutput) })
  }

  if (winner._tag === 'ack') {
    // File-watcher fired first — ack immediately, let the CLI keep running.
    // taggedCli already owns the only rejection handler on cliPromise; log any
    // background failure through it.
    const sessionId = winner.sessionId
    taggedCli.then((t) => {
      if (t._tag === 'cli_err') {
        logger.warn(
          { sessionId, detail: t.error.message, missionId },
          'mission_execute_cli_failed_after_ack',
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
  // running — the implementer session was spawned successfully and may simply
  // be slow to write its first event. Per the execute contract (202 started)
  // we ack the started run rather than kill a working process. Log the slow
  // ack and keep watching the CLI in the background for failures.
  taggedCli.then((t) => {
    if (t._tag === 'cli_err') {
      logger.warn(
        { detail: t.error.message, missionId },
        'mission_execute_cli_failed_after_slow_ack',
      )
    }
  })
  logger.info({ missionId }, 'mission_execute_slow_ack')
  return res.status(202).json({ ok: true, status: 'started' })
})

// ──────────────────────────────────────────────────────────────────────────────
// POST /:projectKey/missions/:missionId/ready
// Graduate a mission draft → ready. The harness owns mission-index.yml (it is
// the single writer), so we never edit it from the cockpit — we shell the
// `harness mission ready <id>` subcommand via the CLI and return the result.
// Synchronous: we await the run to completion (no early-ack — this is a quick
// state flip, not a long implementer session). Mirrors roadmap/compile.
// ──────────────────────────────────────────────────────────────────────────────

router.post('/:projectKey/missions/:missionId/ready', async (req, res) => {
  const { projectKey, missionId } = req.params

  const projectPath = decodeProjectKey(projectKey)
  if (projectPath === null) {
    return res.status(400).json({ error: 'invalid_project_key' })
  }

  // Whitelist membership check BEFORE any spawn — never shell into an arbitrary
  // path.
  if (!isKnownHarnessRoot(projectPath)) {
    return res.status(404).json({ error: 'not_found' })
  }

  // Concurrency guard, keyed on projectPath+missionId: a double-click must not
  // fire two ready flips for the same mission. Reserve BEFORE the spawn and
  // release in a finally — the run is fully synchronous from our side.
  const lockKey = `ready:${projectPath}:${missionId}`
  if (!acquire(lockKey)) {
    return res.status(409).json({ error: 'in_progress' })
  }

  // Ask the agent to run the harness subcommand that owns the write. The harness
  // CLI errors non-zero if the mission is not draft / not found, so the agent
  // surfaces that back to us.
  const prompt =
    `Run the harness CLI command \`harness mission ready ${missionId}\` in this ` +
    `project. Do not edit .harness/mission-index.yml directly — the harness CLI ` +
    `owns that write. Report exactly what the command printed.`

  try {
    const { stdout, stderr } = await runClaude({
      args: buildReadyArgs(prompt),
      cwd: projectPath,
      timeoutMs: 120_000,
    })
    const result = parseStreamJsonStdout(stdout)
    const summary =
      (result && typeof result.result === 'string' && result.result) ||
      (typeof stdout === 'string' ? stdout : '') ||
      ''
    return res.json({
      ok: true,
      missionId,
      summary,
      raw: stderr ? `${stdout || ''}\n${stderr}` : stdout || undefined,
    })
  } catch (err) {
    logger.warn(
      { detail: err.message, stderr: err.stderrOutput, missionId },
      'mission_ready_run_failed',
    )
    return res.status(502).json({ ok: false, error: err.message })
  } finally {
    release(lockKey)
  }
})

// Args for the one-shot mission-ready run. Kept as a small named helper so the
// test can assert the prompt + stream-json flag are present.
function buildReadyArgs(prompt) {
  return ['-p', prompt, '--output-format', 'stream-json']
}
