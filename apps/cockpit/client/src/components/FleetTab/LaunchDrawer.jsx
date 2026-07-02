import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Layers,
  Plus,
  X,
  Send,
  Loader2,
  AlertTriangle,
  Trash2,
  Lock,
  ShieldCheck,
  Save,
  DollarSign,
} from 'lucide-react'
import { Dialog } from '../ui/Dialog.jsx'

// Launch drawer — extracted from FleetTab.jsx (split-before-touch). A goal
// textarea over a repeatable child-row editor (cwd picker + a prompt OR a
// workflow select). Submit POSTs to /api/fleet and closes on success.
//
// The cwd field is a PICKER over fleet-ready projects (the server's known
// harness roots), not free text. The server refuses any cwd that is not a
// known harness root + git repo, so offering free text only manufactured
// "child N cwd is not a known root" launch failures.

// Last path segment of a cwd (handles both / and \ separators).
function basename(cwd) {
  if (!cwd) return ''
  const parts = String(cwd).split(/[\\/]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : cwd
}

function emptyChild() {
  return { cwd: '', prompt: '', workflow: '', quarantine: false }
}

const NO_FIELD_ERRORS = { goal: false, children: {} }

// A confirmation is required for the larger / costlier runs: 3+ agents OR a
// configured budget above $1. Keeps the one-tap path for the common small run.
const CONFIRM_CHILD_THRESHOLD = 3
const CONFIRM_BUDGET_THRESHOLD = 1

// Rough per-child cost band for the pre-launch estimate. Deliberately coarse —
// the point is to set expectations ("this is cents, not dollars"), not to be
// exact. Adversarial verification roughly adds another worker's worth of cost.
const EST_PER_CHILD_LOW = 0.05
const EST_PER_CHILD_HIGH = 0.35

function estimateCostRange(childCount, verify) {
  if (childCount <= 0) return null
  let low = childCount * EST_PER_CHILD_LOW
  let high = childCount * EST_PER_CHILD_HIGH
  if (verify) {
    low *= 1.4
    high *= 1.7
  }
  return { low, high }
}

function formatRange(range) {
  if (!range) return '—'
  return `~$${range.low.toFixed(2)}–$${range.high.toFixed(2)}`
}

export function LaunchDrawer({
  open,
  onClose,
  onLaunched,
  onSaveTemplate,
  workflows,
  roots,
  templates,
}) {
  const [goal, setGoal] = useState('')
  const [children, setChildren] = useState(() => [emptyChild()])
  const [budget, setBudget] = useState('')
  const [verify, setVerify] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  // Per-field validation highlighting (empty goal / child cwd / child body).
  const [fieldErrors, setFieldErrors] = useState(NO_FIELD_ERRORS)
  // When a launch needs confirmation, the built body is parked here and a
  // confirmation summary replaces the footer until the user confirms or backs out.
  const [pendingConfirm, setPendingConfirm] = useState(null)
  const goalRef = useRef(null)
  const workflowList = useMemo(() => (Array.isArray(workflows) ? workflows : []), [workflows])
  const templateList = useMemo(() => (Array.isArray(templates) ? templates : []), [templates])
  const rootList = useMemo(() => (Array.isArray(roots) ? roots : []), [roots])

  useEffect(() => {
    if (!open) return
    setError(null)
    setFieldErrors(NO_FIELD_ERRORS)
    setPendingConfirm(null)
  }, [open])

  // Any edit to the form invalidates a parked confirmation and clears stale
  // validation highlights — the user is actively fixing things.
  useEffect(() => {
    setPendingConfirm(null)
    setFieldErrors(NO_FIELD_ERRORS)
    setError(null)
  }, [goal, children, budget, verify])

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
  // null and sets inline field errors + a summary message when the form is
  // invalid. Only a prompt OR a workflow is sent per child; quarantine rides
  // along only when checked.
  const buildBody = useCallback(() => {
    const errors = { goal: false, children: {} }
    let message = null
    if (!goal.trim()) {
      errors.goal = true
      message = 'A goal is required.'
    }
    const withCwd = children.filter((c) => c.cwd.trim())
    if (withCwd.length === 0) {
      // None picked: highlight every child's project picker.
      children.forEach((_, idx) => {
        errors.children[idx] = { cwd: true }
      })
      message = message || 'Pick a project for at least one child.'
    }
    const payload = []
    children.forEach((c, idx) => {
      if (!c.cwd.trim()) return
      const base = { cwd: c.cwd.trim() }
      if (c.workflow.trim()) base.workflow = c.workflow.trim()
      else if (c.prompt.trim()) base.prompt = c.prompt.trim()
      else {
        errors.children[idx] = { ...(errors.children[idx] || {}), body: true }
        message = message || 'Each child needs a prompt or a workflow.'
      }
      if (c.quarantine) base.quarantine = true
      payload.push(base)
    })
    // policy.budgetUsd from the budget field (when a positive number) and
    // policy.verify from the toggle — both omitted when off so behaviour is
    // unchanged for runs that do not opt in.
    const policy = {}
    const budgetNum = Number(budget)
    if (budget.trim() && Number.isFinite(budgetNum) && budgetNum > 0) {
      policy.budgetUsd = budgetNum
    }
    if (verify) policy.verify = true
    if (message) {
      setFieldErrors(errors)
      setError(message)
      return null
    }
    setFieldErrors(NO_FIELD_ERRORS)
    setError(null)
    return { goal: goal.trim(), children: payload, policy }
  }, [goal, children, budget, verify])

  // POST a validated body to /api/fleet. Separated from submit() so the
  // confirmation step can launch a previously-built body directly.
  const doLaunch = useCallback(
    async (body) => {
      if (submitting) return
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
        setPendingConfirm(null)
        onClose()
      } catch (e) {
        setError(e.message || 'Could not launch fleet.')
      } finally {
        setSubmitting(false)
      }
    },
    [submitting, onLaunched, onClose],
  )

  // Validate, then either launch directly or park for confirmation when the run
  // is large (3+ agents) or has a budget over $1.
  const submit = useCallback(() => {
    if (submitting) return
    const body = buildBody()
    if (!body) return
    const needsConfirm =
      body.children.length >= CONFIRM_CHILD_THRESHOLD ||
      (body.policy.budgetUsd ?? 0) > CONFIRM_BUDGET_THRESHOLD
    if (needsConfirm) {
      setPendingConfirm(body)
      return
    }
    doLaunch(body)
  }, [submitting, buildBody, doLaunch])

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

  // Picker options for one child: every fleet-ready root, plus the child's
  // current value when it is not in the list (a template may reference a
  // project that is no longer registered — keep it visible rather than
  // silently clearing it; the server still validates at launch).
  const optionsFor = useCallback(
    (cwd) => (cwd && !rootList.includes(cwd) ? [cwd, ...rootList] : rootList),
    [rootList],
  )

  // Pre-launch cost estimate — based on the children that have a project picked
  // (falling back to the row count) and whether verification is on.
  const estChildCount = children.filter((c) => c.cwd.trim()).length || children.length
  const estimate = estimateCostRange(estChildCount, verify)

  if (!open) return null

  return (
    <Dialog
      onClose={onClose}
      placement="bottom"
      dismissible={!submitting}
      label="New fleet run"
      initialFocusRef={goalRef}
      backdropClassName="bg-[var(--mc-bg)] opacity-70 backdrop-blur-sm"
      className="w-[min(92vw,960px)] h-[min(78vh,700px)] bg-[var(--mc-bg)] border border-b-0 border-[var(--mc-border)] rounded-t-lg shadow-2xl"
    >
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--mc-border)]">
        <Layers size={16} className="text-[var(--mc-accent-2)]" />
        <span className="text-sm font-semibold text-[var(--mc-fg)]">New Fleet Run</span>
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="ml-auto text-[var(--mc-fg-5)] hover:text-[var(--mc-fg-2)] transition-colors p-1 rounded disabled:opacity-30"
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
                className="block text-[11px] uppercase tracking-wide text-[var(--mc-fg-4)] mb-1"
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
                className="w-full bg-[var(--mc-surface)] border border-[var(--mc-border-2)] rounded px-2 py-1.5 text-xs text-[var(--mc-fg-2)] focus:outline-none focus:border-[var(--mc-accent)]"
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
            <label className="block text-[11px] uppercase tracking-wide text-[var(--mc-fg-4)] mb-1">
              Goal
            </label>
            <textarea
              ref={goalRef}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={2}
              aria-invalid={fieldErrors.goal || undefined}
              placeholder="What should the fleet accomplish? (e.g. Add OAuth across all services)"
              className={`w-full bg-[var(--mc-surface)] border rounded px-3 py-2 text-sm text-[var(--mc-fg)] placeholder:text-[var(--mc-fg-5)] focus:outline-none resize-none ${
                fieldErrors.goal
                  ? 'border-[var(--mc-danger)] focus:border-[var(--mc-danger)]'
                  : 'border-[var(--mc-border-2)] focus:border-[var(--mc-accent)]'
              }`}
            />
          </div>

          {/* Run policy — budget cap + adversarial verification. Both opt-in;
                omitted from the request when off so default behaviour is kept. */}
          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <label
                htmlFor="fleet-budget"
                className="block text-[11px] uppercase tracking-wide text-[var(--mc-fg-4)] mb-1"
              >
                Budget (USD)
              </label>
              <div className="flex items-center gap-1.5 bg-[var(--mc-surface)] border border-[var(--mc-border-2)] rounded px-2 py-1.5 focus-within:border-[var(--mc-accent)]">
                <DollarSign size={12} className="text-[var(--mc-fg-5)] shrink-0" />
                <input
                  id="fleet-budget"
                  type="number"
                  min="0"
                  step="0.5"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="no cap"
                  aria-label="budget usd"
                  className="w-24 bg-transparent text-xs text-[var(--mc-fg)] placeholder:text-[var(--mc-fg-5)] focus:outline-none font-mono"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-[var(--mc-fg-2)] cursor-pointer pb-1.5">
              <input
                type="checkbox"
                checked={verify}
                onChange={(e) => setVerify(e.target.checked)}
                aria-label="verify results"
                className="accent-[var(--mc-accent)]"
              />
              <ShieldCheck size={13} className="text-[var(--mc-info)]" />
              Verify results (adversarial review)
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center">
              <span className="text-[11px] uppercase tracking-wide text-[var(--mc-fg-4)]">
                Children
              </span>
              <button
                type="button"
                onClick={addChild}
                className="ml-auto flex items-center gap-1 text-[11px] text-[var(--mc-accent-2)] hover:text-[var(--mc-accent)] transition-colors"
              >
                <Plus size={12} /> Add child
              </button>
            </div>
            <p className="text-[11px] text-[var(--mc-fg-4)]">
              Each child runs in its own isolated git worktree inside a fleet-ready project — a git
              repo with harness rails installed.
            </p>

            {rootList.length === 0 && (
              <div
                data-testid="fleet-no-roots"
                className="rounded-lg border border-[var(--mc-warn)] bg-[var(--mc-warn-soft)] p-3 text-[11px] text-[var(--mc-fg-2)] space-y-1.5"
              >
                <div className="flex items-center gap-1.5 font-semibold text-[var(--mc-warn)]">
                  <AlertTriangle size={12} /> No fleet-ready projects yet
                </div>
                <p>A project qualifies once it meets all three requirements:</p>
                <ul className="list-disc pl-4 space-y-0.5 text-[var(--mc-fg-2)]">
                  <li>
                    it is a <span className="font-mono">git</span> repository (children run in
                    isolated git worktrees)
                  </li>
                  <li>
                    it has harness rails installed (
                    <span className="font-mono">.harness/project-state.yml</span>)
                  </li>
                  <li>you have opened it in Claude Code at least once</li>
                </ul>
                <p>
                  Open the project in Claude Code, then add rails from the Runs tab (mode{' '}
                  <span className="font-mono">existing-repo-retrofit</span>). For ad-hoc parallel
                  work without rails, Claude Code&apos;s native agent teams are a lighter
                  alternative.
                </p>
              </div>
            )}

            {children.map((child, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-[var(--mc-border)] bg-[var(--mc-surface)] p-2.5 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-[var(--mc-fg-5)] shrink-0">
                    #{idx}
                  </span>
                  <select
                    value={child.cwd}
                    onChange={(e) => updateChild(idx, { cwd: e.target.value })}
                    aria-label={`child ${idx} working directory`}
                    aria-invalid={fieldErrors.children[idx]?.cwd || undefined}
                    className={`flex-1 min-w-0 bg-[var(--mc-bg)] border rounded px-2 py-1.5 text-xs text-[var(--mc-fg)] focus:outline-none font-mono ${
                      fieldErrors.children[idx]?.cwd
                        ? 'border-[var(--mc-danger)] focus:border-[var(--mc-danger)]'
                        : 'border-[var(--mc-border-2)] focus:border-[var(--mc-accent)]'
                    }`}
                  >
                    <option value="">— pick a fleet-ready project —</option>
                    {optionsFor(child.cwd).map((r) => (
                      <option key={r} value={r}>
                        {basename(r)} — {r}
                      </option>
                    ))}
                  </select>
                  {children.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeChild(idx)}
                      className="shrink-0 text-[var(--mc-fg-5)] hover:text-[var(--mc-danger)] transition-colors p-1"
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
                    aria-invalid={fieldErrors.children[idx]?.body || undefined}
                    className={`flex-1 min-w-0 bg-[var(--mc-bg)] border rounded px-2 py-1.5 text-xs text-[var(--mc-fg)] placeholder:text-[var(--mc-fg-5)] focus:outline-none resize-none disabled:opacity-40 ${
                      fieldErrors.children[idx]?.body
                        ? 'border-[var(--mc-danger)] focus:border-[var(--mc-danger)]'
                        : 'border-[var(--mc-border-2)] focus:border-[var(--mc-accent)]'
                    }`}
                  />
                  <div className="flex flex-col gap-1 shrink-0 w-40">
                    <span className="text-[10px] text-[var(--mc-fg-5)]">or workflow</span>
                    <select
                      value={child.workflow}
                      onChange={(e) => updateChild(idx, { workflow: e.target.value })}
                      aria-label={`child ${idx} workflow`}
                      className="bg-[var(--mc-bg)] border border-[var(--mc-border-2)] rounded px-2 py-1.5 text-xs text-[var(--mc-fg-2)] focus:outline-none focus:border-[var(--mc-accent)]"
                    >
                      <option value="">— none —</option>
                      {workflowList.map((wf) => (
                        <option key={wf.name} value={wf.name}>
                          {wf.name}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1.5 text-[10px] text-[var(--mc-fg-3)] cursor-pointer mt-0.5">
                      <input
                        type="checkbox"
                        checked={!!child.quarantine}
                        onChange={(e) => updateChild(idx, { quarantine: e.target.checked })}
                        aria-label={`child ${idx} quarantine`}
                        className="accent-[var(--mc-warn)]"
                      />
                      <Lock size={10} className="text-[var(--mc-warn)]" />
                      quarantine (read-only)
                    </label>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {pendingConfirm ? (
          <div
            data-testid="fleet-launch-confirm"
            className="border-t border-[var(--mc-border)] px-4 py-3 bg-[var(--mc-warn-soft)] flex flex-col gap-2.5"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[var(--mc-warn)]" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--mc-fg)]">
                  Launch {pendingConfirm.children.length} agent
                  {pendingConfirm.children.length === 1 ? '' : 's'}?
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--mc-fg-3)]">
                  {pendingConfirm.children.length} worktree
                  {pendingConfirm.children.length === 1 ? '' : 's'} ·{' '}
                  {typeof pendingConfirm.policy.budgetUsd === 'number'
                    ? `$${pendingConfirm.policy.budgetUsd.toFixed(2)} budget`
                    : 'no budget cap'}
                  {pendingConfirm.policy.verify ? ' · adversarial verify' : ''} · est.{' '}
                  {formatRange(estimate)}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {error && (
                <span className="text-[11px] text-[var(--mc-danger)] flex items-center gap-1.5">
                  <AlertTriangle size={12} /> {error}
                </span>
              )}
              <button
                type="button"
                onClick={() => setPendingConfirm(null)}
                disabled={submitting}
                className="ml-auto px-3 py-2 rounded border border-[var(--mc-border-2)] text-[var(--mc-fg-2)] text-sm font-medium hover:bg-[var(--mc-surface-2)] hover:text-[var(--mc-fg)] disabled:opacity-30 transition-colors shrink-0"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => doLaunch(pendingConfirm)}
                disabled={submitting}
                className="px-4 py-2 rounded bg-[var(--mc-accent)] text-[var(--mc-on-accent)] text-sm font-medium hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 shrink-0"
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {submitting ? 'Launching…' : 'Confirm & launch'}
              </button>
            </div>
          </div>
        ) : (
          <div className="border-t border-[var(--mc-border)] px-4 py-3 bg-[var(--mc-surface)] flex items-center gap-3">
            {error && (
              <span className="text-[11px] text-[var(--mc-danger)] flex items-center gap-1.5">
                <AlertTriangle size={12} /> {error}
              </span>
            )}
            <span
              data-testid="fleet-cost-estimate"
              className="text-[11px] text-[var(--mc-fg-4)] flex items-center gap-1"
              title="Rough pre-launch estimate based on child count and verification"
            >
              <DollarSign size={11} className="text-[var(--mc-fg-5)]" /> Est.{' '}
              {formatRange(estimate)}
            </span>
            <button
              type="button"
              onClick={saveTemplate}
              disabled={submitting}
              className="ml-auto px-3 py-2 rounded border border-[var(--mc-border-2)] text-[var(--mc-fg-2)] text-sm font-medium hover:bg-[var(--mc-surface-2)] hover:text-[var(--mc-fg)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 shrink-0"
            >
              <Save size={14} /> Save as template
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="px-4 py-2 rounded bg-[var(--mc-accent)] text-[var(--mc-on-accent)] text-sm font-medium hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 shrink-0"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {submitting ? 'Launching…' : 'Launch Fleet'}
            </button>
          </div>
        )}
      </div>
    </Dialog>
  )
}
