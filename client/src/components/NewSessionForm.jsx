import { useCallback, useMemo, useState } from 'react'
import { Folder } from 'lucide-react'
import { FolderPicker } from './FolderPicker.jsx'

export function NewSessionForm({ onCreated, sessions = [] }) {
  const [name, setName] = useState('')
  const [cwd, setCwd] = useState('')
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [mode, setMode] = useState('')
  const [worktree, setWorktree] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  const recentCwds = useMemo(() => {
    const seen = new Set()
    const ordered = [...sessions]
      .sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0))
      .map((s) => s.cwd)
      .filter((c) => {
        if (!c || seen.has(c)) return false
        seen.add(c)
        return true
      })
    return ordered.slice(0, 5)
  }, [sessions])

  const canSubmit = cwd.trim() && prompt.trim() && !creating

  const reset = () => {
    setName('')
    setCwd('')
    setPrompt('')
    setModel('')
    setMode('')
    setWorktree(false)
    setError(null)
  }

  const submit = useCallback(async () => {
    if (!canSubmit) return
    setCreating(true)
    setError(null)
    try {
      const body = { cwd: cwd.trim(), prompt: prompt.trim() }
      if (name.trim()) body.name = name.trim()
      if (worktree) body.worktree = true
      const options = {}
      if (model) options.model = model
      if (mode) options.permissionMode = mode
      if (Object.keys(options).length > 0) body.options = options

      const res = await fetch('/api/sessions/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError({
          detail: data.detail || data.error || `HTTP ${res.status}`,
          stderr: data.stderr || null,
          stdout: data.stdout || null,
        })
        return
      }
      reset()
      onCreated?.()
    } catch (e) {
      setError({ detail: e.message, stderr: null, stdout: null })
    } finally {
      setCreating(false)
    }
  }, [canSubmit, cwd, prompt, name, worktree, model, mode, onCreated])

  return (
    <div className="px-3 py-2 border-b border-gray-800 space-y-1.5 bg-gray-900/50">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Session name (optional)..."
        className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
      />
      <div className="relative">
        <input
          type="text"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder="Working directory..."
          className="w-full bg-gray-900 border border-gray-700 rounded pl-2 pr-7 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
        />
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          aria-label="Browse for folder"
          title="Browse for folder"
          className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-200 p-1 rounded"
        >
          <Folder size={12} />
        </button>
      </div>
      <input
        type="text"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Prompt..."
        className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
      />
      <div data-testid="new-session-selects" className="flex flex-col gap-1.5">
        <select
          aria-label="Model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded px-1.5 py-1 text-[11px] text-gray-400 focus:outline-none focus:border-indigo-500"
        >
          <option value="">Model...</option>
          <option value="sonnet">sonnet</option>
          <option value="opus">opus</option>
          <option value="haiku">haiku</option>
        </select>
        <select
          aria-label="Mode"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded px-1.5 py-1 text-[11px] text-gray-400 focus:outline-none focus:border-indigo-500"
        >
          <option value="">Mode...</option>
          <option value="plan">plan</option>
          <option value="auto">auto</option>
          <option value="default">default</option>
          <option value="acceptEdits">acceptEdits</option>
          <option value="dontAsk">dontAsk</option>
          <option value="bypassPermissions">bypassPermissions</option>
        </select>
      </div>
      <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer">
        <input
          type="checkbox"
          checked={worktree}
          onChange={(e) => setWorktree(e.target.checked)}
          className="rounded border-gray-700 bg-gray-900 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0"
        />
        Worktree (isolated copy)
      </label>
      {error && (
        <div className="text-[11px] text-red-400 bg-red-950/30 border border-red-900/50 rounded px-2 py-1 space-y-1">
          <div>{error.detail}</div>
          {error.stderr && (
            <pre
              data-testid="new-session-stderr"
              className="text-[10px] font-mono whitespace-pre-wrap text-red-300/80 max-h-32 overflow-auto"
            >
              {error.stderr}
            </pre>
          )}
          {error.stdout && (
            <pre
              data-testid="new-session-stdout"
              className="text-[10px] font-mono whitespace-pre-wrap text-red-300/80 max-h-32 overflow-auto"
            >
              {error.stdout}
            </pre>
          )}
        </div>
      )}
      <button
        onClick={submit}
        disabled={!canSubmit}
        className="w-full px-2 py-1 rounded bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        {creating ? 'Creating...' : 'Create Session'}
      </button>
      {pickerOpen && (
        <FolderPicker
          recentCwds={recentCwds}
          onSelect={(p) => setCwd(p)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}
