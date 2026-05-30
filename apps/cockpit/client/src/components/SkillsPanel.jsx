import { useState } from 'react'
import { Clipboard, Check, Package, Zap, Search, ChevronDown, ChevronUp, Plus } from 'lucide-react'

function SkillCard({ skill, refetch }) {
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  // edit state
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState(null)
  // delete state
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  function handleCopy() {
    const text = skill.command + (skill.argumentHint ? ' ' : '')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  async function handleEditOpen() {
    setEditError(null)
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skill.name)}/raw`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      setEditContent(text)
      setEditing(true)
    } catch (e) {
      setEditError(e.message)
    }
  }

  async function handleSave() {
    setSaving(true)
    setEditError(null)
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skill.name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setEditing(false)
      refetch()
    } catch (e) {
      setEditError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skill.name)}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      refetch()
    } catch (e) {
      setEditError(e.message)
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  // The Edit/Delete buttons hit /api/skills/<name> which only resolves
  // paths under ~/.claude/skills/. User commands live in ~/.claude/commands/
  // and don't have a CRUD endpoint yet, so they're read-only for now even
  // though they're "user-authored". Plugin skills are always read-only
  // because they live in plugin caches.
  const isUser = skill.source === 'user'

  // Per-source scope badge: tells the user at a glance whether this
  // entry came from their skills dir, their commands dir, or a plugin.
  // Previously the only signal was a tiny "(read-only)" italic label,
  // and there was no way to distinguish a user skill from a user command.
  const scopeBadge =
    skill.source === 'user'
      ? { label: 'skill', cls: 'bg-cyan-900/40 text-cyan-300 border-cyan-800' }
      : skill.source === 'user-command'
        ? { label: 'cmd', cls: 'bg-purple-900/40 text-purple-300 border-purple-800' }
        : skill.pluginKey
          ? {
              label: skill.pluginKey.split('@')[0].split('/').pop(),
              cls: 'bg-gray-800 text-gray-500 border-gray-700',
            }
          : { label: 'plugin', cls: 'bg-gray-800 text-gray-500 border-gray-700' }

  return (
    <div
      className={`bg-gray-900 border rounded p-2 flex flex-col gap-1 transition-colors ${expanded || editing ? 'border-gray-700 col-span-2' : 'border-gray-800'}`}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-mono text-xs text-cyan-300 leading-tight break-all">
            {skill.command}
          </span>
          <span
            className={`shrink-0 text-[9px] uppercase tracking-wide font-medium px-1 py-px rounded border ${scopeBadge.cls}`}
            title={`Source: ${skill.source}${skill.pluginKey ? ` (${skill.pluginKey})` : ''}`}
          >
            {scopeBadge.label}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0 mt-0.5">
          {!isUser && <span className="text-[9px] text-gray-600 italic">(read-only)</span>}
          {isUser && !editing && (
            <button
              onClick={handleEditOpen}
              className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition-colors"
              title="Edit skill"
            >
              Edit
            </button>
          )}
          {isUser && !confirmDelete && !editing && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 hover:bg-red-900/50 hover:text-red-400 transition-colors"
              title="Delete skill"
            >
              ✕
            </button>
          )}
          <button
            onClick={handleCopy}
            className="text-gray-600 hover:text-gray-400 transition-colors"
            title="Copy command"
          >
            {copied ? <Check size={11} className="text-green-400" /> : <Clipboard size={11} />}
          </button>
        </div>
      </div>

      {editError && <p className="text-[10px] text-red-400">{editError}</p>}

      {confirmDelete && !editing && (
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] text-red-400">Delete this skill?</span>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/60 text-red-300 hover:bg-red-900 transition-colors disabled:opacity-50"
          >
            {deleting ? '...' : 'Yes'}
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            disabled={deleting}
            className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            No
          </button>
        </div>
      )}

      {editing && (
        <div className="flex flex-col gap-1 mt-1">
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={8}
            className="bg-gray-900 border border-gray-700 rounded p-2 text-xs text-gray-300 font-mono w-full resize-y focus:outline-none focus:border-gray-600"
          />
          <div className="flex gap-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900/50 text-cyan-300 hover:bg-cyan-900 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => {
                setEditing(false)
                setEditError(null)
              }}
              disabled={saving}
              className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!editing && (
        <>
          {skill.description && (
            <p className="text-[10px] text-gray-400 leading-snug">{skill.description}</p>
          )}
          {skill.argumentHint && (
            <span className="text-[10px] text-gray-600 italic">{skill.argumentHint}</span>
          )}
          {skill.body && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className={`mt-1 flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded transition-colors self-start ${
                expanded
                  ? 'bg-cyan-900/40 text-cyan-400 hover:bg-cyan-900/60'
                  : 'bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-gray-300'
              }`}
            >
              {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              {expanded ? 'Hide full skill' : 'View full skill'}
            </button>
          )}
          {expanded && skill.body && (
            <pre className="mt-1 text-[10px] text-gray-500 whitespace-pre-wrap leading-relaxed border-t border-gray-800 pt-2 font-mono overflow-x-auto">
              {skill.body}
            </pre>
          )}
        </>
      )}
    </div>
  )
}

function SkillSection({ title, skills, refetch }) {
  if (skills.length === 0) return null
  return (
    <div className="mb-4">
      <div className="px-4 py-1.5 text-[10px] font-semibold text-gray-600 uppercase tracking-wider">
        {title} ({skills.length})
      </div>
      <div className="px-4 grid grid-cols-2 gap-2">
        {skills.map((skill) => (
          <SkillCard key={skill.command} skill={skill} refetch={refetch} />
        ))}
      </div>
    </div>
  )
}

function NewSkillForm({ onSaved, onCancel }) {
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSave() {
    setError(null)
    if (!name.trim()) return setError('Name is required.')
    setSaving(true)
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), content }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-4 mb-4 bg-gray-900 border border-gray-700 rounded p-3 flex flex-col gap-2">
      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
        New Skill
      </span>
      {error && <p className="text-[10px] text-red-400">{error}</p>}
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="skill-name (letters, digits, _ : -)"
        className="bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 font-mono focus:outline-none focus:border-gray-600 placeholder-gray-700"
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Skill markdown content..."
        rows={8}
        className="bg-gray-900 border border-gray-700 rounded p-2 text-xs text-gray-300 font-mono w-full resize-y focus:outline-none focus:border-gray-600 placeholder-gray-700"
      />
      <div className="flex gap-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900/50 text-cyan-300 hover:bg-cyan-900 transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export function SkillsPanel({ skills, loading, refetch }) {
  const [query, setQuery] = useState('')
  const [filterKey, setFilterKey] = useState('all')
  const [showNewForm, setShowNewForm] = useState(false)

  if (loading) {
    return <div className="p-4 text-gray-600 text-xs">Loading skills...</div>
  }

  if (!skills) {
    return <div className="p-4 text-gray-600 text-xs">No skills data.</div>
  }

  const { userSkills = [], userCommands = [], plugins = [], totalSkillCount = 0 } = skills

  function matchesQuery(skill) {
    if (!query) return true
    const q = query.toLowerCase()
    return skill.name?.toLowerCase().includes(q) || skill.description?.toLowerCase().includes(q)
  }

  const filteredUser = userSkills.filter(
    (s) => (filterKey === 'all' || filterKey === 'user') && matchesQuery(s),
  )

  const filteredCommands = userCommands.filter(
    (s) => (filterKey === 'all' || filterKey === 'commands') && matchesQuery(s),
  )

  const filteredPlugins = plugins
    .map((plugin) => ({
      ...plugin,
      skills: plugin.skills.filter(
        (s) => (filterKey === 'all' || filterKey === plugin.key) && matchesQuery(s),
      ),
    }))
    .filter((p) => p.skills.length > 0)

  const hasResults =
    filteredUser.length > 0 || filteredCommands.length > 0 || filteredPlugins.length > 0

  function handleNewSaved() {
    setShowNewForm(false)
    refetch()
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <Zap size={13} className="text-yellow-400" />
          <span className="text-sm font-semibold text-gray-200">Skills</span>
          <span className="text-xs text-gray-600">· {totalSkillCount} skills</span>
          <button
            onClick={() => setShowNewForm((v) => !v)}
            className="ml-auto flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition-colors"
            title="Create new skill"
          >
            <Plus size={10} />
            New Skill
          </button>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-600" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search skills..."
              className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 pl-6 text-xs text-gray-300 placeholder-gray-700 focus:outline-none focus:border-gray-700"
            />
          </div>
          <select
            value={filterKey}
            onChange={(e) => setFilterKey(e.target.value)}
            className="bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs text-gray-400 focus:outline-none focus:border-gray-700"
          >
            <option value="all">All</option>
            {userSkills.length > 0 && <option value="user">User Skills</option>}
            {userCommands.length > 0 && <option value="commands">User Commands</option>}
            {plugins.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto py-2">
        {showNewForm && (
          <NewSkillForm onSaved={handleNewSaved} onCancel={() => setShowNewForm(false)} />
        )}
        {!hasResults ? (
          <div className="px-4 py-8 text-center text-xs text-gray-600">
            {query ? `No skills match "${query}"` : 'No skills found.'}
          </div>
        ) : (
          <>
            {filteredUser.length > 0 && (
              <SkillSection title="User Skills" skills={filteredUser} refetch={refetch} />
            )}
            {filteredCommands.length > 0 && (
              <SkillSection title="User Commands" skills={filteredCommands} refetch={refetch} />
            )}
            {filteredPlugins.map((plugin) => (
              <div key={plugin.key} className="mb-4">
                <div className="px-4 py-1.5 flex items-center gap-1.5">
                  <Package size={11} className="text-gray-600" />
                  <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider">
                    {plugin.name}
                  </span>
                  {plugin.version && (
                    <span className="text-[10px] text-gray-700">v{plugin.version}</span>
                  )}
                  <span className="text-[10px] text-gray-700">({plugin.skills.length})</span>
                </div>
                <div className="px-4 grid grid-cols-2 gap-2">
                  {plugin.skills.map((skill) => (
                    <SkillCard key={skill.command} skill={skill} refetch={refetch} />
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
