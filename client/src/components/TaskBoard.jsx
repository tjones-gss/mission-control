import { CheckCircle2, Circle, Loader2, Trash2 } from 'lucide-react'

const STATUS_CONFIG = {
  completed: { icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-900/20' },
  in_progress: { icon: Loader2, color: 'text-yellow-400', bg: 'bg-yellow-900/20' },
  pending: { icon: Circle, color: 'text-gray-500', bg: 'bg-gray-900/40' },
  deleted: { icon: Trash2, color: 'text-red-700', bg: 'bg-red-900/10' },
}

function TaskItem({ task }) {
  const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending
  const Icon = cfg.icon
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg ${cfg.bg} border border-gray-800/50`}>
      <Icon size={15} className={`mt-0.5 shrink-0 ${cfg.color} ${task.status === 'in_progress' ? 'animate-spin' : ''}`} />
      <div>
        <div className="text-xs font-medium text-gray-300">{task.subject}</div>
        {task.description && (
          <div className="text-xs text-gray-600 mt-0.5 line-clamp-2">{task.description}</div>
        )}
      </div>
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
          <h3 className="text-xs font-semibold text-yellow-500 mb-2 uppercase tracking-wider">Active ({groups.in_progress.length})</h3>
          <div className="space-y-2">{groups.in_progress.map(t => <TaskItem key={t.id} task={t} />)}</div>
        </section>
      )}
      {groups.pending.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Pending ({groups.pending.length})</h3>
          <div className="space-y-2">{groups.pending.map(t => <TaskItem key={t.id} task={t} />)}</div>
        </section>
      )}
      {groups.completed.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-green-600 mb-2 uppercase tracking-wider">Done ({groups.completed.length})</h3>
          <div className="space-y-2">{groups.completed.map(t => <TaskItem key={t.id} task={t} />)}</div>
        </section>
      )}
    </div>
  )
}
