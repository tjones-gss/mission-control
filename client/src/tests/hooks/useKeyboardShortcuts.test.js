import { renderHook, act } from '@testing-library/react'
import {
  useKeyboardShortcuts,
  DEFAULT_SHORTCUTS,
  ACTION_LABELS,
} from '../../hooks/useKeyboardShortcuts.js'

beforeEach(() => {
  localStorage.clear()
})

function fireKey(key, opts = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: opts.ctrlKey || false,
    shiftKey: opts.shiftKey || false,
    altKey: opts.altKey || false,
  })
  document.dispatchEvent(event)
  return event
}

function fireKeyOnElement(element, key, opts = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: opts.ctrlKey || false,
    shiftKey: opts.shiftKey || false,
    altKey: opts.altKey || false,
  })
  Object.defineProperty(event, 'target', { value: element })
  document.dispatchEvent(event)
  return event
}

// ─── Exports ────────────────────────────────────────────────────────────────

describe('exports', () => {
  it('exports DEFAULT_SHORTCUTS with all 15 actions', () => {
    expect(Object.keys(DEFAULT_SHORTCUTS)).toHaveLength(15)
    expect(DEFAULT_SHORTCUTS.nextSession).toBe('j')
    expect(DEFAULT_SHORTCUTS.prevSession).toBe('k')
    expect(DEFAULT_SHORTCUTS.quickApprove).toBe('y')
    expect(DEFAULT_SHORTCUTS.toggleDispatch).toBe('d')
  })

  it('exports ACTION_LABELS for all actions', () => {
    for (const key of Object.keys(DEFAULT_SHORTCUTS)) {
      expect(ACTION_LABELS[key]).toBeDefined()
    }
  })
})

// ─── Basic shortcut handling ────────────────────────────────────────────────

describe('useKeyboardShortcuts — key handling', () => {
  it('calls handler when matching key is pressed', () => {
    const handlers = { nextSession: vi.fn(), prevSession: vi.fn() }
    renderHook(() => useKeyboardShortcuts(handlers))

    act(() => {
      fireKey('j')
    })
    expect(handlers.nextSession).toHaveBeenCalledTimes(1)
    expect(handlers.prevSession).not.toHaveBeenCalled()
  })

  it('calls prevSession handler on k press', () => {
    const handlers = { prevSession: vi.fn() }
    renderHook(() => useKeyboardShortcuts(handlers))

    act(() => {
      fireKey('k')
    })
    expect(handlers.prevSession).toHaveBeenCalledTimes(1)
  })

  it('does not call handler for unbound keys', () => {
    const handlers = { nextSession: vi.fn() }
    renderHook(() => useKeyboardShortcuts(handlers))

    act(() => {
      fireKey('x')
    })
    expect(handlers.nextSession).not.toHaveBeenCalled()
  })

  it('does not call handler if action has no handler registered', () => {
    const handlers = {} // no handlers
    expect(() => {
      renderHook(() => useKeyboardShortcuts(handlers))
      act(() => {
        fireKey('j')
      })
    }).not.toThrow()
  })
})

// ─── Input field suppression ────────────────────────────────────────────────

describe('useKeyboardShortcuts — input suppression', () => {
  it('ignores keys when target is an INPUT element', () => {
    const handlers = { nextSession: vi.fn() }
    renderHook(() => useKeyboardShortcuts(handlers))

    const input = document.createElement('input')
    act(() => {
      fireKeyOnElement(input, 'j')
    })

    expect(handlers.nextSession).not.toHaveBeenCalled()
  })

  it('ignores keys when target is a TEXTAREA element', () => {
    const handlers = { nextSession: vi.fn() }
    renderHook(() => useKeyboardShortcuts(handlers))

    const textarea = document.createElement('textarea')
    act(() => {
      fireKeyOnElement(textarea, 'j')
    })

    expect(handlers.nextSession).not.toHaveBeenCalled()
  })

  it('ignores keys when target is a SELECT element', () => {
    const handlers = { nextSession: vi.fn() }
    renderHook(() => useKeyboardShortcuts(handlers))

    const select = document.createElement('select')
    act(() => {
      fireKeyOnElement(select, 'j')
    })

    expect(handlers.nextSession).not.toHaveBeenCalled()
  })

  it('allows Escape even when focused in an input', () => {
    const handlers = { backToBoard: vi.fn() }
    renderHook(() => useKeyboardShortcuts(handlers))

    const input = document.createElement('input')
    act(() => {
      fireKeyOnElement(input, 'Escape')
    })

    expect(handlers.backToBoard).toHaveBeenCalledTimes(1)
  })
})

// ─── Modifier combos ────────────────────────────────────────────────────────

