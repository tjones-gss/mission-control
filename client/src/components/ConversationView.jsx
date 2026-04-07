import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react'
import {
  Send,
  Info,
  X,
  Loader,
  Terminal,
  ChevronDown,
  ChevronUp,
  ImagePlus,
  ShieldAlert,
} from 'lucide-react'
import { useApi } from '../hooks/useApi.js'
import { TOOL_COLORS } from './AgentTree.jsx'
import { Markdown } from './Markdown.jsx'
import { ToolApprovalBanner } from './ToolApprovalBanner.jsx'
import { FilePath } from './FilePath.jsx'

function ThinkingBlock({ text }) {
  const [open, setOpen] = useState(false)
  return (
    <div
      className="rounded border-l-2 border-amber-700 bg-amber-900/20 cursor-pointer"
      onClick={() => setOpen((o) => !o)}
    >
      <div className="flex items-center gap-1.5 px-2 py-1">
        <span className="text-[10px] font-semibold text-amber-500 uppercase tracking-wider">
          THINK
        </span>
        <span className="text-[10px] text-amber-700">{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div className="px-2 pb-2 text-xs text-amber-200/70 font-mono leading-relaxed whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  )
}

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit'])

function ToolUseBlock({ name, input }) {
  const [open, setOpen] = useState(false)
  const color = TOOL_COLORS[name] || 'bg-gray-800 text-gray-400'
  const filePath = FILE_TOOLS.has(name) ? input?.file_path : null

  // The header used to be a <button>, but FilePath renders its own
  // <button> + <a> elements (copy-path, vscode://). Nesting buttons is
  // invalid HTML and triggered React's validateDOMNesting warning.
  // Use a div with role=button + keyboard handling instead.
  const toggle = () => setOpen((o) => !o)
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggle()
    }
  }

  return (
    <div className="rounded overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        className={`flex items-center gap-2 px-2 py-1 text-xs font-mono w-full text-left cursor-pointer ${color}`}
        onClick={toggle}
        onKeyDown={onKey}
      >
        <span>{name}</span>
        {filePath && (
          <span className="opacity-70 truncate max-w-[300px]" onClick={(e) => e.stopPropagation()}>
            <FilePath path={filePath} />
          </span>
        )}
        {!filePath && name === 'Bash' && input?.command && (
          <span className="opacity-50 truncate max-w-[300px] text-[10px]">
            {input.command.slice(0, 60)}
          </span>
        )}
        <span className="opacity-50 text-[10px] ml-auto">{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <pre className="bg-gray-900 text-gray-400 text-[11px] font-mono p-2 overflow-x-auto">
          {JSON.stringify(input, null, 2)}
        </pre>
      )}
    </div>
  )
}

