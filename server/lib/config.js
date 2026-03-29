export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  host: process.env.HOST || '0.0.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',
  corsOrigin: process.env.OVERSIGHT_CORS_ORIGIN || null,
  apiKey: process.env.OVERSIGHT_API_KEY || null,
  rateLimit: parseInt(process.env.OVERSIGHT_RATE_LIMIT || '100', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
}
