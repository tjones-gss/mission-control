import { useState } from 'react'
import { Send } from 'lucide-react'

export function TeamComposeInput({ teamName, onSent }) {
  const [content, setContent] = useState('')
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)

  async function handleSend() {
    if (!content.trim()) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/teams/${teamName}/inbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.trim() }),
      })
      if (!res.ok) throw new Error('Failed to send')
      const msg = await res.json()
      setContent('')
      onSent?.(msg)
    } catch {
      setError('Failed to send message')
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  return (
    <div className="border-t border-gray-800 p-3 shrink-0">
      {error && <p className="text-xs text-red-400 mb-1">{error}</p>}
      <div className="flex gap-2">
        <input
          type="text"
          value={content}
          onChange={e => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Message ${teamName}...`}
          className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-600"
        />
        <button
          onClick={handleSend}
          disabled={sending || !content.trim()}
          aria-label="Send"
          className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed rounded text-xs text-gray-200 transition-colors"
        >
          <Send size={11} /> Send
        </button>
      </div>
    </div>
  )
}
