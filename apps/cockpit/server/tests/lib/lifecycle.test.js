import { isReady, setReady, isShuttingDown, _reset } from '../../lib/lifecycle.js'

describe('lifecycle', () => {
  beforeEach(() => {
    _reset()
  })

  test('isReady defaults to false', () => {
    expect(isReady()).toBe(false)
  })

  test('setReady makes isReady return true', () => {
    setReady()
    expect(isReady()).toBe(true)
  })

  test('isShuttingDown defaults to false', () => {
    expect(isShuttingDown()).toBe(false)
  })

  test('_reset resets all state', () => {
    setReady()
    expect(isReady()).toBe(true)
    _reset()
    expect(isReady()).toBe(false)
  })
})
