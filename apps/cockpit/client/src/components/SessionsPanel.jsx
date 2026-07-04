import { Plus } from 'lucide-react'
import { SessionsList } from './SessionsList.jsx'
import { NewSessionForm } from './NewSessionForm.jsx'

// The Sessions panel body, shared by the desktop fixed sidebar (≥lg) and the
// mobile slide-in drawer (<lg). `onAfterSelect` lets the drawer close itself
// once the user picks a session; the fixed sidebar passes nothing.
export function SessionsPanel({
  sessions,
  selectedSessionId,
  showNewSession,
  onToggleNewSession,
  onSessionCreated,
  onSelectSession,
  onMuteSession,
  onReplySession,
  onAfterSelect,
}) {
  return (
    <>
      <div className="h-10 shrink-0 px-3 border-b border-[var(--mc-border)] flex items-center">
        <span className="mc-eyebrow">Sessions</span>
        {sessions && <span className="ml-2 text-xs text-gray-500">{sessions.length}</span>}
        <button
          onClick={onToggleNewSession}
          className="ml-auto p-1.5 -m-1 text-gray-600 hover:text-gray-300 transition-colors rounded"
          title="New session"
          aria-label="New session"
          aria-expanded={showNewSession}
        >
          <Plus size={14} />
        </button>
      </div>
      {showNewSession && (
        <NewSessionForm
          sessions={sessions}
          onCreated={(arg) => {
            onSessionCreated(arg)
            onAfterSelect?.()
          }}
        />
      )}
      <SessionsList
        sessions={sessions}
        selectedId={selectedSessionId}
        onSelect={(id) => {
          onSelectSession(id)
          onAfterSelect?.()
        }}
        onMuteSession={onMuteSession}
        onReplySession={(id) => {
          onReplySession(id)
          onAfterSelect?.()
        }}
      />
    </>
  )
}
