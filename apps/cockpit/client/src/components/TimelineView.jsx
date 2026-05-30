import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Sparkles, MessageSquare, Wrench, CheckCircle, User } from 'lucide-react'
import { useApi } from '../hooks/useApi.js'
import { TOOL_COLORS } from './AgentTree.jsx'

function timeDelta(prev, curr) {
  if (!prev || !curr) return ''
  const ms = new Date(curr) - new Date(prev)
  if (ms < 1000) return `+${ms}ms`
  if (ms < 60000) return `+${Math.round(ms / 1000)}s`
  return `+${Math.round(ms / 60000)}m`
}

function EventIcon({ type, color }) {
  const cls = `w-3.5 h-3.5 ${color}`
  if (type === 'thinking') return <Sparkles className={cls} />
  if (type === 'text') return <MessageSquare className={cls} />
  if (type === 'tool_use') return <Wrench className={cls} />
  if (type === 'tool_result') return <CheckCircle className={cls} />
  if (type === 'user_text') return <User className={cls} />
  return <MessageSquare className={cls} />
}

export function TimelineView({ sessionId, sessionUpdateVersion, active }) {
  const url = active && sessionId ? `/api/sessions/${sessionId}/messages` : null
  const { data, loading } = useApi(url, [sessionUpdateVersion])
  const messages = data?.messages || []

  const events = useMemo(() => {
    const result = []
    for (const msg of messages) {
      const ts = msg.timestamp
      if (msg.type === 'user') {
        for (const block of msg.blocks ?? []) {
          if (block.type === 'text') {
            result.push({
              timestamp: ts,
              type: 'user_text',
              label: 'USER',
              summary: block.text?.slice(0, 80) || '',
              color: 'text-indigo-400',
            })
          }
          if (block.type === 'tool_result') {
            result.push({
              timestamp: ts,
              type: 'tool_result',
              label: 'RESULT',
              summary: (block.content || '').split('\n')[0].slice(0, 80),
              color: 'text-gray-500',
            })
          }
        }
      }
      if (msg.type === 'assistant') {
        for (const block of msg.blocks ?? []) {
          if (block.type === 'thinking') {
            result.push({
              timestamp: ts,
              type: 'thinking',
              label: 'THINK',
              summary: block.text?.slice(0, 80) || '',
              color: 'text-amber-500',
            })
          }
          if (block.type === 'text') {
            result.push({
              timestamp: ts,
              type: 'text',
              label: 'TEXT',
              summary: block.text?.slice(0, 80) || '',
              color: 'text-gray-400',
            })
          }
          if (block.type === 'tool_use') {
            const toolColor = TOOL_COLORS[block.name]
              ? TOOL_COLORS[block.name].split(' ')[1]
              : 'text-gray-400'
            const inputSummary =
              block.name === 'Bash'
                ? (block.input?.command || '').slice(0, 80)
                : ['Read', 'Write', 'Edit', 'MultiEdit'].includes(block.name)
                  ? (block.input?.file_path || '').slice(0, 80)
                  : block.name === 'Agent'
                    ? (block.input?.prompt || '').slice(0, 60)
                    : String(Object.values(block.input || {})[0] || '').slice(0, 80)
            result.push({
              timestamp: ts,
              type: 'tool_use',
              label: block.name,
              summary: inputSummary,
              color: toolColor,
            })
          }
        }
      }
    }
    return result
  }, [messages])

  const scrollRef = useRef(null)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (!paused && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [events, sessionUpdateVersion, paused])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100
    setPaused(!atBottom)
  }, [])

  const resumeScroll = useCallback(() => {
    setPaused(false)
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [])

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-3 py-2">
        {loading && <div className="text-xs text-gray-600 p-4">Loading...</div>}
        {events.length === 0 && !loading && (
          <div className="text-xs text-gray-700 p-4">No events</div>
        )}
        {events.map((evt, i) => (
          <div key={i} className="flex items-start gap-2 py-1.5 border-b border-gray-900/50">
            <div className={`mt-0.5 shrink-0 ${evt.color}`}>
              <EventIcon type={evt.type} color={evt.color} />
            </div>
            <div className="text-[10px] text-gray-700 font-mono shrink-0 w-12">
              {timeDelta(events[i - 1]?.timestamp, evt.timestamp)}
            </div>
            <div
              className={`text-[10px] font-semibold uppercase tracking-wider shrink-0 w-14 ${evt.color}`}
            >
              {evt.label}
            </div>
            <div className="text-xs text-gray-500 truncate flex-1">{evt.summary}</div>
          </div>
        ))}
      </div>
      {paused && (
        <div
          className="absolute bottom-0 left-0 right-0 py-1.5 px-3 bg-cyan-950/80 border-t border-cyan-800/50 text-xs text-cyan-400 cursor-pointer text-center"
          onClick={resumeScroll}
        >
          ⏸ Auto-scroll paused · Click to resume
        </div>
      )}
    </div>
  )
}
