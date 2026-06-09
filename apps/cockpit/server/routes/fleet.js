// Fleet routes — thin Express layer over server/fleet/fleet-runner.js.
//
// The runner owns all lifecycle, spawning, persistence and safety. This router
// only validates request bodies, calls runner functions, and maps their results
// to HTTP status codes. It builds NO spawn / approval / persistence of its own.
//
// Allow/deny goes through POST /:id/decide, which dispatches to the EXISTING
// write paths — the in-memory SDK resolver (resolveApproval, the same one
// POST /api/sessions/:id/tool-approval uses) for source 'tool', and the harness
// CLI (`harness approve`) shelled in the child's cwd for source 'harness'. The
// route NEVER writes a decided file itself — the harness CLI owns that write.
// GET /:id/escalations stays read-of-truth but persists the 'escalated' child
// status as a side effect (running↔escalated) so the badge survives a reload.

import { Router } from 'express'
import {
  startFleetRun,
  listFleetRuns,
  getFleetRun,
  reconcileEscalationStatus,
  decideFleetEscalation,
  cancelFleet,
  killAllFleets,
  isKillSwitchEngaged,
  resetKillSwitch,
  saveFleetTemplate,
  listFleetTemplates,
  getFleetTemplate,
} from '../fleet/fleet-runner.js'
import { validateWorkflowName } from '../utils/validate.js'
import { logger } from '../lib/logger.js'

export const router = Router()

// POST /api/fleet — start a run (early-ack 202; children spawn in background).
// Accepts EITHER an inline { goal, children, policy } body OR { template: name }
// to load a saved template and instantiate it. PRECEDENCE: the template provides
// defaults; explicit inline fields override (so you can launch a template with a
// tweaked goal). startFleetRun is otherwise unchanged — templates are a
// request-construction convenience, not a new lifecycle.
/**
 * @openapi
 * /api/fleet:
 *   post:
 *     summary: Start a Fleet run (early-ack 202; children spawn in the background).
 *     tags: [Fleet]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               goal: { type: string }
 *               children: { type: integer }
 *               policy: { type: object }
 *               template: { type: string }
 *     responses:
 *       202:
 *         description: Run accepted; children spawning.
 *       404:
 *         description: Unknown template.
 *       502:
 *         description: Failed to start the run.
 *   get:
 *     summary: List Fleet runs.
 *     tags: [Fleet]
 *     responses:
 *       200:
 *         description: Array of Fleet runs.
 */
router.post('/', async (req, res) => {
  const body = req.body || {}
  let { goal, children, policy } = body

  if (body.template) {
    const tpl = getFleetTemplate(body.template)
    if (!tpl) return res.status(404).json({ error: 'unknown template' })
    // Template provides defaults; explicit inline fields override.
    goal = goal != null ? goal : tpl.goal
    children = children != null ? children : tpl.children
    policy = policy != null ? policy : tpl.policy
  }

  let result
  try {
    result = await startFleetRun({ goal, children, policy })
  } catch (err) {
    logger.warn({ detail: err.message }, 'fleet_start_failed')
    return res.status(502).json({ ok: false, error: err.message })
  }
  if (!result.ok) {
    return res.status(result.status || 400).json({ error: result.error })
  }
  return res.status(202).json({
    ok: true,
    id: result.id,
    status: result.runStatus,
    children: result.children,
  })
})

// GET /api/fleet — list run summaries.
router.get('/', (_req, res) => {
  res.json({ runs: listFleetRuns() })
})

// ── Global hard kill-switch ──────────────────────────────────────────────────
// IMPORTANT: registered BEFORE the '/:id' param routes below so 'kill' is not
// matched as an :id. POST engages the global stop (no new run/child can spawn,
// in-flight cancels invoked); GET reports its state; DELETE disengages it. The
// switch is a module flag independent of in-memory run state, so it stays
// reachable even when the registries are empty (e.g. right after a restart).

// GET /api/fleet/kill — report whether the global kill-switch is engaged.
router.get('/kill', (_req, res) => {
  res.json({ engaged: isKillSwitchEngaged() })
})