// eslint-disable-next-line no-control-regex
const ANSI_RE =
  /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]|\x1b[>=<]|\x1b\[[\d;]*m/g

function stripAnsi(str) {
  return str.replace(ANSI_RE, '')
}

function ToolResultBlock({ content, toolName }) {
  const [open, setOpen] = useState(false)
  const raw = content || ''
  const cleaned = stripAnsi(raw)
  const lines = cleaned.split('\n')
  const summary = lines[0]?.slice(0, 80) || '(empty)'
  const color = toolName ? TOOL_COLORS[toolName] || 'bg-gray-800 text-gray-400' : null
  return (
    <div className="rounded bg-gray-900 border border-gray-800">
      <button
        className={`flex items-center gap-2 px-2 py-1 text-xs font-mono w-full text-left ${color || 'bg-gray-800 text-gray-400'}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Terminal size={10} className="shrink-0 opacity-60" />
        <span className="truncate opacity-70">
          {toolName ? `${toolName} result` : 'result'}: {summary}
        </span>
        <span className="ml-auto opacity-50">
          {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </span>
      </button>
      {open && (
        <pre className="text-[11px] font-mono text-gray-500 p-2 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
          {cleaned}
        </pre>
      )}
    </div>
  )
}

// Detect system/notification content injected into user messages
function isSystemContent(text) {
  if (!text) return false
  return (
    text.includes('<task-notification>') ||
    text.includes('<system-reminder>') ||
    text.includes('<command-name>') ||
    text.includes('<available-deferred-tools>') ||
    text.includes('<local-command-stdout>')
  )
}

function SystemMessage({ text }) {
  // Extract a readable summary from the system content
  let summary = text
  const taskMatch = text.match(/<summary>(.*?)<\/summary>/s)
  const cmdMatch = text.match(/<command-name>(.*?)<\/command-name>/s)
  if (taskMatch) {
    summary = taskMatch[1].trim()
  } else if (cmdMatch) {
    const stdoutMatch = text.match(/<local-command-stdout>(.*?)<\/local-command-stdout>/s)
    summary = `/${cmdMatch[1]}${stdoutMatch ? ': ' + stdoutMatch[1].trim() : ''}`
  } else {
    summary = text.slice(0, 120) + (text.length > 120 ? '...' : '')
  }

  return (
    <div className="rounded bg-gray-900/40 border border-gray-800/50 px-3 py-1.5">
      <span className="text-[10px] text-gray-600 font-mono">{summary}</span>
    </div>
  )
}

function ImageBlock({ source }) {
  if (!source) return null
  const src =
    source.type === 'base64'
      ? `data:${source.media_type};base64,${source.data}`
      : source.url || null
  if (!src) return null
  return (
    <img
      src={src}
      alt="User attached image"
      className="max-w-xs max-h-64 rounded border border-indigo-800/30 object-contain"
    />
  )
}

const REDACTED_RE = /\[REDACTED: [^\]]+\]/g

function countRedactions(blocks) {
  let count = 0
  for (const b of blocks) {
    const text = b.text || b.content || ''
    const matches = text.match(REDACTED_RE)
    if (matches) count += matches.length
  }
  return count
}

function RedactedBadge({ count }) {
  if (!count) return null
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-900/40 text-red-400 text-[10px] font-mono">
      <ShieldAlert size={10} />
      {count} secret{count > 1 ? 's' : ''} redacted
    </span>
  )
}

const UserMessage = memo(function UserMessage({ blocks, toolNameMap }) {
  const textBlocks = blocks.filter((b) => b.type === 'text')
  const imageBlocks = blocks.filter((b) => b.type === 'image')
  const resultBlocks = blocks.filter((b) => b.type === 'tool_result')
  const redactedCount = countRedactions(blocks)

  // Separate real user text from system-injected content
  const userTexts = textBlocks.filter((b) => !isSystemContent(b.text))
  const systemTexts = textBlocks.filter((b) => isSystemContent(b.text))

  return (
    <>
      {(userTexts.length > 0 || imageBlocks.length > 0) && (
        <div className="rounded-lg bg-indigo-950/40 border border-indigo-900/30 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider">
              USER
            </div>
            <RedactedBadge count={redactedCount} />
          </div>
          {imageBlocks.map((b, i) => (
            <ImageBlock key={`img-${i}`} source={b.source} />
          ))}
          {userTexts.map((b, i) => (
            <Markdown key={i} className="text-indigo-100/80">
              {b.text}
            </Markdown>
          ))}
        </div>
      )}
      {systemTexts.map((b, i) => (
        <SystemMessage key={`sys-${i}`} text={b.text} />
      ))}
      {resultBlocks.length > 0 && (
        <div className="rounded-lg bg-gray-900/60 border border-gray-800 p-3 space-y-2">
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
            TOOL OUTPUT
          </div>
          {resultBlocks.map((b, i) => (
            <ToolResultBlock key={i} content={b.content} toolName={toolNameMap[b.toolUseId]} />
          ))}
        </div>
      )}
    </>
  )
})

const AssistantMessage = memo(function AssistantMessage({ blocks }) {
  const redactedCount = countRedactions(blocks)
  return (
    <div className="space-y-2">
      <RedactedBadge count={redactedCount} />
      {blocks.map((block, i) => {
        if (block.type === 'thinking') return <ThinkingBlock key={i} text={block.text} />
        if (block.type === 'text') return <Markdown key={i}>{block.text}</Markdown>
        if (block.type === 'tool_use')
          return <ToolUseBlock key={i} name={block.name} input={block.input} />
        return null
      })}
    </div>
  )
})

function OptionPills({ options }) {
  const pills = []
  if (options.permissionMode) pills.push(options.permissionMode)
  if (options.model) pills.push(options.model)
  if (options.effort) pills.push(options.effort)
  if (pills.length === 0) return null
  return (
    <div className="flex items-center gap-1">
      {pills.map((p) => (
        <span
          key={p}
          className="px-1.5 py-0.5 rounded bg-indigo-900/40 text-indigo-300 text-[10px] font-mono"
        >
          {p}
        </span>
      ))}
    </div>
  )
}

function SlashAutocomplete({ filter, skills, selectedIndex, onSelect }) {
  if (!skills || skills.length === 0) return null

  const filtered = skills.filter((s) => {
    const name = s.command || `/${s.name}`
    return name.toLowerCase().includes(filter.toLowerCase())
  })

  if (filtered.length === 0) return null

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-h-48 overflow-y-auto z-50">
      {filtered.map((s, i) => (
        <button
          key={s.name}
          className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
            i === selectedIndex
              ? 'bg-indigo-900/50 text-indigo-200'
              : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
          }`}
          onMouseDown={(e) => {
            e.preventDefault()
            onSelect(s)
          }}
        >
          <span className="font-mono text-indigo-400">{s.command || `/${s.name}`}</span>
          {s.description && <span className="text-gray-600 truncate">{s.description}</span>}
        </button>
      ))}
    </div>
  )
}

