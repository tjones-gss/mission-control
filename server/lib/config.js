export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  host: process.env.HOST || '0.0.0.0',
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
