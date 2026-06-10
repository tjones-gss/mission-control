import { useEffect, useCallback, useState } from 'react'

const STORAGE_KEY = 'oversight.shortcuts'

const DEFAULT_SHORTCUTS = {
  nextSession: 'j',
  prevSession: 'k',
  openDetail: 'Enter',
  backToBoard: 'Escape',
  tabAgents: '1',
  tabTasks: '2',
  tabWorkflows: '3',
  tabSkills: '4',
  tabMissionControl: '5',
  quickApprove: 'y',
  quickContinue: 'c',
  focusInput: '/',
  showHelp: '?',
  toggleSettings: ',',
  toggleMute: 'm',
  toggleDispatch: 'd',
  commandPalette: 'Ctrl+k',
}

const ACTION_LABELS = {
  nextSession: 'Next session',
  prevSession: 'Previous session',
  openDetail: 'Open detail view',
  backToBoard: 'Back to board',
  tabAgents: 'Agents tab',
  tabTasks: 'Tasks tab',
  tabWorkflows: 'Workflows tab',
  tabSkills: 'Skills tab',
  tabMissionControl: 'Runs tab',
  quickApprove: 'Approve (send "yes")',
  quickContinue: 'Continue session',
  focusInput: 'Focus message input',
  showHelp: 'Show shortcut help',
  toggleSettings: 'Open settings',
  toggleMute: 'Mute session',
  toggleDispatch: 'Open dispatch manager',
  commandPalette: 'Open command palette',
}

function loadShortcuts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_SHORTCUTS, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SHORTCUTS }
}

function saveShortcuts(shortcuts) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(shortcuts))
}

function keyMatchesBinding(e, binding) {
  if (!binding) return false
  const parts = binding.split('+')
  const key = parts.pop()
  const needCtrl = parts.includes('Ctrl')
  const needShift = parts.includes('Shift')
  const needAlt = parts.includes('Alt')

  // Cmd (metaKey) counts as the Ctrl modifier so 'Ctrl+k' bindings work as
  // ⌘K on macOS. This also stops unmodified bindings (e.g. plain 'j') from
  // firing while Cmd/Ctrl is held.
  if (needCtrl !== (e.ctrlKey || e.metaKey)) return false
  if (needAlt !== e.altKey) return false

  // For printable characters that require Shift to type (e.g. '?', '!', '+'),
  // the browser sets e.shiftKey=true automatically. Only enforce the Shift
  // check when the binding explicitly includes 'Shift+' or the key is a
  // simple letter/number where Shift would change the meaning.
  const isPlainKey = /^[a-zA-Z0-9]$/.test(key)
  if (isPlainKey || needShift) {
    if (needShift !== e.shiftKey) return false
  }

  return e.key === key
}

export function useKeyboardShortcuts(handlers) {
  const [shortcuts, setShortcuts] = useState(loadShortcuts)

  useEffect(() => {
    const onKeyDown = (e) => {
      // Ignore when typing in inputs — except Escape and Ctrl/Cmd-modified
      // combos (e.g. Ctrl+K toggles the command palette even mid-typing).
      const tag = e.target.tagName
      const isEditable =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable
      if (isEditable && e.key !== 'Escape' && !e.ctrlKey && !e.metaKey) return

      for (const [action, binding] of Object.entries(shortcuts)) {
        if (keyMatchesBinding(e, binding)) {
          const handler = handlers[action]
          if (handler) {
            e.preventDefault()
            handler()
          }
          return
        }
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [shortcuts, handlers])

  // Returns the list of action names whose bindings were cleared because
  // they conflicted with the new key. Callers can use this to surface a
  // "X was unbound" notice — the previous behavior silently dropped the
  // conflicting binding with zero user feedback.
  const updateShortcut = useCallback((action, newKey) => {
    let cleared = []
    setShortcuts((prev) => {
      const next = { ...prev }
      for (const [existingAction, existingKey] of Object.entries(next)) {
        if (existingAction !== action && existingKey === newKey && existingKey !== '') {
          next[existingAction] = ''
          cleared.push(existingAction)
        }
      }
      next[action] = newKey
      saveShortcuts(next)
      return next
    })
    return cleared
  }, [])

  const resetDefaults = useCallback(() => {
    setShortcuts({ ...DEFAULT_SHORTCUTS })
    saveShortcuts(DEFAULT_SHORTCUTS)
  }, [])

  return { shortcuts, updateShortcut, resetDefaults }
}

export { DEFAULT_SHORTCUTS, ACTION_LABELS }