function StreamingIndicator() {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <div className="flex gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
        <span
          className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"
          style={{ animationDelay: '150ms' }}
        />
        <span
          className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"
          style={{ animationDelay: '300ms' }}
        />
      </div>
      <span className="text-xs text-indigo-400/70">Generating response...</span>
    </div>
  )
}

const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB
const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

function MessageInput({
  sessionId,
  sending,
  onSend,
  sessionOptions,
  skills,
  active,
  isStreaming,
  onCancel,
}) {
  const [text, setText] = useState('')
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [showAutocomplete, setShowAutocomplete] = useState(false)
  const [acIndex, setAcIndex] = useState(0)
  const inputRef = useRef(null)
  const fileInputRef = useRef(null)

  const allSkills = useMemo(() => {
    if (!skills) return []
    const user = skills.userSkills || []
    const plugins = skills.plugins || skills.pluginSkills || []
    const flat =
      Array.isArray(plugins) && plugins[0]?.skills ? plugins.flatMap((p) => p.skills) : plugins
    return [...user, ...flat]
  }, [skills])

  const slashFilter = useMemo(() => {
    if (!text.startsWith('/')) return ''
    return text.split(/\s/)[0]
  }, [text])

  const filteredSkills = useMemo(() => {
    if (!slashFilter) return []
    return allSkills.filter((s) => {
      const name = s.command || `/${s.name}`
      return name.toLowerCase().includes(slashFilter.toLowerCase())
    })
  }, [slashFilter, allSkills])

  useEffect(() => {
    setShowAutocomplete(slashFilter.length > 0 && filteredSkills.length > 0)
    setAcIndex(0)
  }, [slashFilter, filteredSkills.length])

  const selectSkill = useCallback(
    (skill) => {
      const cmd = skill.command || `/${skill.name}`
      const rest = text.includes(' ') ? text.slice(text.indexOf(' ')) : ' '
      setText(cmd + rest)
      setShowAutocomplete(false)
      inputRef.current?.focus()
    },
    [text],
  )

  // Image handling
  const validateAndSetImage = useCallback((file) => {
    if (!file) return
    if (!IMAGE_MIME_TYPES.includes(file.type)) return
    if (file.size > MAX_IMAGE_SIZE) return
    setImageFile(file)
    const url = URL.createObjectURL(file)
    setImagePreview(url)
  }, [])

  const clearImage = useCallback(() => {
    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setImageFile(null)
    setImagePreview(null)
  }, [imagePreview])

  // Clean up object URL on unmount
  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview)
    }
  }, [imagePreview])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault()
      setDragOver(false)
      const file = e.dataTransfer?.files?.[0]
      if (file) validateAndSetImage(file)
    },
    [validateAndSetImage],
  )

  const handlePaste = useCallback(
    (e) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.kind === 'file' && IMAGE_MIME_TYPES.includes(item.type)) {
          e.preventDefault()
          validateAndSetImage(item.getAsFile())
          return
        }
      }
    },
    [validateAndSetImage],
  )

  const handleKeyDown = (e) => {
    if (showAutocomplete) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setAcIndex((i) => Math.min(i + 1, filteredSkills.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setAcIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && filteredSkills[acIndex])) {
        e.preventDefault()
        selectSkill(filteredSkills[acIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowAutocomplete(false)
        return
      }
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!text.trim() || sending) return
    onSend(text.trim(), imageFile)
    setText('')
    setShowAutocomplete(false)
    clearImage()
  }

  useEffect(() => {
    if (!sending && inputRef.current) inputRef.current.focus()
  }, [sending])

  return (
    <form
      onSubmit={handleSubmit}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative px-3 py-2 border-t bg-gray-950 ${dragOver ? 'border-indigo-500 bg-indigo-950/20' : 'border-gray-800'}`}
    >
      {showAutocomplete && (
        <SlashAutocomplete
          filter={slashFilter}
          skills={allSkills}
          selectedIndex={acIndex}
          onSelect={selectSkill}
        />
      )}
      {imagePreview && (
        <div className="flex items-center gap-2 mb-1.5">
          <div className="relative inline-block">
            <img
              src={imagePreview}
              alt="Attached"
              className="h-12 w-12 object-cover rounded border border-gray-700"
            />
            <button
              type="button"
              onClick={clearImage}
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-gray-800 border border-gray-600 flex items-center justify-center hover:bg-red-800 transition-colors"
            >
              <X size={8} className="text-gray-400" />
            </button>
          </div>
          <span className="text-[10px] text-gray-500">{imageFile?.name}</span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(e) => {
            validateAndSetImage(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending || isStreaming}
          className="p-1.5 rounded text-gray-500 hover:text-indigo-400 hover:bg-gray-800 transition-colors disabled:opacity-30"
          title="Attach image"
        >
          <ImagePlus size={16} />
        </button>
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={sending || isStreaming}
          data-shortcut-focus="message-input"
          placeholder={
            isStreaming
              ? 'Generating...'
              : sending
                ? 'Sending...'
                : 'Send a message (/ for commands)...'
          }
          className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
        />
        {sessionOptions && <OptionPills options={sessionOptions} />}
        {isStreaming ? (
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded bg-red-700 text-white text-xs font-medium hover:bg-red-600 transition-colors flex items-center gap-1.5"
          >
            <X size={12} />
            Cancel
          </button>
        ) : (
          <button
            type="submit"
            disabled={!text.trim() || sending}
            className="px-3 py-1.5 rounded bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          >
            <Send size={12} />
            Send
          </button>
        )}
        {active && !isStreaming && (
          <Info
            size={12}
            className="text-gray-600 hover:text-gray-400 flex-shrink-0 cursor-default"
            title="Messages sent via PTY (subscription auth). Results appear in real-time."
          />
        )}
      </div>
    </form>
  )
}

export function ConversationView({
  sessionId,
  sessionUpdateVersion,
  active,
  sessionOptions,
  skills,
  streaming,
}) {
  const isStreaming = streaming?.isStreaming || false
  const pendingApprovals = streaming?.pendingApprovals || []
  const sdkError = streaming?.sdkError || null
  const url = active && sessionId ? `/api/sessions/${sessionId}/messages` : null
  const { data, loading } = useApi(url, [sessionUpdateVersion])
  const serverMessages = data?.messages || []

  // Optimistic user messages — shown immediately on send, cleared once they
  // appear in the server response (matched by text content).
  const [pendingUserMsgs, setPendingUserMsgs] = useState([])
  useEffect(() => {
    setPendingUserMsgs([])
  }, [sessionId])
  const messages = useMemo(() => {
    // Drop pending messages that now exist in the server data
    const pending = pendingUserMsgs.filter(
      (p) =>
        !serverMessages.some(
          (m) =>
            m.type === 'user' &&
            m.blocks?.some?.((b) => b.type === 'text' && b.text === p.blocks[0].text),
        ),
    )
    if (pending.length !== pendingUserMsgs.length) {
      // Use queueMicrotask to avoid setState during render
      queueMicrotask(() => setPendingUserMsgs(pending))
    }
    return [...serverMessages, ...pending]
  }, [serverMessages, pendingUserMsgs])

  // Build tool_use_id → tool_name lookup — append-only via ref to avoid re-renders
  const toolNameMapRef = useRef({})
  const toolNameMap = useMemo(() => {
    const map = toolNameMapRef.current
    for (const msg of messages) {
      if (msg.type === 'assistant') {
        for (const block of msg.blocks) {
          if (block.type === 'tool_use' && block.id && !map[block.id]) {
            map[block.id] = block.name
          }
        }
      }
    }
    return map
  }, [messages])

  const scrollRef = useRef(null)
  const [paused, setPaused] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(null)

  // Build clean options object (omit empty values)
  const cleanOptions = useMemo(() => {
    if (!sessionOptions) return undefined
    const o = {}
    if (sessionOptions.permissionMode) o.permissionMode = sessionOptions.permissionMode
    if (sessionOptions.model) o.model = sessionOptions.model
    if (sessionOptions.effort) o.effort = sessionOptions.effort
    return Object.keys(o).length > 0 ? o : undefined
  }, [sessionOptions])

  const handleSend = useCallback(
    async (text, imageFile) => {
      if (!sessionId || isStreaming) return
      setSending(true)
      setSendError(null)
      // Optimistically show the user message immediately
      setPendingUserMsgs((prev) => [
        ...prev,
        {
          uuid: `pending-${Date.now()}`,
          type: 'user',
          blocks: [{ type: 'text', text }],
        },
      ])
      try {
        let fetchOpts
        if (imageFile) {
          // Multipart form data for image upload
          const formData = new FormData()
          formData.append('message', text)
          formData.append('image', imageFile)
          if (cleanOptions) formData.append('options', JSON.stringify(cleanOptions))
          fetchOpts = { method: 'POST', body: formData }
        } else {
          // JSON body for text-only messages
          const body = { message: text }
          if (cleanOptions) body.options = cleanOptions
          fetchOpts = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        }

        const res = await fetch(`/api/sessions/${sessionId}/message`, fetchOpts)
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.detail || data.error || `HTTP ${res.status}`)
        }
        // 202 Accepted — query started, streaming state managed by SSE events
        if (streaming?.markStreaming) streaming.markStreaming()
      } catch (e) {
        setSendError(e.message)
      } finally {
        setSending(false)
      }
    },
    [sessionId, cleanOptions, isStreaming, streaming],
  )

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
        {messages.map((msg) => (
          <div key={msg.uuid}>
            {msg.type === 'user' && <UserMessage blocks={msg.blocks} toolNameMap={toolNameMap} />}
            {msg.type === 'assistant' && <AssistantMessage blocks={msg.blocks} />}
          </div>
        ))}
        {isStreaming && <StreamingIndicator />}
      </div>

      {pendingApprovals.map((a) => (
        <ToolApprovalBanner
          key={a.approvalId}
          approval={a}
          onApprove={streaming?.approve}
          onDeny={streaming?.deny}
        />
      ))}

      {paused && (
        <div
          className="absolute bottom-2 left-2 right-2 py-1.5 px-3 bg-cyan-950/80 border border-cyan-800/50 rounded text-xs text-cyan-400 cursor-pointer text-center"
          onClick={resumeScroll}
        >
          Auto-scroll paused - click to resume
        </div>
      )}

      {sdkError && (
        <div className="px-3 py-2 bg-red-950/50 border-t border-red-800/50 text-xs text-red-400">
          <div className="flex items-center justify-between">
            <span className="font-medium">
              {sdkError.errorType === 'credit_balance'
                ? 'Insufficient API credits'
                : `Query failed: ${sdkError.message}`}
            </span>
            <button
              onClick={streaming?.clearError}
              className="text-red-600 hover:text-red-400 ml-2"
            >
              dismiss
            </button>
          </div>
          {sdkError.errorType === 'credit_balance' && (
            <div className="mt-1 text-red-400/70">
              Could not send message. Check your subscription status or try again.
            </div>
          )}
        </div>
      )}

      {sendError && (
        <div className="px-3 py-1.5 bg-red-950/50 border-t border-red-800/50 text-xs text-red-400 flex items-center justify-between">
          <span>Send failed: {sendError}</span>
          <button
            onClick={() => setSendError(null)}
            className="text-red-600 hover:text-red-400 ml-2"
          >
            dismiss
          </button>
        </div>
      )}

      <MessageInput
        sessionId={sessionId}
        sending={sending}
        onSend={handleSend}
        sessionOptions={sessionOptions}
        skills={skills}
        active={active}
        isStreaming={isStreaming}
        onCancel={streaming?.cancel}
      />
    </div>
  )
}
