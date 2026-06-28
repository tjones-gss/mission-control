// Loopback bind addresses — the cockpit's localhost-first default (ADR-0004).
// An empty/unset host also counts as loopback (it never reaches the LAN).
const LOOPBACK_BIND = new Set(['127.0.0.1', '::1', 'localhost', ''])

// LAN team-lead mode (Sprint 2-b) is a pure function of the bind host: any
// non-loopback bind (0.0.0.0 for all interfaces, or a specific LAN address)
// means the cockpit is reachable from other machines, which is what gates mDNS
// advertisement. Loopback binds stay private and never advertise.
export function isLanHost(host) {
  return !LOOPBACK_BIND.has(
    String(host ?? '')
      .trim()
      .toLowerCase(),
  )
}

const host = process.env.OVERSIGHT_HOST || process.env.HOST || '127.0.0.1'

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  // Bind to loopback only by default — the cockpit should not be reachable from
  // the LAN out of the box. Operators who knowingly want LAN exposure can set
  // OVERSIGHT_HOST=0.0.0.0 (or a specific interface). HOST is still honored as a
  // legacy/compat fallback.
  host,
  // LAN team-lead mode — true when the bind host is reachable beyond loopback.
  // Gates mDNS advertisement (lib/discovery.js); binding itself is unchanged.
  lanMode: isLanHost(host),
  logLevel: process.env.LOG_LEVEL || 'info',
  corsOrigin: process.env.OVERSIGHT_CORS_ORIGIN || null,
  apiKey: process.env.OVERSIGHT_API_KEY || null,
  rateLimit: parseInt(process.env.OVERSIGHT_RATE_LIMIT || '100', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  secretScanning: process.env.OVERSIGHT_SECRET_SCANNING !== 'false',
  secretScanLogOnly: process.env.OVERSIGHT_SECRET_SCAN_LOG_ONLY === 'true',
  budgetMaxUsd: parseFloat(process.env.OVERSIGHT_BUDGET_MAX || '0'),
  budgetWarningThreshold: parseFloat(process.env.OVERSIGHT_BUDGET_WARNING || '0.80'),
}
