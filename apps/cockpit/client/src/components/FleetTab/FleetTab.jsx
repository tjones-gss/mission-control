import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Layers,
  Plus,
  X,
  Send,
  Loader2,
  AlertCircle,
  AlertTriangle,
  GitBranch,
  Check,
  ShieldAlert,
  FolderGit2,
  Trash2,
  Lock,
  ShieldCheck,
  ThumbsUp,
  ThumbsDown,
  Save,
  DollarSign,
} from 'lucide-react'
import { useApi } from '../../hooks/useApi.js'
import { formatCost } from '../../utils/cost.js'
import { Markdown } from '../Markdown.jsx'

// Fleet UI — the power-user headline surface. Launch a fleet (a goal + N child
// agents, each in its own git worktree/branch), then watch the children live as
// a grid of cards with per-child cost, escalation banners, and a synthesis report
// at the bottom.
//
// This component owns NO spawn / approval / persistence logic. It calls the
// EXISTING server contract: POST /api/fleet to launch, GET /api/fleet[/:id] to
// read, GET /api/fleet/:id/escalations for banners, and routes Allow/Deny through
// POST /api/fleet/:id/decide. The runner dispatches that decision to the existing
// write paths server-side (the in-memory SDK resolver for 'tool', the harness CLI
// for 'harness') — so both escalation sources resolve from one UI button. The
// fleet_update SSE event (handled in App.jsx) bumps the version prop so the live
// view refetches in place — exactly like harness_update.

// Run-level status pill styling.
const RUN_STATUS = {
  running: { cls: 'bg-green-900/50 text-green-300', dot: 'bg-green-400' },
  succeeded: { cls: 'bg-emerald-900/50 text-emerald-300', dot: 'bg-emerald-400' },
  partial: { cls: 'bg-amber-900/50 text-amber-300', dot: 'bg-amber-400' },
  failed: { cls: 'bg-red-900/50 text-red-300', dot: 'bg-red-400' },
  cancelled: { cls: 'bg-gray-800 text-gray-400', dot: 'bg-gray-500' },
  budget_exceeded: { cls: 'bg-orange-900/50 text-orange-300', dot: 'bg-orange-400' },
}

// Per-child status pill styling. verifying = a verifier is reviewing the worker;
// rejected = a verifier rejected it and re-dispatch is exhausted; budget_skipped =
// never spawned because its projected cost would exceed the budget.
const CHILD_STATUS = {
  starting: { cls: 'text-indigo-300', dot: 'bg-indigo-400' },
  running: { cls: 'text-green-400', dot: 'bg-green-400' },
  escalated: { cls: 'text-amber-300', dot: 'bg-amber-400' },
  succeeded: { cls: 'text-emerald-400', dot: 'bg-emerald-500' },
  failed: { cls: 'text-red-400', dot: 'bg-red-500' },
  cancelled: { cls: 'text-gray-500', dot: 'bg-gray-600' },
  verifying: { cls: 'text-sky-300', dot: 'bg-sky-400' },
  rejected: { cls: 'text-rose-400', dot: 'bg-rose-500' },
  budget_skipped: { cls: 'text-orange-400', dot: 'bg-orange-500' },
}

const RISK_STYLE = {
  DESTRUCTIVE: 'bg-red-700 text-red-100',
  CODE_EXECUTION: 'bg-amber-800 text-amber-200',
  REQUIRES_REVIEW: 'bg-yellow-800 text-yellow-200',
  SAFE_READONLY: 'bg-green-800 text-green-200',
}

