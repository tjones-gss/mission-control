import { Router } from 'express'
import { listTrustedCwds, trustCwd, untrustCwd } from '../lib/trust-store.js'
import { validateCwd } from '../utils/validate.js'
import { recordAuditEventSafe } from '../lib/audit-log.js'
import { logger } from '../lib/logger.js'

// Per-folder trust store HTTP surface (the locked Phase 3 decision: an in-cockpit
// "Trust this folder" control). Trusting a cwd lets future spawns in it run with
// --dangerously-skip-permissions (see pty-session.js resolvePermissionArgs), so
// this is a privileged, default-DENY security setting:
//  - it mutates ONLY the trust allowlist (no spawn, no Claude session — MED #6);
//  - state-changing methods are already covered by the loopback-only originGuard
//    + hostCheck middleware mounted ahead of the routers in index.js;
//  - the cwd is validated HARD at the boundary (absolute, no '..', no NUL).
export const router = Router()

// GET /api/trust → { trusted: [...] }
router.get('/', (_req, res) => {
  res.json({ trusted: listTrustedCwds() })
})

// POST /api/trust { cwd } → grant trust. 400 on an invalid cwd (validateCwd sends it).
router.post('/', (req, res) => {
  const { cwd } = req.body || {}
  if (!validateCwd(cwd, res)) return
  const ok = trustCwd(cwd)
  if (!ok) {
    return res.status(400).json({ error: 'invalid cwd' })
  }
  logger.warn({ detail: cwd }, 'trust_granted')
  // AUDIT (cockpit sole writer): a trust grant is a human approval of a privileged,
  // default-DENY setting (future spawns in this cwd may skip permission prompts), so
  // it is recorded as an 'approval' event. Fire-and-forget — audit is observability,
  // not the system of record, and must not fail the grant.
  recordAuditEventSafe({
    eventType: 'approval',
    source: 'cockpit',
    decision: 'approved',
    subjectId: cwd,
    outcome: 'succeeded',
    // v9 controlState: a trust grant is a POLICY decision — it changes the
    // control configuration itself (future spawns in this cwd may skip
    // permission prompts) rather than gating one execution.
    controlState: {
      gateType: 'policy',
      decisionMaker: 'human',
      policiesInForce: ['trust-store:default-deny'],
    },
    payload: { kind: 'trust_grant', cwd },
  })
  res.json({ ok: true, trusted: listTrustedCwds() })
})

// DELETE /api/trust { cwd } → revoke trust. Body-style (not a path param) to avoid
// URL-encoding a Windows path with ':' and '\'.
router.delete('/', (req, res) => {
  const { cwd } = req.body || {}
  if (!validateCwd(cwd, res)) return
  untrustCwd(cwd)
  logger.warn({ detail: cwd }, 'trust_revoked')
  res.json({ ok: true, trusted: listTrustedCwds() })
})
