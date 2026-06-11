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
  const goalRef = useRef(null)
  const workflowList = useMemo(() => (Array.isArray(workflows) ? workflows : []), [workflows])
  const templateList = useMemo(() => (Array.isArray(templates) ? templates : []), [templates])
  const rootList = useMemo(() => (Array.isArray(roots) ? roots : []), [roots])

  useEffect(() => {
    if (!open) return
    setError(null)
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
      setError('Pick a project for at least one child.')
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

  // Picker options for one child: every fleet-ready root, plus the child's
  // current value when it is not in the list (a template may reference a
  // project that is no longer registered — keep it visible rather than
  // silently clearing it; the server still validates at launch).
  const optionsFor = useCallback(
    (cwd) => (cwd && !rootList.includes(cwd) ? [cwd, ...rootList] : rootList),
    [rootList],
  )

  if (!open) return null

  return (
    <Dialog
      onClose={onClose}
      placement="bottom"
      dismissible={!submitting}
      label="New fleet run"
      initialFocusRef={goalRef}
      backdropClassName="bg-black/40 backdrop-blur-sm"
      className="w-[min(92vw,960px)] h-[min(78vh,700px)] bg-gray-950 border border-b-0 border-gray-800 rounded-t-xl shadow-2xl"
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
            <p className="text-[11px] text-gray-500">
              Each child runs in its own isolated git worktree inside a fleet-ready project — a git
              repo with harness rails installed.
            </p>

            {rootList.length === 0 && (
              <div
                data-testid="fleet-no-roots"
                className="rounded-lg border border-amber-700/40 bg-amber-950/30 p-3 text-[11px] text-amber-200/90 space-y-1.5"
              >
                <div className="flex items-center gap-1.5 font-semibold text-amber-300">
                  <AlertTriangle size={12} /> No fleet-ready projects yet
                </div>
                <p>A project qualifies once it meets all three requirements:</p>
                <ul className="list-disc pl-4 space-y-0.5 text-amber-200/80">
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
                className="rounded-lg border border-gray-800 bg-gray-900/50 p-2.5 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-gray-600 shrink-0">#{idx}</span>
                  <select
                    value={child.cwd}
                    onChange={(e) => updateChild(idx, { cwd: e.target.value })}
                    aria-label={`child ${idx} working directory`}
                    className="flex-1 min-w-0 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-indigo-500 font-mono"
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
    </Dialog>
  )
}