// POST /api/fleet/kill — engage the global hard kill-switch (last-resort stop).
router.post('/kill', (_req, res) => {
  let result
  try {
    result = killAllFleets()
  } catch (err) {
    logger.warn({ detail: err.message }, 'fleet_kill_failed')
    return res.status(502).json({ ok: false, error: err.message })
  }
  res.status(result.status || 202).json({
    ok: true,
    engaged: result.engaged,
    cancelled: result.cancelled,
  })
})

// DELETE /api/fleet/kill — disengage the kill-switch (re-arm the line).
router.delete('/kill', (_req, res) => {
  resetKillSwitch()
  res.json({ ok: true, engaged: isKillSwitchEngaged() })
})

// ── Templates ──────────────────────────────────────────────────────────────
// IMPORTANT: GET/POST '/templates' MUST be registered BEFORE the '/:id' param
// routes below, or Express matches 'templates' as an :id (route-ordering gotcha).

// POST /api/fleet/templates — save a repeatable fleet config. The name is
// validated like a workflow name (the route-level fail-closed) AND the runner
// re-validates it + the body before any write.
router.post('/templates', async (req, res) => {
  const { name, goal, children, policy } = req.body || {}
  if (!validateWorkflowName(name, res)) return // 400 already sent
  let result
  try {
    result = await saveFleetTemplate({ name, goal, children, policy })
  } catch (err) {
    logger.warn({ detail: err.message }, 'fleet_template_save_failed')
    return res.status(502).json({ ok: false, error: err.message })
  }
  if (!result.ok) {
    return res.status(result.status || 400).json({ error: result.error })
  }
  return res.status(200).json({ ok: true, template: result.template })
})

// GET /api/fleet/templates — list saved templates.
router.get('/templates', (_req, res) => {
  res.json({ templates: listFleetTemplates() })
})

/**
 * @openapi
 * /api/fleet/{id}:
 *   get:
 *     summary: Full persisted Fleet run state.
 *     tags: [Fleet]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The run state.
 *       404:
 *         description: Unknown run id.
 */
// GET /api/fleet/:id — full persisted run state.
router.get('/:id', (req, res) => {
  const state = getFleetRun(req.params.id)
  if (!state) return res.status(404).json({ error: 'not_found' })
  res.json(state)
})

// GET /api/fleet/:id/escalations — merged escalation list. Reconciles the
// 'escalated' child status as a side effect (running↔escalated) and persists it
// when it changes, so the badge survives a reload; still emits no decision.
router.get('/:id/escalations', async (req, res) => {
  const state = getFleetRun(req.params.id)
  if (!state) return res.status(404).json({ error: 'not_found' })
  let escalations
  try {
    escalations = await reconcileEscalationStatus(req.params.id)
  } catch (err) {
    logger.warn({ detail: err.message, id: req.params.id }, 'fleet_escalations_failed')
    return res.status(502).json({ error: err.message })
  }
  res.json({ escalations })
})

// POST /api/fleet/:id/decide — route ONE human Allow/Deny through the existing
// write path. Body: { childIdx, source:'tool'|'harness', decision:'allow'|'deny',
// approvalId?, requestId?, message? }. The runner dispatches to resolveApproval
// (tool) or shells `harness approve` in the child cwd (harness); it never writes
// a decided file directly. 4xx on bad input/unknown child.
router.post('/:id/decide', async (req, res) => {
  let result
  try {
    result = await decideFleetEscalation(req.params.id, req.body || {})
  } catch (err) {
    logger.warn({ detail: err.message, id: req.params.id }, 'fleet_decide_failed')
    return res.status(502).json({ ok: false, error: err.message })
  }
  if (!result.ok) {
    return res.status(result.status || 400).json({ error: result.error })
  }
  return res.status(result.status || 200).json(result)
})

// POST /api/fleet/:id/cancel — cancel in-flight children.
router.post('/:id/cancel', async (req, res) => {
  let result
  try {
    result = await cancelFleet(req.params.id)
  } catch (err) {
    logger.warn({ detail: err.message, id: req.params.id }, 'fleet_cancel_failed')
    return res.status(502).json({ ok: false, error: err.message })
  }
  if (!result.ok) {
    return res.status(result.status || 404).json({ error: result.error })
  }
  return res.status(202).json({ ok: true })
})
