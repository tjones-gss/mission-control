import path from 'path'
import os from 'os'

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  // Bind to loopback only by default — the cockpit should not be reachable from
  // the LAN out of the box. Operators who knowingly want LAN exposure can set
  // OVERSIGHT_HOST=0.0.0.0 (or a specific interface). HOST is still honored as a
  // legacy/compat fallback.
  host: process.env.OVERSIGHT_HOST || process.env.HOST || '127.0.0.1',
  logLevel: process.env.LOG_LEVEL || 'info',
  corsOrigin: process.env.OVERSIGHT_CORS_ORIGIN || null,
  apiKey: process.env.OVERSIGHT_API_KEY || null,
  rateLimit: parseInt(process.env.OVERSIGHT_RATE_LIMIT || '100', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  secretScanning: process.env.OVERSIGHT_SECRET_SCANNING !== 'false',
  secretScanLogOnly: process.env.OVERSIGHT_SECRET_SCAN_LOG_ONLY === 'true',
  budgetMaxUsd: parseFloat(process.env.OVERSIGHT_BUDGET_MAX || '0'),
  budgetWarningThreshold: parseFloat(process.env.OVERSIGHT_BUDGET_WARNING || '0.80'),
  // MeshMonitor / Meshtastic node data directory. Opt-in: defaults to ~/.meshtastic,
  // which usually won't exist — the parser degrades gracefully when it's absent.
  meshtasticDataPath: process.env.MESHTASTIC_DATA_PATH || path.join(os.homedir(), '.meshtastic'),
}
