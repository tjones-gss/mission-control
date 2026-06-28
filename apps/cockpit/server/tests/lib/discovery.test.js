import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { startDiscovery, stopDiscovery, isAdvertising } from '../../lib/discovery.js'

// A fake bonjour instance injected via the bonjourFactory option, so no real
// multicast socket is opened and the real bonjour-service dep is never loaded.
function fakeBonjour() {
  const service = { stop: vi.fn() }
  const bonjour = {
    publish: vi.fn(() => service),
    unpublishAll: vi.fn((cb) => cb && cb()),
    destroy: vi.fn(),
  }
  const factory = vi.fn(() => bonjour)
  return { factory, bonjour, service }
}

beforeEach(() => {
  delete process.env.OVERSIGHT_MDNS
  delete process.env.OVERSIGHT_MDNS_NAME
  stopDiscovery()
})
afterEach(() => {
  stopDiscovery()
})

describe('startDiscovery', () => {
  it('does NOT advertise on a loopback bind (lanMode false)', () => {
    const { factory } = fakeBonjour()
    const r = startDiscovery({ port: 3001, lanMode: false, bonjourFactory: factory })
    expect(r).toBeNull()
    expect(factory).not.toHaveBeenCalled()
    expect(isAdvertising()).toBe(false)
  })

  it('publishes a mission-control service on a LAN bind', () => {
    const { factory, bonjour } = fakeBonjour()
    const r = startDiscovery({ port: 3001, lanMode: true, bonjourFactory: factory })
    expect(factory).toHaveBeenCalledTimes(1)
    expect(bonjour.publish).toHaveBeenCalledTimes(1)
    const arg = bonjour.publish.mock.calls[0][0]
    expect(arg).toMatchObject({ type: 'mission-control', port: 3001 })
    expect(arg.name).toBe('Mission Control')
    expect(isAdvertising()).toBe(true)
    expect(r).toBeTruthy()
  })

  it('honors OVERSIGHT_MDNS=false as an explicit opt-out even on a LAN bind', () => {
    process.env.OVERSIGHT_MDNS = 'false'
    const { factory } = fakeBonjour()
    expect(startDiscovery({ port: 3001, lanMode: true, bonjourFactory: factory })).toBeNull()
    expect(factory).not.toHaveBeenCalled()
  })

  it('uses the name option (or OVERSIGHT_MDNS_NAME) for the advertised name', () => {
    const { factory, bonjour } = fakeBonjour()
    startDiscovery({ port: 3001, lanMode: true, name: 'Travis lead', bonjourFactory: factory })
    expect(bonjour.publish.mock.calls[0][0].name).toBe('Travis lead')
  })

  it('degrades to a logged no-op if the bonjour factory throws (never crashes boot)', () => {
    const factory = vi.fn(() => {
      throw new Error('mdns lib missing')
    })
    expect(startDiscovery({ port: 3001, lanMode: true, bonjourFactory: factory })).toBeNull()
    expect(isAdvertising()).toBe(false)
  })
})

describe('stopDiscovery', () => {
  it('stops the service and destroys the bonjour instance', () => {
    const { factory, bonjour, service } = fakeBonjour()
    startDiscovery({ port: 3001, lanMode: true, bonjourFactory: factory })
    stopDiscovery()
    expect(service.stop).toHaveBeenCalled()
    expect(bonjour.destroy).toHaveBeenCalled()
    expect(isAdvertising()).toBe(false)
  })

  it('is a safe no-op when nothing is advertising', () => {
    expect(() => stopDiscovery()).not.toThrow()
  })
})