// Last path segment of a cwd (handles both / and \ separators) for a compact
// label on each child card.
function basename(cwd) {
  if (!cwd) return ''
  const parts = String(cwd).split(/[\\/]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : cwd
}

function timeAgo(iso) {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const secs = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (secs < 60) return `${secs}s ago`
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

// ──────────────────────────────────────────────────────────────────────────────
// Escalation banner — prominent Allow / Deny on a child card. Routes the human
// decision through POST /api/fleet/:id/decide (handled by onDecide), which the
// runner dispatches to the existing write paths. Fleet adds NO new approval
// logic — it only POSTs the decision; works for both 'tool' and 'harness'.
// ──────────────────────────────────────────────────────────────────────────────
function EscalationBanner({ escalation, onDecide }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const riskBadge = escalation.riskLevel ? RISK_STYLE[escalation.riskLevel] || null : null

  const decide = useCallback(
    async (decision) => {
      if (busy) return
      setBusy(true)
      setError(null)
      try {
        await onDecide(escalation, decision)
      } catch (e) {
        setError(e.message || 'failed')
      } finally {
        setBusy(false)
      }
    },
    [busy, onDecide, escalation],
  )

  return (
    <div className="mt-2 rounded-lg border border-red-600/70 bg-red-950/40 shadow-[0_0_12px_rgba(220,38,38,0.2)] p-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <ShieldAlert size={13} className="text-red-400 shrink-0" />
        <span className="text-[11px] font-semibold text-red-200">Escalation</span>
        {escalation.tool && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-800 text-gray-300">
            {escalation.tool}
          </span>
        )}
        {riskBadge && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${riskBadge}`}>
            {escalation.riskLevel}
          </span>
        )}
        <span className="px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide bg-gray-800 text-gray-500">
          {escalation.source}
        </span>
      </div>
      {escalation.command && (
        <pre className="mt-1.5 bg-gray-900 text-gray-400 text-[11px] font-mono p-1.5 rounded overflow-x-auto max-h-20 overflow-y-auto whitespace-pre-wrap break-all">
          {escalation.command}
        </pre>
      )}
      {error && <div className="mt-1.5 text-[11px] text-red-400">⚠ {error}</div>}
      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          onClick={() => decide('allow')}
          disabled={busy}
          className="px-2.5 py-1 rounded bg-green-700 text-white text-[11px] font-medium hover:bg-green-600 disabled:opacity-40 transition-colors flex items-center gap-1"
        >
          {busy ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Allow
        </button>
        <button
          type="button"
          onClick={() => decide('deny')}
          disabled={busy}
          className="px-2.5 py-1 rounded bg-red-700 text-white text-[11px] font-medium hover:bg-red-600 disabled:opacity-40 transition-colors flex items-center gap-1"
        >
          <X size={10} /> Deny
        </button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Verdict list — one row per adversarial verification round on a worker. Each
// verdict is approve/reject + a reason; a reject means the verifier sent the
// worker back (bounded by policy.verify.maxRounds). Read-only: the verdict was
// produced server-side by an independent verifier child; the UI only renders it.
// ──────────────────────────────────────────────────────────────────────────────
function VerdictList({ verdicts }) {
  return (
    <div className="flex flex-col gap-1">
      {verdicts.map((v, i) => {
        const approved = v.verdict === 'approve'
        const reasons = Array.isArray(v.reasons) ? v.reasons.filter(Boolean) : []
        return (
          <div
            key={`${v.round}-${v.verifierSessionId || i}`}
            data-testid={`fleet-verdict-${i}`}
            className={[
              'rounded border px-2 py-1 text-[11px] flex items-start gap-1.5',
              approved
                ? 'border-emerald-800/60 bg-emerald-950/30 text-emerald-300'
                : 'border-rose-800/60 bg-rose-950/30 text-rose-300',
            ].join(' ')}
          >
            {approved ? (
              <ThumbsUp size={11} className="shrink-0 mt-0.5" />
            ) : (
              <ThumbsDown size={11} className="shrink-0 mt-0.5" />
            )}
            <span className="flex-1 min-w-0 break-words">
              <span className="font-semibold uppercase tracking-wide">
                {approved ? 'approved' : 'rejected'}
              </span>
              {typeof v.round === 'number' && (
                <span className="text-gray-500 ml-1">round {v.round}</span>
              )}
              {reasons.length > 0 && <span className="text-gray-400"> — {reasons.join('; ')}</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Child card — idx, cwd basename, branch/worktree, status pill, per-child cost,
// a link into the Agents/Inspect view, and (when escalated) an escalation banner.
// ──────────────────────────────────────────────────────────────────────────────
function ChildCard({ child, escalations, onDecide, onOpenSession }) {
  const meta = CHILD_STATUS[child.status] || CHILD_STATUS.starting
  // Canonical session-cost shape ({ totalCost, breakdown, family }) — render the
  // total USD and, when present, the model family that produced it.
  const cost = child.cost && typeof child.cost.totalCost === 'number' ? child.cost.totalCost : null
  const family = child.cost && child.cost.family ? child.cost.family : null
  // A child is escalated if its status says so OR it has live escalations.
  const isEscalated = child.status === 'escalated' || escalations.length > 0

  return (
    <div
      data-testid={`fleet-child-${child.idx}`}
      className={[
        'rounded-lg border bg-gray-900/60 p-3 flex flex-col gap-2 min-w-0',
        isEscalated ? 'border-red-700/70' : 'border-gray-800',
      ].join(' ')}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[10px] font-mono text-gray-600 shrink-0">#{child.idx}</span>
        <FolderGit2 size={13} className="text-indigo-400 shrink-0" />
        <span
          className="text-sm font-medium text-gray-100 truncate flex-1 min-w-0"
          title={child.cwd}
        >
          {basename(child.cwd)}
        </span>
        {child.quarantine && (
          <span
            data-testid={`fleet-quarantine-${child.idx}`}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-orange-900/50 text-orange-300 text-[9px] font-semibold uppercase tracking-wide shrink-0"
            title="Quarantined: best-effort read-only stance (advisory, not a sandbox)"
          >
            <Lock size={9} /> quarantine
          </span>
        )}
        <span className="flex items-center gap-1 shrink-0">
          <span className={`relative flex h-1.5 w-1.5 rounded-full ${meta.dot}`}>
            {(child.status === 'running' ||
              child.status === 'starting' ||
              child.status === 'verifying') && (
              <span className="absolute inset-0 rounded-full bg-current animate-ping opacity-60" />
            )}
          </span>
          <span className={`text-[10px] uppercase ${meta.cls}`}>{child.status}</span>
        </span>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-gray-500 min-w-0">
        <GitBranch size={11} className="shrink-0 text-gray-600" />
        <span className="font-mono truncate min-w-0" title={child.branch}>
          {child.branch || '—'}
        </span>
        {child.worktree && (
          <span className="px-1 py-0.5 rounded bg-gray-800 text-gray-500 text-[9px] shrink-0">
            worktree
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 text-[11px]">
        {cost != null ? (
          <span className="text-emerald-500 font-mono">{formatCost(cost)}</span>
        ) : (
          <span className="text-gray-600 font-mono">—</span>
        )}
        {family != null && <span className="text-gray-600 font-mono">{family}</span>}
        {child.sessionId && (
          <button
            type="button"
            onClick={() => onOpenSession(child.sessionId)}
            className="ml-auto text-indigo-400 hover:text-indigo-300 transition-colors"
            title="Open this child session in the Agents view"
          >
            open session →
          </button>
        )}
      </div>

      {child.error && (
        <div className="text-[11px] text-red-400 flex items-start gap-1">
          <AlertCircle size={11} className="shrink-0 mt-0.5" />
          <span className="break-words min-w-0">{child.error}</span>
        </div>
      )}

      {Array.isArray(child.verdicts) && child.verdicts.length > 0 && (
        <VerdictList verdicts={child.verdicts} />
      )}

      {escalations.map((esc) => (
        <EscalationBanner
          key={`${esc.source}-${esc.approvalId || esc.requestId}`}
          escalation={esc}
          onDecide={onDecide}
        />
      ))}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Launch drawer — mirrors the DispatchDrawer pattern: a goal textarea over a
// repeatable child-row editor (cwd + a prompt OR a workflow select). Submit POSTs
// to /api/fleet and closes on success.
// ──────────────────────────────────────────────────────────────────────────────
function emptyChild() {
  return { cwd: '', prompt: '', workflow: '', quarantine: false }
}

function LaunchDrawer({ open, onClose, onLaunched, onSaveTemplate, workflows, roots, templates }) {
  const [goal, setGoal] = useState('')
  const [children, setChildren] = useState(() => [emptyChild()])
  const [budget, setBudget] = useState('')
  const [verify, setVerify] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const goalRef = useRef(null)
  const workflowList = useMemo(() => (Array.isArray(workflows) ? workflows : []), [workflows])
  const templateList = useMemo(() => (Array.isArray(templates) ? templates : []), [templates])

  useEffect(() => {
    if (!open) return
    setError(null)
    setTimeout(() => goalRef.current?.focus(), 50)
  }, [open])

  // Load a saved template into the form. The user can still tweak any field
  // before launching — server-side the inline body overrides template defaults.
  const applyTemplate = useCallback((tpl) => {
    if (!tpl) return
    setGoal(tpl.goal || '')
    const tplChildren = Array.isArray(tpl.children) ? tpl.children : []
    setChildren(
      tplChildren.length
        ? tplChildren.map((c) => ({
            cwd: c.cwd || '',
            prompt: c.prompt || '',
            workflow: c.workflow || '',
            quarantine: !!c.quarantine,
          }))
        : [emptyChild()],
    )
    const pol = tpl.policy || {}
    setBudget(typeof pol.budgetUsd === 'number' ? String(pol.budgetUsd) : '')
    setVerify(!!pol.verify)
    setError(null)
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (e.key === 'Escape' && !submitting) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, submitting, onClose])

  const updateChild = useCallback((idx, patch) => {
    setChildren((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)))
  }, [])

  const addChild = useCallback(() => {
    setChildren((prev) => [...prev, emptyChild()])
  }, [])

  const removeChild = useCallback((idx) => {
    setChildren((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)))
  }, [])

  // Build the child array + policy shared by Launch and Save-as-template. Returns
  // null and sets an error when the form is invalid. Only a prompt OR a workflow
  // is sent per child; quarantine rides along only when checked.
  const buildBody = useCallback(() => {
    if (!goal.trim()) {
      setError('A goal is required.')
      return null
    }
    const payload = children
      .filter((c) => c.cwd.trim())
      .map((c) => {
        const base = { cwd: c.cwd.trim() }
        if (c.workflow.trim()) base.workflow = c.workflow.trim()
        else base.prompt = c.prompt.trim()
        if (c.quarantine) base.quarantine = true
        return base
      })
    if (payload.length === 0) {
      setError('Add at least one child with a working directory.')
      return null
    }
    if (payload.some((c) => !c.workflow && !c.prompt)) {
      setError('Each child needs a prompt or a workflow.')
      return null
    }
    // policy.budgetUsd from the budget field (when a positive number) and
    // policy.verify from the toggle — both omitted when off so behaviour is
    // unchanged for runs that do not opt in.
    const policy = {}
    const budgetNum = Number(budget)
    if (budget.trim() && Number.isFinite(budgetNum) && budgetNum > 0) {
      policy.budgetUsd = budgetNum
    }
    if (verify) policy.verify = true
    return { goal: goal.trim(), children: payload, policy }
  }, [goal, children, budget, verify])

  const submit = useCallback(async () => {
    if (submitting) return
    const body = buildBody()
    if (!body) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/fleet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || data.detail || `HTTP ${res.status}`)
      }
      // Optimistically surface the new run as 'running'.
      onLaunched({
        id: data.id,
        goal: body.goal,
        status: data.status || 'running',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        childCount: body.children.length,
        settledCount: 0,
        synthesis: 'pending',
      })
      setGoal('')
      setChildren([emptyChild()])
      setBudget('')
      setVerify(false)
      onClose()
    } catch (e) {
      setError(e.message || 'Could not launch fleet.')
    } finally {
      setSubmitting(false)
    }
  }, [submitting, buildBody, onLaunched, onClose])

  // Save the current form as a reusable template (POST /api/fleet/templates via
  // onSaveTemplate). Prompts for a name; does not launch. The template carries
  // the same children + policy shape as a launch body.
  const saveTemplate = useCallback(async () => {
    if (submitting) return
    const body = buildBody()
    if (!body) return
    const name = window.prompt('Template name (letters, digits, _ or -):')
    if (!name || !name.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await onSaveTemplate({ name: name.trim(), ...body })
    } catch (e) {
      setError(e.message || 'Could not save template.')
    } finally {
      setSubmitting(false)
    }
  }, [submitting, buildBody, onSaveTemplate])

  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
        onClick={() => !submitting && onClose()}
      />
      <div
        className="fixed left-1/2 bottom-0 z-50 w-[min(92vw,960px)] bg-gray-950 border border-b-0 border-gray-800 rounded-t-xl shadow-2xl -translate-x-1/2"
        style={{ height: 'min(78vh, 700px)' }}
        role="dialog"
        aria-label="New fleet run"
        aria-modal="true"
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
          <Layers size={16} className="text-indigo-400" />
          <span className="text-sm font-semibold text-gray-100">New Fleet Run</span>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="ml-auto text-gray-600 hover:text-gray-300 transition-colors p-1 rounded disabled:opacity-30"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col h-[calc(100%-58px)]">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {templateList.length > 0 && (
              <div>
                <label
                  htmlFor="fleet-template-picker"
                  className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1"
                >
                  Launch from template
                </label>
                <select
                  id="fleet-template-picker"
                  aria-label="launch from template"
                  defaultValue=""
                  onChange={(e) => {
                    const tpl = templateList.find((t) => t.name === e.target.value)
                    applyTemplate(tpl)
                    e.target.value = ''
                  }}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">— pick a saved template —</option>
                  {templateList.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">
                Goal
              </label>
              <textarea
                ref={goalRef}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={2}
                placeholder="What should the fleet accomplish? (e.g. Add OAuth across all services)"
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none"
              />
            </div>

            {/* Run policy — budget cap + adversarial verification. Both opt-in;
                omitted from the request when off so default behaviour is kept. */}
            <div className="flex items-end gap-4 flex-wrap">
              <div>
                <label
                  htmlFor="fleet-budget"
                  className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1"
                >
                  Budget (USD)
                </label>
                <div className="flex items-center gap-1.5 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 focus-within:border-indigo-500">
                  <DollarSign size={12} className="text-gray-600 shrink-0" />
                  <input
                    id="fleet-budget"
                    type="number"
                    min="0"
                    step="0.5"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    placeholder="no cap"
                    aria-label="budget usd"
                    className="w-24 bg-transparent text-xs text-gray-200 placeholder-gray-600 focus:outline-none font-mono"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer pb-1.5">
                <input
                  type="checkbox"
                  checked={verify}
                  onChange={(e) => setVerify(e.target.checked)}
                  aria-label="verify results"
                  className="accent-indigo-500"
                />
                <ShieldCheck size={13} className="text-sky-400" />
                Verify results (adversarial review)
              </label>
            </div>

            <div className="space-y-2">
              <div className="flex items-center">
                <span className="text-[11px] uppercase tracking-wide text-gray-500">Children</span>
                <button
                  type="button"
                  onClick={addChild}
                  className="ml-auto flex items-center gap-1 text-[11px] text-indigo-300 hover:text-indigo-200 transition-colors"
                >
                  <Plus size={12} /> Add child
                </button>
              </div>
              {children.map((child, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-gray-800 bg-gray-900/50 p-2.5 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-gray-600 shrink-0">#{idx}</span>
                    <input
                      type="text"
                      value={child.cwd}
                      onChange={(e) => updateChild(idx, { cwd: e.target.value })}
                      list="fleet-roots"
                      placeholder="Working directory (a known harness root)"
                      aria-label={`child ${idx} working directory`}
                      className="flex-1 min-w-0 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500 font-mono"
                    />
                    {children.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeChild(idx)}
                        className="shrink-0 text-gray-600 hover:text-red-400 transition-colors p-1"
                        title="Remove child"
                        aria-label={`remove child ${idx}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                  <div className="flex items-start gap-2">
                    <textarea
                      value={child.prompt}
                      onChange={(e) => updateChild(idx, { prompt: e.target.value })}
                      disabled={!!child.workflow.trim()}
                      rows={2}
                      placeholder="Prompt for this child…"
                      aria-label={`child ${idx} prompt`}
                      className="flex-1 min-w-0 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none disabled:opacity-40"
                    />
                    <div className="flex flex-col gap-1 shrink-0 w-40">
                      <span className="text-[10px] text-gray-600">or workflow</span>
                      <select
                        value={child.workflow}
                        onChange={(e) => updateChild(idx, { workflow: e.target.value })}
                        aria-label={`child ${idx} workflow`}
                        className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500"
                      >
                        <option value="">— none —</option>
                        {workflowList.map((wf) => (
                          <option key={wf.name} value={wf.name}>
                            {wf.name}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1.5 text-[10px] text-gray-400 cursor-pointer mt-0.5">
                        <input
                          type="checkbox"
                          checked={!!child.quarantine}
                          onChange={(e) => updateChild(idx, { quarantine: e.target.checked })}
                          aria-label={`child ${idx} quarantine`}
                          className="accent-orange-500"
                        />
                        <Lock size={10} className="text-orange-400" />
                        quarantine (read-only)
                      </label>
                    </div>
                  </div>
                </div>
              ))}
              <datalist id="fleet-roots">
                {(Array.isArray(roots) ? roots : []).map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="border-t border-gray-800 px-4 py-3 bg-gray-900/40 flex items-center gap-3">
            {error && (
              <span className="text-[11px] text-red-400 flex items-center gap-1.5">
                <AlertTriangle size={12} /> {error}
              </span>
            )}
            <button
              type="button"
              onClick={saveTemplate}
              disabled={submitting}
              className="ml-auto px-3 py-2 rounded border border-gray-700 text-gray-300 text-sm font-medium hover:bg-gray-800 hover:text-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 shrink-0"
            >
              <Save size={14} /> Save as template
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="px-4 py-2 rounded bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 shrink-0"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {submitting ? 'Launching…' : 'Launch Fleet'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Live run detail — run header + child grid + synthesis report.
// ──────────────────────────────────────────────────────────────────────────────
function RunDetail({ runId, version, onOpenSession }) {
  // Full persisted run state. The fleetVersion bump (from a fleet_update SSE
  // event) is in deps so the run refetches in place when anything changes.
  const {
    data: run,
    loading,
    error,
  } = useApi(runId ? `/api/fleet/${runId}` : null, [runId, version])
  // Escalation list is read-only and refreshed on the same version bump.
  const { data: escData, refetch: refetchEsc } = useApi(
    runId ? `/api/fleet/${runId}/escalations` : null,
    [runId, version],
  )
  const escalations = escData?.escalations || []

  // Route a human decision through the fleet decision endpoint. Fleet adds no
  // new approval logic — POST /api/fleet/:id/decide dispatches to the EXISTING
  // write paths server-side: the in-memory SDK resolver for source 'tool' and
  // the harness CLI (`harness approve`) shelled in the child cwd for source
  // 'harness'. Both escalation sources are now resolvable from the UI.
  const decide = useCallback(
    async (escalation, decision) => {
      const payload = {
        childIdx: escalation.childIdx,
        source: escalation.source,
        decision,
      }
      // 'tool' decisions carry an approvalId; 'harness' decisions a requestId.
      if (escalation.source === 'harness') {
        payload.requestId = escalation.requestId || escalation.approvalId
      } else {
        payload.approvalId = escalation.approvalId || escalation.requestId
      }
      const res = await fetch(`/api/fleet/${runId}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || body.detail || `HTTP ${res.status}`)
      }
      // Refresh the banner list — the resolved escalation should drop off.
      refetchEsc()
    },
    [runId, refetchEsc],
  )

  if (loading && !run) {
    return <div className="text-xs text-gray-500 italic p-4">Loading run…</div>
  }
  if (error) {
    return (
      <div className="text-xs text-red-400 p-4 flex items-center gap-1.5">
        <AlertCircle size={12} /> {error}
      </div>
    )
  }
  if (!run) return null

  const statusMeta = RUN_STATUS[run.status] || RUN_STATUS.running
  // Aggregate cost across children that report one.
  const totalCost = (run.children || []).reduce((sum, c) => {
    const v = c.cost && typeof c.cost.totalCost === 'number' ? c.cost.totalCost : 0
    return sum + v
  }, 0)
  // Budget bar: spentUsd / budgetRemaining come from the runner (recomputed on
  // every cost movement). Only shown when a budget cap is set on the run.
  const budgetUsd =
    run.policy && typeof run.policy.budgetUsd === 'number' ? run.policy.budgetUsd : null
  const spentUsd = typeof run.spentUsd === 'number' ? run.spentUsd : totalCost
  const budgetRemaining =
    typeof run.budgetRemaining === 'number'
      ? run.budgetRemaining
      : budgetUsd != null
        ? Math.max(0, budgetUsd - spentUsd)
        : null
  const budgetPct =
    budgetUsd != null && budgetUsd > 0 ? Math.min(100, (spentUsd / budgetUsd) * 100) : 0
  const budgetOver =
    run.status === 'budget_exceeded' || (budgetUsd != null && spentUsd >= budgetUsd)
  // Group escalations by child idx so each card shows its own.
  const escByChild = escalations.reduce((acc, e) => {
    ;(acc[e.childIdx] = acc[e.childIdx] || []).push(e)
    return acc
  }, {})
  const synthesis = run.synthesis || { status: 'pending' }

  return (
    <div className="p-4 space-y-4">
      {/* Run header */}
      <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Layers size={15} className="text-indigo-400 shrink-0" />
          <span className="text-sm font-semibold text-gray-100">{run.goal}</span>
          <span
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${statusMeta.cls}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} />
            {run.status}
          </span>
          {budgetUsd == null && totalCost > 0 && (
            <span className="text-[11px] text-emerald-500 font-mono">{formatCost(totalCost)}</span>
          )}
          <span className="ml-auto text-[10px] text-gray-600">{timeAgo(run.createdAt)}</span>
        </div>

        {/* Budget bar — spent vs cap, with a remaining readout. */}
        {budgetUsd != null && (
          <div data-testid="fleet-budget-bar" className="mt-2.5">
            <div className="flex items-center justify-between text-[10px] mb-1">
              <span className="text-gray-500">
                Budget{' '}
                <span className={budgetOver ? 'text-orange-400 font-semibold' : 'text-gray-400'}>
                  {formatCost(spentUsd)} / {formatCost(budgetUsd)}
                </span>
              </span>
              <span className={budgetOver ? 'text-orange-400 font-semibold' : 'text-gray-500'}>
                {budgetOver
                  ? 'budget exceeded'
                  : budgetRemaining != null
                    ? `${formatCost(budgetRemaining)} left`
                    : ''}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
              <div
                className={`h-full rounded-full ${budgetOver ? 'bg-orange-500' : 'bg-emerald-500'}`}
                style={{ width: `${budgetPct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Child grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {(run.children || []).map((child) => (
          <ChildCard
            key={child.idx}
            child={child}
            escalations={escByChild[child.idx] || []}
            onDecide={decide}
            onOpenSession={onOpenSession}
          />
        ))}
      </div>

      {/* Synthesis report */}
      <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-gray-500">Synthesis</span>
          <span className="text-[10px] text-gray-500">{synthesis.status}</span>
          {synthesis.status === 'running' && (
            <Loader2 size={12} className="text-indigo-400 animate-spin" />
          )}
        </div>
        {synthesis.status === 'done' && synthesis.summary ? (
          <div className="mt-2">
            <Markdown>{synthesis.summary}</Markdown>
          </div>
        ) : synthesis.status === 'skipped' ? (
          <div className="mt-2 text-[11px] text-gray-500 italic">
            {synthesis.summary || 'Synthesis skipped.'}
          </div>
        ) : (
          <div className="mt-2 text-[11px] text-gray-600 italic">
            Synthesis runs once all children settle.
          </div>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// FleetTab — the surface itself.
// ──────────────────────────────────────────────────────────────────────────────
export function FleetTab({ fleetVersion = 0, onOpenSession }) {
  const [showLaunch, setShowLaunch] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  // Optimistic runs added on launch before the first list refetch lands.
  const [optimistic, setOptimistic] = useState([])

  const { data: listData } = useApi('/api/fleet', [fleetVersion])
  const { data: workflows } = useApi('/api/workflows')
  const { data: managersData } = useApi('/api/managers')
  // Saved fleet templates for the launcher's "launch from template" picker.
  // Refetched after a save so a newly-saved template appears in the picker.
  const [templateVersion, setTemplateVersion] = useState(0)
  const { data: templatesData } = useApi('/api/fleet/templates', [templateVersion])
  const templates = templatesData?.templates || []

  // Save the launcher form as a reusable template. POSTs to /api/fleet/templates
  // and bumps templateVersion so the picker refetches. Throws on failure so the
  // drawer surfaces the error inline.
  const handleSaveTemplate = useCallback(async (template) => {
    const res = await fetch('/api/fleet/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(template),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || data.detail || `HTTP ${res.status}`)
    }
    setTemplateVersion((v) => v + 1)
  }, [])

  const runs = useMemo(() => {
    const fromServer = (listData?.runs || []).slice()
    const serverIds = new Set(fromServer.map((r) => r.id))
    // Keep optimistic entries only until the server reports the same id.
    const extra = optimistic.filter((o) => !serverIds.has(o.id))
    const all = [...extra, ...fromServer]
    // Newest first by createdAt.
    return all.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
  }, [listData, optimistic])

  // Known harness roots double as cwd autocomplete suggestions for the launcher.
  const roots = useMemo(() => {
    const mgrs = managersData?.managers || []
    const dirs = mgrs.map((m) => m.dir).filter(Boolean)
    return Array.from(new Set(dirs))
  }, [managersData])

  // Default-select the newest run when none is selected.
  useEffect(() => {
    if (!selectedId && runs.length > 0) {
      setSelectedId(runs[0].id)
    }
  }, [runs, selectedId])

  const handleLaunched = useCallback((run) => {
    setOptimistic((prev) => [run, ...prev.filter((r) => r.id !== run.id)])
    setSelectedId(run.id)
  }, [])

  const onOpen = useCallback(
    (sessionId) => {
      if (onOpenSession) onOpenSession(sessionId)
    },
    [onOpenSession],
  )

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left: run list */}
      <div className="w-56 shrink-0 border-r border-gray-800 flex flex-col overflow-hidden">
        <div className="h-10 shrink-0 px-3 border-b border-gray-800 flex items-center">
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
            Fleet Runs
          </span>
          <button
            type="button"
            onClick={() => setShowLaunch(true)}
            className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-[11px] text-indigo-300 hover:text-indigo-200 hover:bg-indigo-900/30 transition-colors"
            title="New Fleet Run"
          >
            <Plus size={12} /> New
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {runs.length === 0 ? (
            <div className="text-[11px] text-gray-600 italic px-2 py-4 text-center">
              No fleet runs yet. Launch one to fan a goal across worktrees.
            </div>
          ) : (
            runs.map((run) => {
              const meta = RUN_STATUS[run.status] || RUN_STATUS.running
              return (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => setSelectedId(run.id)}
                  className={[
                    'w-full text-left rounded px-2 py-2 transition-colors min-w-0',
                    selectedId === run.id
                      ? 'bg-indigo-900/30 border border-indigo-700'
                      : 'border border-transparent hover:bg-gray-800/60',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
                    <span className="text-xs text-gray-200 truncate flex-1 min-w-0">
                      {run.goal}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-gray-600">
                    <span>{run.status}</span>
                    <span>
                      {run.settledCount}/{run.childCount}
                    </span>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Right: selected run detail */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {selectedId ? (
          <RunDetail runId={selectedId} version={fleetVersion} onOpenSession={onOpen} />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3 p-6">
            <Layers size={28} className="text-gray-700" />
            <p className="text-sm text-gray-500 max-w-sm">
              Fleet fans a single goal across multiple child agents, each in its own git
              worktree/branch, then synthesizes the results.
            </p>
            <button
              type="button"
              onClick={() => setShowLaunch(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors"
            >
              <Plus size={14} /> New Fleet Run
            </button>
          </div>
        )}
      </div>

      <LaunchDrawer
        open={showLaunch}
        onClose={() => setShowLaunch(false)}
        onLaunched={handleLaunched}
        onSaveTemplate={handleSaveTemplate}
        workflows={workflows}
        roots={roots}
        templates={templates}
      />
    </div>
  )
}
