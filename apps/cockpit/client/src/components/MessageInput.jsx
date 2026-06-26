import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Send, Info, X, ImagePlus } from 'lucide-react'

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
    <div className="absolute bottom-full left-0 right-0 mb-1 bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-h-48 overflow-y-auto z-dropdown">
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

const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB
const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

export function MessageInput({
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
