import { useState } from 'react'
import { Clipboard, Check, Package, Zap, Search, ChevronDown, ChevronUp } from 'lucide-react'

function SkillCard({ skill }) {
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)

  function handleCopy() {
    const text = skill.command + (skill.argumentHint ? ' ' : '')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div
      className={`bg-gray-900 border rounded p-2 flex flex-col gap-1 transition-colors ${expanded ? 'border-gray-700 col-span-2' : 'border-gray-800'}`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="font-mono text-xs text-cyan-300 leading-tight break-all">{skill.command}</span>
        <button
          onClick={handleCopy}
          className="shrink-0 text-gray-600 hover:text-gray-400 transition-colors mt-0.5"
          title="Copy command"
        >
          {copied ? <Check size={11} className="text-green-400" /> : <Clipboard size={11} />}
        </button>
      </div>
      {skill.description && (
        <p className="text-[10px] text-gray-400 leading-snug">{skill.description}</p>
      )}
      {skill.argumentHint && (
        <span className="text-[10px] text-gray-600 italic">{skill.argumentHint}</span>
      )}
      {skill.body && (
        <button
          onClick={() => setExpanded(e => !e)}
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
    </div>
  )
}

function SkillSection({ title, skills }) {
  if (skills.length === 0) return null
  return (
    <div className="mb-4">
      <div className="px-4 py-1.5 text-[10px] font-semibold text-gray-600 uppercase tracking-wider">
        {title} ({skills.length})
      </div>
      <div className="px-4 grid grid-cols-2 gap-2">
        {skills.map(skill => (
          <SkillCard key={skill.command} skill={skill} />
        ))}
      </div>
    </div>
  )
}

export function SkillsPanel({ skills, loading }) {
  const [query, setQuery] = useState('')
  const [filterKey, setFilterKey] = useState('all')

  if (loading) {
    return <div className="p-4 text-gray-600 text-xs">Loading skills...</div>
  }

  if (!skills) {
    return <div className="p-4 text-gray-600 text-xs">No skills data.</div>
  }

  const { userSkills = [], plugins = [], totalSkillCount = 0 } = skills

  function matchesQuery(skill) {
    if (!query) return true
    const q = query.toLowerCase()
    return (
      skill.name?.toLowerCase().includes(q) ||
      skill.description?.toLowerCase().includes(q)
    )
  }

  const filteredUser = userSkills.filter(s =>
    (filterKey === 'all' || filterKey === 'user') && matchesQuery(s)
  )

  const filteredPlugins = plugins.map(plugin => ({
    ...plugin,
    skills: plugin.skills.filter(s =>
      (filterKey === 'all' || filterKey === plugin.key) && matchesQuery(s)
    ),
  })).filter(p => p.skills.length > 0)

  const hasResults = filteredUser.length > 0 || filteredPlugins.length > 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <Zap size={13} className="text-yellow-400" />
          <span className="text-sm font-semibold text-gray-200">Skills</span>
          <span className="text-xs text-gray-600">· {totalSkillCount} skills</span>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-600" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search skills..."
              className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 pl-6 text-xs text-gray-300 placeholder-gray-700 focus:outline-none focus:border-gray-700"
            />
          </div>
          <select
            value={filterKey}
            onChange={e => setFilterKey(e.target.value)}
            className="bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs text-gray-400 focus:outline-none focus:border-gray-700"
          >
            <option value="all">All</option>
            {userSkills.length > 0 && <option value="user">User Skills</option>}
            {plugins.map(p => (
              <option key={p.key} value={p.key}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto py-2">
        {!hasResults ? (
          <div className="px-4 py-8 text-center text-xs text-gray-600">
            {query ? `No skills match "${query}"` : 'No skills found.'}
          </div>
        ) : (
          <>
            {filteredUser.length > 0 && (
              <SkillSection title="User Skills" skills={filteredUser} />
            )}
            {filteredPlugins.map(plugin => (
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
                  {plugin.skills.map(skill => (
                    <SkillCard key={skill.command} skill={skill} />
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
