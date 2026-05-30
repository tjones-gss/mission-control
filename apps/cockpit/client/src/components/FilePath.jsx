import { useState } from 'react'
import { ExternalLink, Copy, Check } from 'lucide-react'
import { makeVscodeUrl } from '../utils/filePaths.js'

function truncateMiddle(str, maxLen = 60) {
  if (str.length <= maxLen) return str
  const half = Math.floor((maxLen - 3) / 2)
  return str.slice(0, half) + '...' + str.slice(-half)
}

export function FilePath({ path, line, className = '' }) {
  const [copied, setCopied] = useState(false)
  const url = makeVscodeUrl(path, line)
  const display = truncateMiddle(path)

  const handleCopy = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const text = line ? `${path}:${line}` : path
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <span className={`inline-flex items-center gap-1 group ${className}`}>
      <a
        href={url}
        className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 decoration-cyan-800 hover:decoration-cyan-500 transition-colors font-mono text-[11px]"
        title={line ? `${path}:${line}` : path}
        onClick={(e) => {
          // Allow default behavior for vscode:// links
        }}
      >
        {display}
        {line && <span className="text-gray-500 ml-0.5">:{line}</span>}
      </a>
      <button
        onClick={handleCopy}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-600 hover:text-gray-400 p-0.5"
        title="Copy path"
      >
        {copied ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
      </button>
      <a
        href={url}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-600 hover:text-cyan-400 p-0.5"
        title="Open in VS Code"
      >
        <ExternalLink size={10} />
      </a>
    </span>
  )
}
