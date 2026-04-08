import path from 'path'
import { getAllSessions } from './sessions.js'

/**
 * Normalize a path for cross-platform comparison: forward slashes, drop trailing
 * separator, lower-case the drive letter on Windows so 'C:\foo' === 'c:/foo'.
 */
function normalizeDir(dir) {
  if (!dir) return null
  let p = dir.replace(/\\/g, '/').replace(/\/+$/, '')
  if (/^[a-zA-Z]:/.test(p)) p = p[0].toLowerCase() + p.slice(1)
  return p
}

function dirSlug(dir) {
  if (!dir) return '—'
  const parts = dir.split('/').filter(Boolean)
  return parts[parts.length - 1] || dir
}

/**
 * Group sessions by their direct parent directory.
 *
 * Rules:
 *   - A directory becomes a "manager" if 2+ session cwds share it as their
 *     immediate parent (path.dirname).
 *   - Sessions with no sibling under the same parent are returned in a
 *     `standalone` bucket so the UI can still surface them.
 *   - Each manager group reports aggregate stats (active/idle/done counts,
 *     total cost, last activity) for the drawer header.
 *
 * Output shape:
 *   {
 *     managers: [{
 *       id, dir, slug, childCount, activeCount, idleCount, doneCount,
 *       totalCost, lastModified, children: [Session, ...]
 *     }, ...],
 *     standalone: [Session, ...]
 *   }
 */
export function getManagers(sessions = getAllSessions()) {
  const groups = new Map()

  for (const session of sessions) {
    if (!session.cwd) continue
    // Normalize FIRST so the dirname call works against forward slashes.
    // path.dirname uses the host platform's separator: on Linux CI it's
    // path.posix which doesn't recognize backslashes, so 'C:\\foo\\bar'
    // would parse as a single filename and dirname would return '.',
    // collapsing every Windows-style cwd into one phantom group. Always
    // use path.posix.dirname against the normalized (forward-slash) form
    // to get cross-platform behavior.
    const normalized = normalizeDir(session.cwd)
    if (!normalized) continue
    const parent = path.posix.dirname(normalized)
    if (!parent || parent === '.') continue
    if (!groups.has(parent)) groups.set(parent, [])
    groups.get(parent).push(session)
  }

  const managers = []
  const standalone = []

  for (const [dir, children] of groups.entries()) {
    if (children.length < 2) {
      standalone.push(...children)
      continue
    }

    const sorted = children.sort((a, b) => b.lastModified - a.lastModified)
    const activeCount = sorted.filter((s) => s.isActive).length
    const idleCount = sorted.filter(
      (s) => !s.isActive && Date.now() - s.lastModified < 60 * 60 * 1000,
    ).length
    const doneCount = sorted.length - activeCount - idleCount
    const needsInputCount = sorted.filter((s) => s.needsInput).length
    const totalCost = sorted.reduce((sum, s) => sum + (s.estimatedCost?.totalCost || 0), 0)

    managers.push({
      id: dir,
      dir,
      slug: dirSlug(dir),
      childCount: sorted.length,
      activeCount,
      idleCount,
      doneCount,
      needsInputCount,
      totalCost,
      lastModified: sorted[0].lastModified,
      children: sorted.map((s) => ({
        sessionId: s.sessionId,
        cwd: s.cwd,
        slug: dirSlug(normalizeDir(s.cwd)),
        isActive: s.isActive,
        needsInput: s.needsInput,
        lastModified: s.lastModified,
        lastText: s.lastText,
        model: s.model,
        permissionMode: s.permissionMode,
        estimatedCost: s.estimatedCost,
      })),
    })
  }

  managers.sort((a, b) => b.lastModified - a.lastModified)

  return { managers, standalone }
}
