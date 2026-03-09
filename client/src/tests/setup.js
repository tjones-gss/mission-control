import '@testing-library/jest-dom'
import { server } from './mocks/server.js'

// MSW lifecycle
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// Stub EventSource global (jsdom has none)
class MockEventSource {
  constructor(url) {
    this.url = url
    this.listeners = {}
    this.onerror = null
    MockEventSource.instance = this
  }
  addEventListener(type, handler) {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(handler)
  }
  removeEventListener(type, handler) {
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter(h => h !== handler)
    }
  }
  close() {
    this.closed = true
  }
  // Helper for tests to emit events
  emit(type, data) {
    const handlers = this.listeners[type] || []
    handlers.forEach(h => h({ data: JSON.stringify(data) }))
  }
}
global.EventSource = MockEventSource

// Stub clipboard
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
  writable: true,
})