describe('useKeyboardShortcuts — modifier keys', () => {
  it('matches Ctrl+k when bound', () => {
    localStorage.setItem(
      'oversight.shortcuts',
      JSON.stringify({
        ...DEFAULT_SHORTCUTS,
        prevSession: 'Ctrl+k',
      }),
    )

    const handlers = { prevSession: vi.fn() }
    renderHook(() => useKeyboardShortcuts(handlers))

    // Plain k should NOT match
    act(() => {
      fireKey('k')
    })
    expect(handlers.prevSession).not.toHaveBeenCalled()

    // Ctrl+k should match
    act(() => {
      fireKey('k', { ctrlKey: true })
    })
    expect(handlers.prevSession).toHaveBeenCalledTimes(1)
  })

  it('does not match when wrong modifier is pressed', () => {
    localStorage.setItem(
      'oversight.shortcuts',
      JSON.stringify({
        ...DEFAULT_SHORTCUTS,
        nextSession: 'Ctrl+j',
      }),
    )

    const handlers = { nextSession: vi.fn() }
    renderHook(() => useKeyboardShortcuts(handlers))

    act(() => {
      fireKey('j', { altKey: true })
    })
    expect(handlers.nextSession).not.toHaveBeenCalled()
  })
})

// ─── Persistence ────────────────────────────────────────────────────────────

describe('useKeyboardShortcuts — persistence', () => {
  it('loads custom shortcuts from localStorage', () => {
    localStorage.setItem(
      'oversight.shortcuts',
      JSON.stringify({
        nextSession: 'n',
      }),
    )

    const handlers = { nextSession: vi.fn() }
    renderHook(() => useKeyboardShortcuts(handlers))

    // Default 'j' should NOT work
    act(() => {
      fireKey('j')
    })
    expect(handlers.nextSession).not.toHaveBeenCalled()

    // Custom 'n' should work
    act(() => {
      fireKey('n')
    })
    expect(handlers.nextSession).toHaveBeenCalledTimes(1)
  })

  it('updateShortcut persists to localStorage and takes effect', () => {
    const handlers = { nextSession: vi.fn() }
    const { result } = renderHook(() => useKeyboardShortcuts(handlers))

    act(() => {
      result.current.updateShortcut('nextSession', 'n')
    })

    expect(result.current.shortcuts.nextSession).toBe('n')
    const stored = JSON.parse(localStorage.getItem('oversight.shortcuts'))
    expect(stored.nextSession).toBe('n')

    // Old key should not work
    act(() => {
      fireKey('j')
    })
    expect(handlers.nextSession).not.toHaveBeenCalled()

    // New key should work
    act(() => {
      fireKey('n')
    })
    expect(handlers.nextSession).toHaveBeenCalledTimes(1)
  })

  it('resetDefaults restores all shortcuts and persists', () => {
    const handlers = { nextSession: vi.fn() }
    const { result } = renderHook(() => useKeyboardShortcuts(handlers))

    act(() => {
      result.current.updateShortcut('nextSession', 'x')
    })
    expect(result.current.shortcuts.nextSession).toBe('x')

    act(() => {
      result.current.resetDefaults()
    })
    expect(result.current.shortcuts.nextSession).toBe('j')

    const stored = JSON.parse(localStorage.getItem('oversight.shortcuts'))
    expect(stored.nextSession).toBe('j')
  })

  it('updateShortcut clears conflicting binding from other action', () => {
    const handlers = { nextSession: vi.fn(), prevSession: vi.fn() }
    const { result } = renderHook(() => useKeyboardShortcuts(handlers))

    // Bind nextSession to 'k' (which is prevSession's default)
    act(() => {
      result.current.updateShortcut('nextSession', 'k')
    })

    expect(result.current.shortcuts.nextSession).toBe('k')
    expect(result.current.shortcuts.prevSession).toBe('') // cleared

    // Pressing 'k' should trigger nextSession, not prevSession
    act(() => {
      fireKey('k')
    })
    expect(handlers.nextSession).toHaveBeenCalledTimes(1)
    expect(handlers.prevSession).not.toHaveBeenCalled()
  })

  it('handles corrupted localStorage gracefully', () => {
    localStorage.setItem('oversight.shortcuts', 'not json')
    const handlers = { nextSession: vi.fn() }

    expect(() => {
      renderHook(() => useKeyboardShortcuts(handlers))
    }).not.toThrow()

    act(() => {
      fireKey('j')
    })
    expect(handlers.nextSession).toHaveBeenCalled()
  })
})

// ─── Cleanup ────────────────────────────────────────────────────────────────

describe('useKeyboardShortcuts — cleanup', () => {
  it('removes event listener on unmount', () => {
    const handlers = { nextSession: vi.fn() }
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers))

    unmount()

    act(() => {
      fireKey('j')
    })
    expect(handlers.nextSession).not.toHaveBeenCalled()
  })
})
