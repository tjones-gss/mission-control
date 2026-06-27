import { useState } from 'react'
import { CheckCircle2, Circle, Loader2, Trash2, ChevronDown } from 'lucide-react'
import { ErrorState } from './ui/States.jsx'

const STATUS_CONFIG = {
  completed: {
    icon: CheckCircle2,
    color: 'text-green-400',
    bg: 'bg-green-900/20',
    border: 'border-gray-800/50',
  },
  in_progress: {
    icon: Loader2,
    color: 'text-yellow-400',
    bg: 'bg-yellow-900/20',
    border: 'border-yellow-800/40',
    glow: 'shadow-[0_0_6px_rgba(234,179,8,0.2)]',
  },
  pending: {
    icon: Circle,
    color: 'text-gray-500',
    bg: 'bg-gray-900/40',
    border: 'border-gray-800/50',
  },
  deleted: {
    icon: Trash2,
    color: 'text-red-700',
    bg: 'bg-red-900/10',
    border: 'border-gray-800/50',
  },
}

const BTN = 'text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 hover:text-gray-200'
const BTN_DANGER = 'text-[10px] px-1.5 py-0.5 rounded bg-red-900/40 text-red-400 hover:text-red-200'

const EMPTY_FORM = { subject: '', status: 'pending', owner: '', description: '' }

function TaskForm({ initial = EMPTY_FORM, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <div className="space-y-2 p-2 rounded-lg bg-gray-900/60 border border-gray-700/50">
      <input
        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
        placeholder="Subject (required)"
        value={form.subject}
        onChange={(e) => set('subject', e.target.value)}
      />
      <div className="flex gap-2">
        <select
          className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-gray-500"
          value={form.status}
          onChange={(e) => set('status', e.target.value)}
        >
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
        </select>
        <input
          className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
          placeholder="Owner (optional)"
          value={form.owner}
          onChange={(e) => set('owner', e.target.value)}
        />
      </div>
      <textarea
        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500 resize-none"
        placeholder="Description (optional)"
        rows={2}
        value={form.description}
        onChange={(e) => set('description', e.target.value)}
      />
      <div className="flex gap-1.5">
        <button
          className={BTN + ' hover:bg-gray-700'}
          disabled={saving || !form.subject.trim()}
          onClick={() => onSave(form)}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button className={BTN} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function TaskItem({ task, sessionId, refetch }) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending
  const Icon = cfg.icon

  async function handleSave(form) {
    setSaving(true)
    try {
      await fetch(`/api/tasks/${sessionId}/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      setEditing(false)
      refetch()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    await fetch(`/api/tasks/${sessionId}/${task.id}`, { method: 'DELETE' })
    refetch()
  }

  if (editing) {
    return (
      <TaskForm
        initial={{
          subject: task.subject,
          status: task.status,
          owner: task.owner || '',
          description: task.description || '',
        }}
        onSave={handleSave}
        onCancel={() => setEditing(false)}
        saving={saving}
      />
    )
  }

  return (
    <div className={`p-3 rounded-lg ${cfg.bg} border ${cfg.border} ${cfg.glow || ''} space-y-1.5`}>
      {/* Header row */}
      <div className="flex items-start gap-2">
        <Icon
          size={14}
          className={`mt-0.5 shrink-0 ${cfg.color} ${task.status === 'in_progress' ? 'animate-spin' : ''}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-gray-300 flex-1 min-w-0">{task.subject}</span>
            {task.owner && (
              <span className="px-1.5 py-0.5 rounded-full bg-gray-800 text-gray-500 text-[10px] font-mono shrink-0">
                {task.owner}
              </span>
            )}
          </div>
          {/* activeForm — live status for in_progress tasks */}
          {task.status === 'in_progress' && task.activeForm && (
            <div className="mt-1 text-xs text-cyan-400/80 italic">{task.activeForm}</div>
          )}
        </div>
        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <button className={BTN} onClick={() => setEditing(true)}>
            Edit
          </button>
          {confirmDelete ? (
            <>
              <button className={BTN_DANGER} onClick={handleDelete}>
                Confirm
              </button>
              <button className={BTN} onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className={BTN} onClick={() => setConfirmDelete(true)}>
              ✕
            </button>
          )}
        </div>
      </div>

      {/* blockedBy tags */}
      {task.blockedBy?.length > 0 && (
        <div className="flex flex-wrap gap-1 ml-5">
          {task.blockedBy.map((dep, i) => (
            <span
              key={i}
              className="px-1 py-0.5 rounded bg-gray-800/80 text-gray-600 text-[10px] font-mono"
            >
              blocked: {dep}
            </span>
          ))}
        </div>
      )}

      {/* Description (expandable) */}
      {task.description && (
        <div className="ml-5">
          <button
            onClick={() => setExpanded((e) => !e)}
            className="flex items-center gap-1 text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
          >
            <ChevronDown
              size={10}
              className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
            />
            {expanded ? 'hide' : 'details'}
          </button>
          {expanded && (
            <div className="mt-1 text-xs text-gray-600 leading-relaxed">{task.description}</div>
          )}
        </div>
      )}
    </div>
  )
}

export function TaskBoard({ tasks, loading, error, sessionId, refetch }) {
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)

  async function handleCreate(form) {
    setCreating(true)
    try {
      await fetch(`/api/tasks/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      setShowCreate(false)
      refetch()
    } finally {
      setCreating(false)
    }
  }

  if (loading) return <div className="p-4 text-gray-600 text-xs">Loading tasks...</div>
  if (error) return <ErrorState message={error} onRetry={refetch} />

  const groups = {
    in_progress: (tasks || []).filter((t) => t.status === 'in_progress'),
    pending: (tasks || []).filter((t) => t.status === 'pending'),
    completed: (tasks || []).filter((t) => t.status === 'completed'),
  }

  const isEmpty = !tasks || tasks.length === 0

  return (
    <div className="p-3 overflow-y-auto h-full space-y-4">
      {/* Board header with create button */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-600 uppercase tracking-wider font-semibold">
          Tasks
        </span>
        {sessionId && !showCreate && (
          <button className={BTN + ' hover:bg-gray-700'} onClick={() => setShowCreate(true)}>
            + New Task
          </button>
        )}
      </div>

      {/* Inline create form */}
      {showCreate && (
        <TaskForm onSave={handleCreate} onCancel={() => setShowCreate(false)} saving={creating} />
      )}

      {isEmpty && !showCreate && (
        <div className="text-gray-700 text-xs">No tasks for this session</div>
      )}

      {groups.in_progress.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-yellow-500 mb-2 uppercase tracking-wider">
            In Progress ({groups.in_progress.length})
          </h3>
          <div className="space-y-2">
            {groups.in_progress.map((t) => (
              <TaskItem key={t.id} task={t} sessionId={sessionId} refetch={refetch} />
            ))}
          </div>
        </section>
      )}
      {groups.pending.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">
            Pending ({groups.pending.length})
          </h3>
          <div className="space-y-2">
            {groups.pending.map((t) => (
              <TaskItem key={t.id} task={t} sessionId={sessionId} refetch={refetch} />
            ))}
          </div>
        </section>
      )}
      {groups.completed.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-green-600 mb-2 uppercase tracking-wider">
            Completed ({groups.completed.length})
          </h3>
          <div className="space-y-2">
            {groups.completed.map((t) => (
              <TaskItem key={t.id} task={t} sessionId={sessionId} refetch={refetch} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
