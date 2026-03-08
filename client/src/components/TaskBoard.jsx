import { useState } from 'react'
import { CheckCircle2, Circle, Loader2, Trash2, ChevronDown } from 'lucide-react'

const STATUS_CONFIG = {
  completed: { icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-900/20', border: 'border-gray-800/50' },
  in_progress: { icon: Loader2, color: 'text-yellow-400', bg: 'bg-yellow-900/20', border: 'border-yellow-800/40', glow: 'shadow-[0_0_6px_rgba(234,179,8,0.2)]' },
  pending: { icon: Circle, color: 'text-gray-500', bg: 'bg-gray-900/40', border: 'border-gray-800/50' },
  deleted: { icon: Trash2, color: 'text-red-700', bg: 'bg-red-900/10', border: 'border-gray-800/50' },
}

function TaskItem({ task }) {
  const [expanded, setExpanded] = useState(false)
  const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending
  const Icon = cfg.icon

  return (
    <div className={`p-3 rounded-lg ${cfg.bg} border ${cfg.border} ${cfg.glow || ''} space-y-1.5`}>
      {/* Header row */}
      <div className="flex items-start gap-2">
        <Icon size={14} className={`mt-0.5 shrink-0 ${cfg.color} ${task.status === 'in_progress' ? 'animate-spin' : ''}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-gray-300">{task.subject}</span>
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
      </div>

      {/* blockedBy tags */}
      {task.blockedBy?.length > 0 && (
        <div className="flex flex-wrap gap-1 ml-5">
          {task.blockedBy.map((dep, i) => (
            <span key={i} className="px-1 py-0.5 rounded bg-gray-800/80 text-gray-600 text-[10px] font-mono">
              blocked: {dep}
            </span>
          ))}
        </div>
      )}

      {/* Description (expandable) */}
      {task.description && (
        <div className="ml-5">
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1 text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
          >
            <ChevronDown size={10} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
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

export function TaskBoard({ tasks, loading }) {
  if (loading) return <div className="p-4 text-gray-600 text-xs">Loading tasks...</div>
  if (!tasks || tasks.length === 0) return (
    <div className="p-4 text-gray-700 text-xs">No tasks for this session</div>
  )

  const groups = {
    in_progress: tasks.filter(t => t.status === 'in_progress'),
    pending: tasks.filter(t => t.status === 'pending'),
    completed: tasks.filter(t => t.status === 'completed'),
  }

  return (
    <div className="p-3 overflow-y-auto h-full space-y-4">
      {groups.in_progress.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-yellow-500 mb-2 uppercase tracking-wider">
            Active ({groups.in_progress.length})
          </h3>
          <div className="space-y-2">
            {groups.in_progress.map(t => <TaskItem key={t.id} task={t} />)}
          </div>
        </section>
      )}
      {groups.pending.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">
            Pending ({groups.pending.length})
          </h3>
          <div className="space-y-2">
            {groups.pending.map(t => <TaskItem key={t.id} task={t} />)}
          </div>
        </section>
      )}
      {groups.completed.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-green-600 mb-2 uppercase tracking-wider">
            Done ({groups.completed.length})
          </h3>
          <div className="space-y-2">
            {groups.completed.map(t => <TaskItem key={t.id} task={t} />)}
          </div>
        </section>
      )}
    </div>
  )
}
