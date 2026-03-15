import { useState, useRef, useEffect, useCallback } from 'react'
import { Send } from 'lucide-react'
import { useApi } from '../hooks/useApi.js'
import { TOOL_COLORS } from './AgentTree.jsx'

function ThinkingBlock({ text }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded border-l-2 border-amber-700 bg-amber-900/20 cursor-pointer" onClick={() => setOpen(o => !o)}>
      <div className="flex items-center gap-1.5 px-2 py-1">
        <span className="text-[10px] font-semibold text-amber-500 uppercase tracking-wider">THINK</span>
        <span className="text-[10px] text-amber-700">{open ? '▲' : '▼'}</span>
      </div>
      {open && <div className="px-2 pb-2 text-xs text-amber-200/70 font-mono leading-relaxed whitespace-pre-wrap">{text}</div>}
    </div>
  )
}

function ToolUseBlock({ name, input }) {
  const [open, setOpen] = useState(false)
  const color = TOOL_COLORS[name] || 'bg-gray-800 text-gray-400'
  return (
    <div className="rounded overflow-hidden">
      <button
        className={`flex items-center gap-2 px-2 py-1 text-xs font-mono w-full text-left ${color}`}
        onClick={() => setOpen(o => !o)}
      >
        <span>{name}</span>
        <span className="opacity-50 text-[10px]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <pre className="bg-gray-900 text-gray-400 text-[11px] font-mono p-2 overflow-x-auto">
          {JSON.stringify(input, null, 2)}
        </pre>
      )}
    </div>
  )
}

function ToolResultBlock({ content }) {
  const [expanded, setExpanded] = useState(false)
  const lines = (content || '').split('\n')
  const truncated = lines.length > 20
  const display = !truncated || expanded ? content : lines.slice(0, 20).join('\n')
  return (
    <div className="rounded bg-gray-900 border border-gray-800">
      <pre className="text-[11px] font-mono text-gray-500 p-2 overflow-x-auto whitespace-pre-wrap">{display}</pre>
      {truncated && (
        <button className="text-[10px] text-cyan-600 hover:text-cyan-400 px-2 pb-1.5" onClick={() => setExpanded(e => !e)}>
          {expanded ? 'show less' : `+${lines.length - 20} more lines`}
        </button>
      )}
    </div>
  )
}

function UserMessage({ blocks }) {
  const textBlocks = blocks.filter(b => b.type === 'text')
  const resultBlocks = blocks.filter(b => b.type === 'tool_result')
  return (
    <div className="rounded-lg bg-indigo-950/40 border border-indigo-900/30 p-3 space-y-2">
      <div className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider">USER</div>
      {textBlocks.map((b, i) => <div key={i} className="text-sm text-indigo-100/80 leading-relaxed whitespace-pre-wrap">{b.text}</div>)}
      {resultBlocks.map((b, i) => <ToolResultBlock key={i} content={b.content} />)}
    </div>
  )
}

function AssistantMessage({ blocks }) {
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        if (block.type === 'thinking') return <ThinkingBlock key={i} text={block.text} />
        if (block.type === 'text') return <div key={i} className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{block.text}</div>
        if (block.type === 'tool_use') return <ToolUseBlock key={i} name={block.name} input={block.input} />
        return null
      })}
    </div>
  )
}

function MessageInput({ sessionId, sending, onSend }) {
  const [text, setText] = useState('')
  const inputRef = useRef(null)

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!text.trim() || sending) return
    onSend(text.trim())
    setText('')
  }

  useEffect(() => {
    if (!sending && inputRef.current) inputRef.current.focus()
  }, [sending])

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 px-3 py-2 border-t border-gray-800 bg-gray-950">
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        disabled={sending}
        placeholder={sending ? 'Sending...' : 'Send a message to this session...'}
        className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={!text.trim() || sending}
        className="px-3 py-1.5 rounded bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
      >
        <Send size={12} />
        Send
      </button>
    </form>
  )
}

export function ConversationView({ sessionId, sessionUpdateVersion, active }) {
  const url = active && sessionId ? `/api/sessions/${sessionId}/messages` : null
  const { data, loading } = useApi(url, [sessionUpdateVersion])
  const messages = data?.messages || []

  const scrollRef = useRef(null)
  const [paused, setPaused] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(null)

  const handleSend = useCallback(async (text) => {
    if (!sessionId) return
    setSending(true)
    setSendError(null)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || body.error || `HTTP ${res.status}`)
      }
      // SSE will trigger a session_update which refetches messages
    } catch (e) {
      setSendError(e.message)
    } finally {
      setSending(false)
    }
  }, [sessionId])

  useEffect(() => {
    if (!paused && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length, sessionUpdateVersion, paused])

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
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading && <div className="text-xs text-gray-600 p-4">Loading...</div>}
        {messages.map(msg => (
          <div key={msg.uuid}>
            {msg.type === 'user' && <UserMessage blocks={msg.blocks} />}
            {msg.type === 'assistant' && <AssistantMessage blocks={msg.blocks} />}
          </div>
        ))}
      </div>

      {paused && (
        <div
          className="absolute bottom-2 left-2 right-2 py-1.5 px-3 bg-cyan-950/80 border border-cyan-800/50 rounded text-xs text-cyan-400 cursor-pointer text-center"
          onClick={resumeScroll}
        >
          Auto-scroll paused - click to resume
        </div>
      )}

      {sendError && (
        <div className="px-3 py-1.5 bg-red-950/50 border-t border-red-800/50 text-xs text-red-400 flex items-center justify-between">
          <span>Send failed: {sendError}</span>
          <button onClick={() => setSendError(null)} className="text-red-600 hover:text-red-400 ml-2">dismiss</button>
        </div>
      )}

      <MessageInput sessionId={sessionId} sending={sending} onSend={handleSend} />
    </div>
  )
}
