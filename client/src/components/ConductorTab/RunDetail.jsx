import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Circle } from 'lucide-react'
import { Markdown } from '../Markdown.jsx'

const PHASE_BADGE = {
  bootstrap: 'bg-gray-700 text-gray-200',
  plan: 'bg-blue-900/60 text-blue-200',
  build: 'bg-indigo-900/60 text-indigo-200',
  integration: 'bg-purple-900/60 text-purple-200',
  ship: 'bg-emerald-900/60 text-emerald-200',
  retrospective: 'bg-teal-900/60 text-teal-200',
  completed: 'bg-green-900/60 text-green-200',
  aborted: 'bg-red-900/60 text-red-200',
  escalated: 'bg-amber-900/60 text-amber-200',
}

const SUB_TABS = [
  { id: 'journal', label: 'Journal', kind: 'journal', flag: 'hasJournalDraft' },
  {
    id: 'ratification',
    label: 'Ratification',
    kind: 'ratification',
    flag: 'hasRatificationProposal',
  },
  { id: 'skill-diff', label: 'Skill Diff', kind: 'skill-diff', flag: 'hasSkillDiffProposal' },
]

function fileUrl(run, kind) {
  const projectKey = encodeURIComponent(run.projectPath)
  return `/api/conductor/${projectKey}/${run.adr}/${kind}`
}

function Card({ label, value, hint }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-600">{label}</div>
      <div className="mt-1 text-sm text-gray-200 font-mono">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-gray-600">{hint}</div>}
    </div>
  )
}

function AcceptanceList({ required, run }) {
  if (!required.length) {
    return <div className="text-[11px] text-gray-600">No acceptance commands defined in spec.</div>
  }
  const runSet = new Set(run)
  return (
    <ul className="space-y-1">
      {required.map((cmd) => {
        const ok = runSet.has(cmd)
        return (
          <li key={cmd} className="flex items-start gap-2 text-xs">
            {ok ? (
              <CheckCircle2 size={14} className="text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <Circle size={14} className="text-gray-600 shrink-0 mt-0.5" />
            )}
            <code className={`font-mono text-[11px] ${ok ? 'text-gray-300' : 'text-gray-500'}`}>
              {cmd}
            </code>
          </li>
        )
      })}
    </ul>
  )
}

export function RunDetail({ run, conductorVersion }) {
  const [subTab, setSubTab] = useState('journal')
  const [content, setContent] = useState('')
  const [contentLoading, setContentLoading] = useState(false)
  const [contentError, setContentError] = useState(null)

  // Pick the best default sub-tab when the run changes — prefer ratification
  // (user-gated), then journal, then skill-diff. If none are present, fall
  // back to journal so the empty-state copy renders.
  useEffect(() => {
    if (run.hasRatificationProposal) setSubTab('ratification')
    else if (run.hasJournalDraft) setSubTab('journal')
    else if (run.hasSkillDiffProposal) setSubTab('skill-diff')
    else setSubTab('journal')
  }, [run.projectPath, run.adr])

  // Load the file content for the active sub-tab; refetch on conductorVersion
  // bumps so SSE-driven updates actually refresh the view.
  useEffect(() => {
    const meta = SUB_TABS.find((t) => t.id === subTab)
    if (!meta || !run[meta.flag]) {
      setContent('')
      setContentError(null)
      setContentLoading(false)
      return
    }
    const controller = new AbortController()
    setContentLoading(true)
    setContentError(null)
    fetch(fileUrl(run, meta.kind), { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.text()
      })
      .then((text) => {
        setContent(text)
        setContentLoading(false)
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setContentError(err.message)
        setContentLoading(false)
      })
    return () => controller.abort()
  }, [run.projectPath, run.adr, subTab, conductorVersion])

  const phaseCls = PHASE_BADGE[run.phase] || 'bg-gray-700 text-gray-200'
  const iters = run.currentTaskId ? run.taskIters[run.currentTaskId] || 0 : 0
  const splits = run.currentTaskId ? run.splits[run.currentTaskId] || 0 : 0
  const startedRel = run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-gray-800 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${phaseCls}`}>{run.phase}</span>
          <span className="text-sm font-mono text-gray-200">ADR {run.adr}</span>
          <span className="text-xs text-gray-500 truncate">{run.projectPath}</span>
          <span className="ml-auto text-[10px] text-gray-600">started {startedRel}</span>
        </div>
        {run.isPaused && (
          <div className="flex items-start gap-2 px-3 py-2 bg-amber-950/40 border border-amber-900/60 rounded">
            <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-200">
              <div className="font-semibold">Paused</div>
              <div className="text-amber-300/80">
                {run.escalationReason || 'Awaiting your decision.'}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Cards */}
      <div className="shrink-0 grid grid-cols-2 md:grid-cols-4 gap-2 px-4 py-3">
        <Card label="Current task" value={run.currentTaskId || '—'} />
        <Card
          label="Validator iters"
          value={`${iters} / 5`}
          hint={iters >= 5 ? 'max — split next' : undefined}
        />
        <Card label="Splits" value={splits} hint={splits >= 2 ? 'stuck threshold' : undefined} />
        <Card
          label="Acceptance"
          value={`${run.acceptanceCommandsRun.length} / ${run.acceptanceCommandsRequired.length}`}
        />
      </div>

      {/* Acceptance + sub-tabs */}
      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-3 gap-0 overflow-hidden">
        <div className="md:col-span-1 border-r border-gray-800 px-4 py-3 overflow-auto">
          <h3 className="text-[10px] uppercase tracking-wider text-gray-600 mb-2">
            Acceptance commands
          </h3>
          <AcceptanceList
            required={run.acceptanceCommandsRequired}
            run={run.acceptanceCommandsRun}
          />
        </div>

        <div className="md:col-span-2 flex flex-col overflow-hidden">
          <div className="shrink-0 flex items-center gap-1 px-4 py-2 border-b border-gray-800">
            {SUB_TABS.map((t) => {
              const exists = !!run[t.flag]
              return (
                <button
                  key={t.id}
                  onClick={() => setSubTab(t.id)}
                  className={`px-2 py-1 rounded text-xs transition-colors ${
                    subTab === t.id
                      ? 'bg-gray-800 text-gray-200'
                      : exists
                        ? 'text-gray-500 hover:text-gray-300'
                        : 'text-gray-700 cursor-not-allowed'
                  }`}
                  disabled={!exists}
                  title={exists ? t.label : `${t.label} not yet written`}
                >
                  {t.label}
                  {!exists && <span className="ml-1 text-[10px] text-gray-700">·</span>}
                </button>
              )
            })}
          </div>
          <div className="flex-1 overflow-auto px-4 py-3">
            {contentLoading && <div className="text-xs text-gray-600">Loading…</div>}
            {contentError && <div className="text-xs text-red-400">{contentError}</div>}
            {!contentLoading && !contentError && content && <Markdown>{content}</Markdown>}
            {!contentLoading && !contentError && !content && (
              <div className="text-xs text-gray-600">Nothing to show yet for this section.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
