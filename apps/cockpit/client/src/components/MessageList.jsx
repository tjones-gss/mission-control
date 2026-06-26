import { useState, memo } from 'react'
import { Terminal, ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react'
import { TOOL_COLORS } from './AgentTree.jsx'
import { Markdown } from './Markdown.jsx'
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

// Renders the message/tool-call/thinking thread: one block per message, plus a
// trailing streaming indicator while a response is generating.
export function MessageList({ messages, toolNameMap, isStreaming }) {
  return (
    <>
      {messages.map((msg) => (
        <div key={msg.uuid}>
          {msg.type === 'user' && <UserMessage blocks={msg.blocks} toolNameMap={toolNameMap} />}
          {msg.type === 'assistant' && <AssistantMessage blocks={msg.blocks} />}
        </div>
      ))}
      {isStreaming && <StreamingIndicator />}
    </>
  )
}
