import { renderHook, act } from '@testing-library/react'
import { useTheme, getTheme, setTheme, THEMES, THEME_IDS } from '../../hooks/useTheme.js'

beforeEach(() => {
  localStorage.clear()
  // reset any theme applied to the document between tests
  delete document.documentElement.dataset.theme
})

describe('THEMES catalog', () => {
  it('exposes calm as the default plus classic and the design themes', () => {
    expect(THEME_IDS).toContain('classic')
    expect(THEME_IDS).toContain('calm')
    // every theme has an id + a human label
    for (const t of THEMES) {
      expect(typeof t.id).toBe('string')
      expect(typeof t.label).toBe('string')
    }
  })
})

describe('getTheme / setTheme', () => {
  it('returns the calm default when localStorage is empty', () => {
    expect(getTheme()).toBe('calm')
  })

  it('returns the stored theme after setTheme', () => {
    setTheme('calm')
    expect(getTheme()).toBe('calm')
  })

  it('falls back to calm when the stored value is not a known theme', () => {
    localStorage.setItem('oversight.theme', 'chartreuse')
    expect(getTheme()).toBe('calm')
  })

  it('falls back to calm when localStorage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(getTheme()).toBe('calm')
    spy.mockRestore()
  })

  it('applies the chosen theme to the document element', () => {
    setTheme('tron')
    expect(document.documentElement.dataset.theme).toBe('tron')
  })
})

describe('useTheme', () => {
  it('applies the persisted theme to the document on mount', () => {
    setTheme('calm')
    delete document.documentElement.dataset.theme
    renderHook(() => useTheme())
    expect(document.documentElement.dataset.theme).toBe('calm')
  })

  it('defaults the document to calm on mount when nothing is stored', () => {
    renderHook(() => useTheme())
    expect(document.documentElement.dataset.theme).toBe('calm')
  })

  it('exposes the current theme and updates it when setTheme is called', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('calm')

    act(() => {
      result.current.setTheme('calm')
    })

    expect(result.current.theme).toBe('calm')
    expect(getTheme()).toBe('calm')
    expect(document.documentElement.dataset.theme).toBe('calm')
  })

  it('ignores an unknown theme passed to setTheme', () => {
    const { result } = renderHook(() => useTheme())
    act(() => {
      result.current.setTheme('chartreuse')
    })
    expect(result.current.theme).toBe('calm')
  })
})
