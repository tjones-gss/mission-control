import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useApi } from '../hooks/useApi.js'
import { ToolApprovalBanner } from './ToolApprovalBanner.jsx'
import { MessageList } from './MessageList.jsx'
import { MessageInput } from './MessageInput.jsx'

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

  // Pull only the last N messages by default. The server endpoint now
  // supports `?limit=N` (Run #23 fix) and slices from the end. The active
  // oversight session has 1,964+ messages = 1.47 MB; fetching the full
  // history every render was a real perf hit on tab switches and SSE
  // refreshes. 200 is enough to fill several screens of conversation
  // before the user has to click "Load older".
  const PAGE_SIZE = 200
  const [messageLimit, setMessageLimit] = useState(PAGE_SIZE)
  const [paused, setPaused] = useState(false)
  // When the user clicks "Load older messages", capture the current
  // scrollHeight + scrollTop here so the post-refetch effect can
  // restore them. Declared up here (above the sessionId reset effect)
  // so the reset can clear it on session switch.
  const pendingScrollAnchorRef = useRef(null)
  // Track the previous data.offset across renders. The anchor can ONLY
  // be applied when the offset has DECREASED (which is the unambiguous
  // signature of a Load older refetch landing — the parser slices a
  // bigger window from the end of the records list, so offset shrinks).
  // SSE updates can only INCREASE offset (when totalCount grows by one
  // for a new live message), so this lets the anchor effect ignore
  // SSE-driven re-renders that arrive between the click and the
  // load-older fetch completing.
  const prevOffsetRef = useRef(0)
  // Reset session-scoped scroll/paging state when switching sessions:
  //  - messageLimit back to PAGE_SIZE so each session opens with the
  //    default page size and a fresh "Load older" button
  //  - pendingScrollAnchorRef cleared so a leftover anchor from
  //    session A doesn't get applied to session B's render (would
  //    land the user at scrollTop 0 of the new conversation)
  //  - paused back to false so the auto-scroll-to-bottom path runs
  //    on the first render of session B (otherwise scrolling up in
  //    session A leaves session B stuck at the top forever)
  //  - prevOffsetRef back to 0 so the next session's first render
  //    is treated as a clean baseline
  useEffect(() => {
    setMessageLimit(PAGE_SIZE)
    pendingScrollAnchorRef.current = null
    setPaused(false)
    prevOffsetRef.current = 0
  }, [sessionId])

  const url =
    active && sessionId ? `/api/sessions/${sessionId}/messages?limit=${messageLimit}` : null
  const { data, loading } = useApi(url, [sessionUpdateVersion, messageLimit])
  const serverMessages = data?.messages || []
  const totalMessageCount = data?.totalCount ?? serverMessages.length
  const hasOlderMessages = data?.hasMore === true
  const olderRemaining = Math.max(0, totalMessageCount - serverMessages.length)

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
      // Sending is an explicit user action — always bring them back to
      // the tail of the conversation so they can see their just-sent
      // message, the generating indicator, and the incoming response.
      // Without this, a user who was scrolled up reading older context
      // clicks Send and sees nothing change (paused auto-scroll eats
      // the update). Unpause + snap to bottom on the next frame so the
      // new pending-message render has landed in the DOM first.
      setPaused(false)
      requestAnimationFrame(() => {
        const el = scrollRef.current
        if (el) el.scrollTop = el.scrollHeight
      })
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

  // The pendingScrollAnchorRef is declared above next to messageLimit
  // so the sessionId reset effect can clear it. After a Load older click
  // captures { oldScrollHeight, oldScrollTop }, this effect restores
  // scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight) so
  // the same content stays visible. Without this, the auto-scroll
  // effect below would yank the user to the bottom of the conversation
  // every time they tried to read older context.

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const newOffset = data?.offset ?? 0
    const offsetDecreased = newOffset < prevOffsetRef.current
    prevOffsetRef.current = newOffset

    // Only consume the anchor when the offset has actually decreased
    // (== a Load older refetch landed). Without this gate, an SSE
    // update arriving between the user's click and the load-older
    // fetch would consume the anchor on the wrong render and produce
    // a small but visible scroll bounce.
    if (pendingScrollAnchorRef.current && offsetDecreased) {
      const { oldScrollHeight, oldScrollTop } = pendingScrollAnchorRef.current
      pendingScrollAnchorRef.current = null
      el.scrollTop = oldScrollTop + (el.scrollHeight - oldScrollHeight)
      return
    }

    if (!paused) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages.length, sessionUpdateVersion, paused, data?.offset])

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
        {hasOlderMessages && (
          <button
            type="button"
            onClick={() => {
              // Capture scroll anchor BEFORE the refetch so the
              // post-refetch effect can restore it (preserves the
              // user's reading position when older content loads).
              const el = scrollRef.current
              if (el) {
                pendingScrollAnchorRef.current = {
                  oldScrollHeight: el.scrollHeight,
                  oldScrollTop: el.scrollTop,
                }
              }
              setMessageLimit((n) => n + PAGE_SIZE)
            }}
            className="w-full py-2 mb-2 rounded border border-gray-800 bg-gray-900/40 text-[11px] text-gray-500 hover:text-gray-300 hover:border-gray-700 transition-colors"
            title={`Showing the last ${serverMessages.length} of ${totalMessageCount} messages — click to load older`}
          >
            Load {Math.min(PAGE_SIZE, olderRemaining)} older messages ({olderRemaining} remaining)
          </button>
        )}
        <MessageList messages={messages} toolNameMap={toolNameMap} isStreaming={isStreaming} />
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
