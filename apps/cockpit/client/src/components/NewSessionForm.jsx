import { useCallback, useMemo, useState } from 'react'
import { Folder, Search } from 'lucide-react'
import { FolderPicker } from './FolderPicker.jsx'

function projectLabel(cwd) {
  if (!cwd) return ''
  const parts = String(cwd).split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || cwd
}

export function NewSessionForm({ onCreated, sessions = [] }) {
  const [name, setName] = useState('')
  const [cwd, setCwd] = useState('')
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [mode, setMode] = useState('')
  const [worktree, setWorktree] = useState(false)
  const [creating, setCreating] = useState(false)
  const [nativePicking, setNativePicking] = useState(false)
  const [error, setError] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [cwdMenuOpen, setCwdMenuOpen] = useState(false)
  // Roving highlight for the cwd suggestion popup (combobox keyboard support).
  const [cwdActiveIdx, setCwdActiveIdx] = useState(-1)

  const safeSessions = Array.isArray(sessions) ? sessions : []

  const recentCwds = useMemo(() => {
    const seen = new Set()
    const ordered = [...safeSessions]
      .sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0))
      .map((s) => s.cwd)
      .filter((c) => {
        if (!c || seen.has(c)) return false
        seen.add(c)
        return true
      })
    return ordered.slice(0, 8)
  }, [safeSessions])

  const cwdOptions = useMemo(() => {
    const query = cwd.trim().toLowerCase()
    const options = query
      ? recentCwds.filter((candidate) => candidate.toLowerCase().includes(query))
      : recentCwds
    return options.slice(0, 6)
  }, [cwd, recentCwds])

  const canSubmit = cwd.trim() && prompt.trim() && !creating

  const chooseCwd = (next) => {
    setCwd(next)
    setCwdMenuOpen(false)
    setCwdActiveIdx(-1)
  }

  const reset = () => {
    setName('')
    setCwd('')
    setPrompt('')
    setModel('')
    setMode('')
    setWorktree(false)
    setError(null)
  }

  const browseForFolder = useCallback(async () => {
    setCwdMenuOpen(false)
    setNativePicking(true)
    try {
      const res = await fetch('/api/fs/pick-directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: cwd.trim() || recentCwds[0] || '' }),
      })
      if (res.status === 204) return
      // 409: a native dialog is already open on this machine — don't stack
      // the in-app fallback on top of it.
      if (res.status === 409) return
      if (res.status === 501) {
        setPickerOpen(true)
        return
      }
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.path) {
        setCwd(data.path)
        return
      }
      setPickerOpen(true)
    } catch {
      setPickerOpen(true)
    } finally {
      setNativePicking(false)
    }
  }, [cwd, recentCwds])

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
      const data = await res.json().catch(() => ({}))
      reset()
      if (res.status === 202 && data.pendingSessionId) {
        onCreated?.({ pendingSessionId: data.pendingSessionId })
      } else {
        onCreated?.()
      }
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
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wide text-[var(--mc-fg-5)]">
            Project path
          </span>
          {recentCwds.length > 0 && (
            <span className="text-[10px] text-[var(--mc-fg-5)]">{recentCwds.length} recent</span>
          )}
        </div>
        <div className="relative">
          <Search
            size={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--mc-fg-5)]"
          />
          <input
            type="text"
            value={cwd}
            onFocus={() => setCwdMenuOpen(true)}
            onChange={(e) => {
              setCwd(e.target.value)
              setCwdMenuOpen(true)
              setCwdActiveIdx(-1)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setCwdMenuOpen(false)
                setCwdActiveIdx(-1)
              } else if (e.key === 'ArrowDown' && cwdOptions.length > 0) {
                e.preventDefault()
                setCwdMenuOpen(true)
                setCwdActiveIdx((i) => (i + 1) % cwdOptions.length)
              } else if (e.key === 'ArrowUp' && cwdOptions.length > 0) {
                e.preventDefault()
                setCwdMenuOpen(true)
                setCwdActiveIdx((i) => (i <= 0 ? cwdOptions.length - 1 : i - 1))
              } else if (e.key === 'Enter' && cwdMenuOpen && cwdOptions.length > 0) {
                // Pick the highlighted suggestion; with no highlight fall back
                // to the first one, but only while there's no prompt yet so
                // Enter still submits a fully filled form.
                if (cwdActiveIdx >= 0) {
                  e.preventDefault()
                  chooseCwd(cwdOptions[cwdActiveIdx])
                } else if (!prompt.trim()) {
                  e.preventDefault()
                  chooseCwd(cwdOptions[0])
                }
              }
            }}
            placeholder="Working directory: search recent projects or paste a path..."
            role="combobox"
            aria-label="Project path"
            aria-expanded={cwdMenuOpen}
            aria-controls="new-session-cwd-options"
            aria-activedescendant={
              cwdMenuOpen && cwdActiveIdx >= 0
                ? `new-session-cwd-option-${cwdActiveIdx}`
                : undefined
            }
            className="w-full bg-[var(--mc-surface)] border border-[var(--mc-border-2)] rounded pl-7 pr-8 py-1.5 text-xs text-[var(--mc-fg-2)] placeholder-[var(--mc-fg-5)] focus:outline-none focus:border-[var(--mc-accent)]"
          />
          <button
            type="button"
            onClick={browseForFolder}
            disabled={nativePicking}
            aria-label="Browse for folder"
            title="Open file explorer"
            className="absolute right-1 top-1/2 -translate-y-1/2 text-[var(--mc-fg-4)] hover:text-[var(--mc-fg-2)] p-1 rounded"
          >
            <Folder size={12} />
          </button>
          {cwdMenuOpen && cwdOptions.length > 0 && (
            <div
              id="new-session-cwd-options"
              role="listbox"
              aria-label="Recent project paths"
              className="absolute left-0 right-0 top-full z-dropdown mt-1 max-h-48 overflow-y-auto rounded border border-[var(--mc-border-2)] bg-[var(--mc-bg)] shadow-xl"
            >
              {cwdOptions.map((option, idx) => (
                <div
                  key={option}
                  id={`new-session-cwd-option-${idx}`}
                  role="option"
                  aria-selected={idx === cwdActiveIdx}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => chooseCwd(option)}
                  className={`flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left hover:bg-[var(--mc-surface)] ${
                    idx === cwdActiveIdx ? 'bg-[var(--mc-accent-soft)]' : ''
                  }`}
                  title={option}
                >
                  <Folder size={12} className="shrink-0 text-[var(--mc-fg-5)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-[var(--mc-fg-2)]">
                      {projectLabel(option)}
                    </span>
                    <span className="block truncate text-[10px] text-[var(--mc-fg-5)]">
                      {option}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        {recentCwds.length === 0 && (
          <div className="text-[10px] text-[var(--mc-fg-5)]">
            Start with a folder you already use for this project, or browse from Home.
          </div>
        )}
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
