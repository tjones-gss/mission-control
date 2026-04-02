// Match absolute file paths (Unix and Windows)
// - Unix: /home/user/file.js, /tmp/foo.txt
// - Windows: C:\Users\file.js, C:/Users/file.js
// Optionally followed by :lineNumber
const FILE_PATH_RE = /(?:(?:[A-Za-z]:[\\/]|\/(?:home|Users|tmp|var|etc|opt|usr|mnt|srv|root|c\/Users))[^\s"'`,;)}\]>]+)/g

export function extractFilePaths(text) {
  if (!text) return []
  const matches = []
  let match

  FILE_PATH_RE.lastIndex = 0
  while ((match = FILE_PATH_RE.exec(text)) !== null) {
    let path = match[0]
    // Strip trailing punctuation that's not part of the path
    path = path.replace(/[.:,;!?)}\]]+$/, '')

    // Extract optional :lineNumber suffix
    let line = null
    const lineMatch = path.match(/:(\d+)$/)
    if (lineMatch) {
      line = parseInt(lineMatch[1], 10)
      path = path.slice(0, -lineMatch[0].length)
    }

    // Skip URLs
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('ftp://')) continue

    matches.push({
      path,
      line,
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  return matches
}

export function makeVscodeUrl(filePath, line) {
  // Normalize backslashes to forward slashes for the URI
  const normalized = filePath.replace(/\\/g, '/')
  const uri = `vscode://file/${normalized}`
  return line ? `${uri}:${line}` : uri
}
