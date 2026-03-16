import { useEffect, useCallback, useState } from 'react'

const STORAGE_KEY = 'oversight.shortcuts'

const DEFAULT_SHORTCUTS = {
  nextSession:    'j',
  prevSession:    'k',
  openDetail:     'Enter',
  backToBoard:    'Escape',
  tabAgents:      '1',
  tabTasks:       '2',
  tabWorkflows:   '3',
  tabSkills:      '4',
  quickApprove:   'y',
  quickContinue:  'c',
  focusInput:     '/',
  showHelp:       '?',
  toggleSettings: ',',
  toggleMute:     'm',
}

const ACTION_LABELS = {
  nextSession:    'Next session',
  prevSession:    'Previous session',
  openDetail:     'Open detail view',
  backToBoard:    'Back to board',
  tabAgents:      'Agents tab',
  tabTasks:       'Tasks tab',
  tabWorkflows:   'Workflows tab',
  tabSkills:      'Skills tab',
  quickApprove:   'Approve (send "yes")',
  quickContinue:  'Continue session',
  focusInput:     'Focus message input',
  showHelp:       'Show shortcut help',
  toggleSettings: 'Open settings',
  toggleMute:     'Mute session',
}

function loadShortcuts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_SHORTCUTS, ...JSON.parse(raw) }
  } catch { /* ignore */ }
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

  if (needCtrl !== e.ctrlKey) return false
  if (needShift !== e.shiftKey) return false
  if (needAlt !== e.altKey) return false

  return e.key === key
}

export function useKeyboardShortcuts(handlers) {
  const [shortcuts, setShortcuts] = useState(loadShortcuts)

  useEffect(() => {
    const onKeyDown = (e) => {
      // Ignore when typing in inputs (except Escape)
      const tag = e.target.tagName
      const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable
      if (isEditable && e.key !== 'Escape') return

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

  const updateShortcut = useCallback((action, newKey) => {
    setShortcuts(prev => {
      // Detect conflicts: if another action already uses this key, clear it
      const next = { ...prev }
      for (const [existingAction, existingKey] of Object.entries(next)) {
        if (existingAction !== action && existingKey === newKey) {
          next[existingAction] = ''
        }
      }
      next[action] = newKey
      saveShortcuts(next)
      return next
    })
  }, [])

  const resetDefaults = useCallback(() => {
    setShortcuts({ ...DEFAULT_SHORTCUTS })
    saveShortcuts(DEFAULT_SHORTCUTS)
  }, [])

  return { shortcuts, updateShortcut, resetDefaults }
}

export { DEFAULT_SHORTCUTS, ACTION_LABELS }
