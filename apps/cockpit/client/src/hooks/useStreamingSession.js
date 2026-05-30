import { useState, useCallback, useEffect, useRef } from 'react'

export function useStreamingSession(selectedSessionId) {
  const [isStreaming, setIsStreaming] = useState(false)
  const [pendingApprovals, setPendingApprovals] = useState([])
  const [sdkError, setSdkError] = useState(null)
  const sessionIdRef = useRef(selectedSessionId)

  useEffect(() => {
    sessionIdRef.current = selectedSessionId
    // Clear streaming state when session changes
    setIsStreaming(false)
    setPendingApprovals([])
    setSdkError(null)
  }, [selectedSessionId])

  // Resync on mount / session change — check if a query is already active
  useEffect(() => {
    if (!selectedSessionId) return
    const capturedId = selectedSessionId
    fetch(`/api/sessions/${selectedSessionId}/query-status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        // Guard against stale response after quick session switch
        if (sessionIdRef.current !== capturedId) return
        if (data?.active) {
          setIsStreaming(true)
          setPendingApprovals(data.pendingApprovals || [])
        }
      })
      .catch(() => {})
  }, [selectedSessionId])

  // Called from App's SSE handler with SDK events
  const handleSdkEvent = useCallback((evt) => {
    const { type, data } = evt
    if (!data?.sessionId || data.sessionId !== sessionIdRef.current) return

    if (type === 'sdk_message') {
      setIsStreaming(true)
    } else if (type === 'tool_approval_request') {
      setPendingApprovals((prev) => [
        ...prev,
        {
          approvalId: data.approvalId,
          toolName: data.toolName,
          input: data.input,
        },
      ])
    } else if (type === 'tool_approval_resolved') {
      setPendingApprovals((prev) => prev.filter((a) => a.approvalId !== data.approvalId))
    } else if (type === 'sdk_result') {
      setIsStreaming(false)
      setPendingApprovals([])
      setSdkError(null)
    } else if (type === 'sdk_error') {
      setIsStreaming(false)
      setPendingApprovals([])
      setSdkError({
        message: data.error,
        errorType: data.errorType || 'query_failed',
      })
    }
  }, [])

  const approve = useCallback(async (approvalId) => {
    try {
      const res = await fetch(`/api/sessions/${sessionIdRef.current}/tool-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalId, decision: 'allow' }),
      })
      // Optimistic removal if server says approval is gone (404 = already resolved)
      if (!res.ok) {
        setPendingApprovals((prev) => prev.filter((a) => a.approvalId !== approvalId))
      }
    } catch (err) {
      console.warn('Approval failed:', err.message)
      // Remove stale banner on network error to prevent permanent stuck state
      setPendingApprovals((prev) => prev.filter((a) => a.approvalId !== approvalId))
    }
  }, [])

  const deny = useCallback(async (approvalId) => {
    try {
      const res = await fetch(`/api/sessions/${sessionIdRef.current}/tool-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalId, decision: 'deny' }),
      })
      if (!res.ok) {
        setPendingApprovals((prev) => prev.filter((a) => a.approvalId !== approvalId))
      }
    } catch (err) {
      console.warn('Denial failed:', err.message)
      setPendingApprovals((prev) => prev.filter((a) => a.approvalId !== approvalId))
    }
  }, [])

  const cancel = useCallback(async () => {
    try {
      await fetch(`/api/sessions/${sessionIdRef.current}/cancel`, {
        method: 'POST',
      })
    } catch (err) {
      console.warn('Cancel failed:', err.message)
    }
  }, [])

  // Allow parent to mark streaming started (bridges the gap between POST 202 and first SSE)
  const markStreaming = useCallback(() => setIsStreaming(true), [])

  const clearError = useCallback(() => setSdkError(null), [])

  return {
    isStreaming,
    pendingApprovals,
    sdkError,
    handleSdkEvent,
    approve,
    deny,
    cancel,
    markStreaming,
    clearError,
  }
}
