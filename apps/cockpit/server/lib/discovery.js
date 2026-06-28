// LAN discovery (Sprint 2-b, "team-lead mode"). When the cockpit is bound beyond
// loopback (config.lanMode — see lib/config.js), it advertises itself over
// mDNS/Bonjour so other machines on the LAN can find it without knowing the IP.
//
// This is OFF for the localhost-first default (ADR-0004): a loopback bind never
// advertises, so the private single-operator path pays nothing and leaks nothing
// onto the network. Advertisement is also explicitly opt-out via OVERSIGHT_MDNS.
//
// The bonjour instance is injected (bonjourFactory) so the decision logic is
// exhaustively unit-testable without opening a multicast socket; the default
// factory lazily loads bonjour-service ONLY when we actually advertise, via
// createRequire, so importing this module never hard-loads the dep and a missing
// or broken mDNS library degrades to a logged no-op rather than crashing boot.

import { createRequire } from 'node:module'
import { logger } from './logger.js'

// The advertised service type. A dedicated type (not the generic _http._tcp)
// keeps discovery scoped to cockpits — a mission-control-aware peer browses for
// exactly this and ignores unrelated HTTP services on the LAN.
const SERVICE_TYPE = 'mission-control'
const DEFAULT_NAME = 'Mission Control'

let active = null // { bonjour, service } while advertising, else null

function defaultBonjourFactory() {
  const require = createRequire(import.meta.url)
  const mod = require('bonjour-service')
  const Bonjour = mod.Bonjour || mod.default?.Bonjour || mod.default
  return new Bonjour()
}

// Begin advertising the cockpit on the LAN. No-op (returns null) on a loopback
// bind or when OVERSIGHT_MDNS=false. Returns the active handle on success.
export function startDiscovery({ port, lanMode, name, bonjourFactory } = {}) {
  if (!lanMode) return null // loopback bind — stays private
  if (process.env.OVERSIGHT_MDNS === 'false') return null // explicit opt-out

  const factory = bonjourFactory || defaultBonjourFactory
  try {
    const bonjour = factory()
    const service = bonjour.publish({
      name: name || process.env.OVERSIGHT_MDNS_NAME || DEFAULT_NAME,
      type: SERVICE_TYPE,
      port,
      txt: { role: 'cockpit' },
    })
    active = { bonjour, service }
    logger.info(`mDNS: advertising "${SERVICE_TYPE}" on port ${port}`)
    return active
  } catch (err) {
    // A missing/broken mDNS stack must never take down the server — LAN discovery
    // is a convenience, not the system of record.
    logger.warn({ detail: err?.message || String(err) }, 'mdns_advertise_failed')
    active = null
    return null
  }
}

// Tear down advertisement. Safe to call when not advertising. Best-effort — a
// failure to unpublish must not block shutdown.
export function stopDiscovery() {
  if (!active) return
  const { bonjour, service } = active
  active = null
  try {
    service?.stop?.()
  } catch {
    /* ignore */
  }
  try {
    bonjour?.unpublishAll?.(() => {})
  } catch {
    /* ignore */
  }
  try {
    bonjour?.destroy?.()
  } catch {
    /* ignore */
  }
}

export function isAdvertising() {
  return active !== null
}
