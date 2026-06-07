import { useState } from 'react'
import { Plus, X, ChevronUp, ChevronDown, Pencil, Check, AlertTriangle, Play } from 'lucide-react'

const AGENT_TYPES = [
  'general-purpose',
  'Explore',
  'Plan',
  'team:full-stack-developer',
  'team:shipper',
]

const STEP_BADGE = {
  skill: 'bg-cyan-900/40 text-cyan-300',
  agent: 'bg-purple-900/40 text-purple-300',
  instruction: 'bg-yellow-900/40 text-yellow-300',
  command: 'bg-gray-800 text-gray-400 font-mono',
}

function stepSummary(step) {
  if (step.type === 'skill') return `/${step.skillName || '?'}`
  if (step.type === 'agent')
    return `${step.agentType || '?'}: ${(step.prompt || '').slice(0, 40)}${(step.prompt || '').length > 40 ? '…' : ''}`
  if (step.type === 'instruction')
    return (step.text || '').slice(0, 50) + ((step.text || '').length > 50 ? '…' : '')
  if (step.type === 'command') return step.command || ''
  return step.type
}

function StepEditor({ step, skills, onSave, onClose }) {
  const [local, setLocal] = useState({ ...step })
  const userSkills = skills?.userSkills || []

  const set = (k, v) => setLocal((prev) => ({ ...prev, [k]: v }))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-lg p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-semibold text-gray-200 capitalize">{local.type} Step</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={14} />
          </button>
        </div>

        {local.type === 'skill' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Skill</label>
              <select
                value={local.skillName || ''}
                onChange={(e) => set('skillName', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
              >
                <option value="">— select skill —</option>
                {userSkills.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                    {s.description ? ` — ${s.description}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Note (optional)</label>
              <textarea
                value={local.note || ''}
                onChange={(e) => set('note', e.target.value)}
                rows={3}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-gray-500 resize-none"
              />
            </div>
          </div>
        )}

        {local.type === 'agent' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Agent type</label>
              <select
                value={local.agentType || ''}
                onChange={(e) => set('agentType', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
              >
                <option value="">— select type —</option>
                {AGENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Prompt</label>
              <textarea
                value={local.prompt || ''}
                onChange={(e) => set('prompt', e.target.value)}
                rows={4}
                placeholder="Describe what the agent should do…"
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-gray-500 resize-none"
              />
            </div>
          </div>
        )}

        {local.type === 'instruction' && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Instruction text</label>
            <textarea
              value={local.text || ''}
              onChange={(e) => set('text', e.target.value)}
              rows={5}
              placeholder="Plain instruction for Claude to follow…"
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-gray-500 resize-none"
            />
          </div>
        )}

        {local.type === 'command' && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Shell command</label>
            <input
              type="text"
              value={local.command || ''}
              onChange={(e) => set('command', e.target.value)}
              placeholder="npm run build"
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-300 font-mono focus:outline-none focus:border-gray-500"
            />
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(local)}
            className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors flex items-center gap-1"
          >
            <Check size={12} /> Save
          </button>
        </div>
      </div>
    </div>
  )
}

export function WorkflowsPanel({ workflows, loading, refetch, skills }) {
  const [selectedName, setSelectedName] = useState(null)
  const [draft, setDraft] = useState(null)
  const [isNew, setIsNew] = useState(false)
  const [editingStep, setEditingStep] = useState(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportConflict, setExportConflict] = useState(false)
  const [exportSuccess, setExportSuccess] = useState(false)
  const [running, setRunning] = useState(false)
  const [runStarted, setRunStarted] = useState(false)
  const [error, setError] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  const list = workflows || []

  function selectWorkflow(wf) {
    setSelectedName(wf.name)
    setDraft(JSON.parse(JSON.stringify(wf)))
    setIsNew(false)
    setExportConflict(false)
    setExportSuccess(false)
    setRunStarted(false)
    setError(null)
  }

  function newWorkflow() {
    const now = Date.now()
    setDraft({ name: '', description: '', steps: [], createdAt: now, updatedAt: now })
    setSelectedName(null)
    setIsNew(true)
    setExportConflict(false)
    setExportSuccess(false)
    setRunStarted(false)
    setError(null)
  }

  function setField(k, v) {
    setDraft((prev) => ({ ...prev, [k]: v }))
  }

  function addStep(type) {
    const base = { id: Date.now().toString(), type }
    const defaults = {
      skill: { skillName: '', note: '' },
      agent: { agentType: 'general-purpose', prompt: '' },
      instruction: { text: '' },
      command: { command: '' },
    }
    const step = { ...base, ...(defaults[type] || {}) }
    setDraft((prev) => ({ ...prev, steps: [...prev.steps, step] }))
    setAddMenuOpen(false)
    setEditingStep({ step, index: draft.steps.length })
  }

  function updateStep(index, updated) {
    setDraft((prev) => {
      const steps = [...prev.steps]
      steps[index] = updated
      return { ...prev, steps }
    })
    setEditingStep(null)
  }

  function removeStep(index) {
    setDraft((prev) => {
      const steps = prev.steps.filter((_, i) => i !== index)
      return { ...prev, steps }
    })
  }

  function moveStep(index, dir) {
    const newIndex = index + dir
    if (newIndex < 0 || newIndex >= draft.steps.length) return
    setDraft((prev) => {
      const steps = [...prev.steps]
      ;[steps[index], steps[newIndex]] = [steps[newIndex], steps[index]]
      return { ...prev, steps }
    })
  }

  async function save() {
    if (!draft) return
    setError(null)
    setSaving(true)
    try {
      if (isNew) {
        const res = await fetch('/api/workflows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draft),
        })
        if (res.status === 409) {
          setError('A workflow with that name already exists.')
          return
        }
        if (!res.ok) {
          setError('Failed to create workflow.')
          return
        }
        const created = await res.json()
        setSelectedName(created.name)
        setIsNew(false)
      } else {
        const res = await fetch(`/api/workflows/${selectedName}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draft),
        })
        if (!res.ok) {
          setError('Failed to save workflow.')
          return
        }
      }
      await refetch()
    } catch {
      setError('Network error.')
    } finally {
      setSaving(false)
    }
  }

  async function doExport(overwrite = false) {
    if (!draft?.name) return
    setError(null)
    setExporting(true)
    try {
      const name = isNew ? draft.name : selectedName
      const res = await fetch(`/api/workflows/${name}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(overwrite ? { overwrite: true } : {}),
      })
      if (res.status === 409) {
        setExportConflict(true)
        return
      }
      if (!res.ok) {
        setError('Export failed.')
        return
      }
      setExportConflict(false)
      setExportSuccess(true)
    } catch {
      setError('Network error.')
    } finally {
      setExporting(false)
    }
  }

  async function run() {
    if (!selectedName || isNew) return
    setError(null)
    setRunStarted(false)
    setRunning(true)
    try {
      const res = await fetch(`/api/workflows/${selectedName}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (res.status === 409) {
        setError('This workflow is already running.')
        return
      }
      if (!res.ok) {
        setError('Failed to start workflow.')
        return
      }
      // 202 { ok, status:'started', sessionId? } — the new session surfaces in
      // the Agents tab via the SSE session_update path; the panel only reflects
      // that the run was started.
      setRunStarted(true)
    } catch {
      setError('Network error.')
    } finally {
      setRunning(false)
    }
  }

  async function deleteWorkflow(name) {
    try {
      await fetch(`/api/workflows/${name}`, { method: 'DELETE' })
      if (selectedName === name) {
        setSelectedName(null)
        setDraft(null)
        setIsNew(false)
      }
      await refetch()
    } catch {
      setError('Failed to delete workflow.')
    } finally {
      setDeleteConfirm(null)
    }
  }

  const exportName = draft?.name || selectedName || ''

  return (
    <div className="flex flex-1 overflow-hidden h-full">
      {/* Left panel */}
      <div className="w-48 shrink-0 border-r border-gray-800 flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
            Workflows
          </span>
          <span className="text-xs text-gray-700">{list.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="px-3 py-4 text-xs text-gray-600">Loading…</div>}
          {!loading && list.length === 0 && (
            <div className="px-3 py-4 text-xs text-gray-600">No workflows yet.</div>
          )}
          {list.map((wf) => (
            <div
              key={wf.name}
              className={`group flex items-center justify-between px-3 py-2 cursor-pointer border-b border-gray-800/50 hover:bg-gray-800/40 transition-colors ${selectedName === wf.name && !isNew ? 'bg-gray-800/60' : ''}`}
              onClick={() => selectWorkflow(wf)}
            >
              <div className="min-w-0">
                <div className="text-xs text-gray-300 truncate">{wf.name}</div>
                <div className="text-xs text-gray-600">
                  {wf.steps?.length || 0} step{wf.steps?.length !== 1 ? 's' : ''}
                </div>
              </div>
              <button
                className="ml-1 text-gray-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                onClick={(e) => {
                  e.stopPropagation()
                  setDeleteConfirm(wf.name)
                }}
                title="Delete workflow"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className="p-2 border-t border-gray-800">
          <button
            onClick={newWorkflow}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded transition-colors"
          >
            <Plus size={12} /> New
          </button>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        {!draft ? (
          <div className="flex-1 flex items-center justify-center text-xs text-gray-600">
            Select a workflow or create a new one.
          </div>
        ) : (
          <div className="p-4 flex flex-col gap-4 min-h-full">
            {/* Name + description */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500 w-16 shrink-0">Name</label>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => setField('name', e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                  placeholder="my-workflow"
                  disabled={!isNew}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500 w-16 shrink-0">Description</label>
                <input
                  type="text"
                  value={draft.description || ''}
                  onChange={(e) => setField('description', e.target.value)}
                  placeholder="What this workflow does…"
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
                />
              </div>
            </div>

            {/* Steps list */}
            <div className="flex flex-col gap-1.5">
              {draft.steps.length === 0 && (
                <div className="text-xs text-gray-600 py-2">No steps yet. Add one below.</div>
              )}
              {draft.steps.map((step, i) => (
                <div
                  key={step.id}
                  className="flex items-center gap-2 bg-gray-800/50 border border-gray-800 rounded px-3 py-2 group"
                >
                  <span className="text-xs text-gray-600 w-5 shrink-0">{i + 1}</span>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${STEP_BADGE[step.type] || 'bg-gray-800 text-gray-400'}`}
                  >
                    {step.type}
                  </span>
                  <span className="text-xs text-gray-300 truncate flex-1">{stepSummary(step)}</span>
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => moveStep(i, -1)}
                      disabled={i === 0}
                      className="text-gray-600 hover:text-gray-300 disabled:opacity-30 transition-colors"
                    >
                      <ChevronUp size={12} />
                    </button>
                    <button
                      onClick={() => moveStep(i, 1)}
                      disabled={i === draft.steps.length - 1}
                      className="text-gray-600 hover:text-gray-300 disabled:opacity-30 transition-colors"
                    >
                      <ChevronDown size={12} />
                    </button>
                    <button
                      onClick={() => setEditingStep({ step, index: i })}
                      className="text-gray-600 hover:text-gray-300 transition-colors"
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      onClick={() => removeStep(i)}
                      className="text-gray-600 hover:text-red-400 transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add step */}
            <div className="relative">
              <button
                onClick={() => setAddMenuOpen((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800 rounded border border-gray-800 border-dashed transition-colors"
              >
                <Plus size={12} /> Add Step
              </button>
              {addMenuOpen && (
                <div className="absolute top-full mt-1 left-0 bg-gray-900 border border-gray-700 rounded shadow-xl z-10 py-1 w-40">
                  {['skill', 'agent', 'instruction', 'command'].map((type) => (
                    <button
                      key={type}
                      onClick={() => addStep(type)}
                      className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 capitalize transition-colors"
                    >
                      {type}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-gray-800 pt-3 mt-auto">
              {error && (
                <div className="flex items-center gap-1.5 text-xs text-red-400 mb-3">
                  <AlertTriangle size={12} /> {error}
                </div>
              )}
              {exportSuccess && !exportConflict && (
                <div className="text-xs text-green-400 mb-3">
                  Exported as <code className="bg-gray-800 px-1 rounded">/{exportName}</code>
                </div>
              )}
              {runStarted && (
                <div className="text-xs text-green-400 mb-3">
                  Run started — track it in the Agents tab.
                </div>
              )}
              {exportConflict && (
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs text-yellow-400">
                    Skill <code className="bg-gray-800 px-1 rounded">/{exportName}</code> already
                    exists.
                  </span>
                  <button
                    onClick={() => doExport(true)}
                    className="text-xs bg-yellow-700 hover:bg-yellow-600 text-white px-2 py-0.5 rounded transition-colors"
                  >
                    Overwrite
                  </button>
                  <button
                    onClick={() => setExportConflict(false)}
                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={save}
                  disabled={saving || !draft.name}
                  className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded transition-colors"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={run}
                  disabled={running || isNew || !selectedName}
                  className="px-3 py-1.5 text-xs bg-green-700 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded transition-colors flex items-center gap-1"
                  title={isNew ? 'Save first before running' : undefined}
                >
                  <Play size={12} /> {running ? 'Starting…' : 'Run'}
                </button>
                <button
                  onClick={() => doExport(false)}
                  disabled={exporting || !exportName || isNew}
                  className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-gray-200 rounded transition-colors"
                  title={isNew ? 'Save first before exporting' : undefined}
                >
                  {exporting ? 'Exporting…' : `Export as Skill /${exportName || '…'}`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Step editor modal */}
      {editingStep && (
        <StepEditor
          step={editingStep.step}
          skills={skills}
          onSave={(updated) => updateStep(editingStep.index, updated)}
          onClose={() => setEditingStep(null)}
        />
      )}

      {/* Delete confirm overlay */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            className="bg-gray-900 border border-gray-700 rounded-lg p-5 shadow-xl max-w-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-gray-200 mb-1">
              Delete <span className="font-semibold">{deleteConfirm}</span>?
            </p>
            <p className="text-xs text-gray-500 mb-4">This cannot be undone.</p>
            <div className="flex gap-2">
              <button
                onClick={() => deleteWorkflow(deleteConfirm)}
                className="px-3 py-1.5 text-xs bg-red-700 hover:bg-red-600 text-white rounded transition-colors"
              >
                Delete
              </button>
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
