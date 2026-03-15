import { useState, useCallback } from 'react';
import { Bot, Wrench, MessageSquare } from 'lucide-react';

function getModelAbbr(model) {
  if (!model) return '—';
  const parts = model.split('-');
  if (parts.length < 2) return model;
  return parts.slice(-2).join('-');
}

function getProjectSlug(cwd) {
  if (!cwd) return '—';
  const normalized = cwd.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || '—';
}

function getTopTools(toolUseCounts, n = 3) {
  if (!toolUseCounts || typeof toolUseCounts !== 'object') return [];
  return Object.entries(toolUseCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

const QUICK_REPLIES = ['yes', 'continue', 'approve'];

function KanbanQuickActions({ sessionId, onReply }) {
  const [sending, setSending] = useState(null);

  const send = useCallback(async (message) => {
    setSending(message);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || body.error || `HTTP ${res.status}`);
      }
    } catch {
      // Errors are transient; session will update via SSE
    } finally {
      setSending(null);
    }
  }, [sessionId]);

  return (
    <div className="flex items-center gap-1 mt-2 flex-wrap" onClick={e => e.stopPropagation()}>
      {QUICK_REPLIES.map(msg => (
        <button
          key={msg}
          onClick={() => send(msg)}
          disabled={sending !== null}
          className="px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 text-[10px] hover:bg-amber-800/60 disabled:opacity-30 transition-colors"
        >
          {sending === msg ? '...' : msg}
        </button>
      ))}
      {onReply && (
        <button
          onClick={() => onReply(sessionId)}
          className="px-1.5 py-0.5 rounded bg-indigo-900/40 text-indigo-300 text-[10px] hover:bg-indigo-800/60 transition-colors flex items-center gap-0.5"
        >
          <MessageSquare size={8} /> reply
        </button>
      )}
    </div>
  );
}

function SessionCard({ session, isSelected, onSelect }) {
  const slug = getProjectSlug(session.cwd);
  const modelAbbr = getModelAbbr(session.model);
  const topTools = getTopTools(session.toolUseCounts);
  const agentCount = session.agents?.length ?? 0;

  return (
    <div
      onClick={() => onSelect(session.sessionId)}
      className={[
        'cursor-pointer rounded-lg border bg-gray-900 p-3 hover:bg-gray-800 transition-colors',
        isSelected ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-gray-800',
      ].join(' ')}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          {session.isActive && (
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
            </span>
          )}
          {session.needsInput && !session.isActive && (
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
            </span>
          )}
          <span className="text-sm font-medium text-gray-100 truncate">{slug}</span>
        </div>
        <span className="text-xs text-gray-500 shrink-0 font-mono">{modelAbbr}</span>
      </div>

      {/* Last text */}
      {session.lastText && (
        <p className="text-xs text-gray-400 truncate mb-2 leading-snug">
          {session.lastText}
        </p>
      )}

      {/* Footer row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Subagent count */}
        {agentCount > 0 && (
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <Bot size={11} />
            {agentCount}
          </span>
        )}

        {/* Tool pills */}
        {topTools.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {topTools.map(([tool, count]) => (
              <span
                key={tool}
                className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs bg-gray-800 text-gray-400 border border-gray-700"
              >
                <Wrench size={9} className="shrink-0" />
                <span className="truncate max-w-[72px]">{tool}</span>
                <span className="text-gray-500 ml-0.5">{count}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Quick actions for waiting sessions */}
      {session.needsInput && !session.isActive && (
        <KanbanQuickActions sessionId={session.sessionId} onReply={() => onSelect(session.sessionId)} />
      )}
    </div>
  );
}

function Column({ title, titleClass, sessions, selectedId, onSelect, emptyLabel }) {
  return (
    <div className="flex flex-col min-w-0 flex-1">
      <div className="flex items-center justify-between mb-3 px-1">
        <h3 className={`text-xs font-semibold uppercase tracking-wider ${titleClass}`}>
          {title}
        </h3>
        <span className="text-xs text-gray-600 font-mono">{sessions.length}</span>
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto">
        {sessions.length === 0 ? (
          <p className="text-xs text-gray-700 italic px-1">{emptyLabel}</p>
        ) : (
          sessions.map((session) => (
            <SessionCard
              key={session.sessionId}
              session={session}
              isSelected={selectedId === session.sessionId}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}

export function KanbanBoard({ sessions = [], selectedId, onSelect }) {
  const now = Date.now();
  const ONE_HOUR = 3_600_000;

  const active = sessions.filter((s) => s.isActive === true);
  const idle = sessions.filter((s) => !s.isActive && s.lastModified > now - ONE_HOUR);
  const done = sessions.filter((s) => !s.isActive && s.lastModified <= now - ONE_HOUR);

  return (
    <div className="flex gap-4 h-full p-4 bg-gray-950 overflow-hidden">
      <Column
        title="Active"
        titleClass="text-green-400"
        sessions={active}
        selectedId={selectedId}
        onSelect={onSelect}
        emptyLabel="No active sessions"
      />
      <Column
        title="Idle"
        titleClass="text-amber-400"
        sessions={idle}
        selectedId={selectedId}
        onSelect={onSelect}
        emptyLabel="No idle sessions"
      />
      <Column
        title="Done"
        titleClass="text-gray-500"
        sessions={done}
        selectedId={selectedId}
        onSelect={onSelect}
        emptyLabel="No completed sessions"
      />
    </div>
  );
}
