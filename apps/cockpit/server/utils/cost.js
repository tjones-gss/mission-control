// Model pricing in dollars per million tokens (from claw-code usage.rs)
export const MODEL_PRICING = {
  haiku: {
    input: 0.8,
    output: 4.0,
    cacheCreate: 1.0,
    cacheRead: 0.08,
    contextWindow: 200_000,
    maxOutput: 8_192,
  },
  sonnet: {
    input: 3.0,
    output: 15.0,
    cacheCreate: 3.75,
    cacheRead: 0.3,
    contextWindow: 200_000,
    maxOutput: 16_000,
  },
  opus: {
    input: 15.0,
    output: 75.0,
    cacheCreate: 18.75,
    cacheRead: 1.5,
    contextWindow: 1_000_000,
    maxOutput: 32_000,
  },
}

export function detectModelFamily(modelString) {
  if (!modelString) return null
  const lower = modelString.toLowerCase()
  if (lower.includes('haiku')) return 'haiku'
  if (lower.includes('sonnet')) return 'sonnet'
  if (lower.includes('opus')) return 'opus'
  return null
}

export function calculateCost(tokenUsage, model) {
  if (!tokenUsage) return null
  const family = detectModelFamily(model)
  if (!family) return null
  const pricing = MODEL_PRICING[family]

  const breakdown = {
    input: ((tokenUsage.input || 0) / 1_000_000) * pricing.input,
    output: ((tokenUsage.output || 0) / 1_000_000) * pricing.output,
    cacheWrite: ((tokenUsage.cacheWrite || 0) / 1_000_000) * pricing.cacheCreate,
    cacheRead: ((tokenUsage.cacheRead || 0) / 1_000_000) * pricing.cacheRead,
  }

  const totalCost = breakdown.input + breakdown.output + breakdown.cacheWrite + breakdown.cacheRead

  return { totalCost, breakdown, family }
}

export function formatCost(dollars) {
  if (dollars == null) return null
  if (dollars < 0.01) return '<$0.01'
  if (dollars < 1) return `$${dollars.toFixed(2)}`
  return `$${dollars.toFixed(2)}`
}

/**
 * Check current spend against a budget ceiling.
 * @param {number} currentCost - Accumulated session cost in USD.
 * @param {number} maxCost - Hard budget ceiling in USD. 0 or negative = no limit.
 * @param {number} warningThreshold - Fraction of maxCost that triggers a warning (default 0.80).
 * @returns {'ok' | 'warning' | 'exceeded'}
 */
export function checkBudget(currentCost, maxCost, warningThreshold = 0.8) {
  if (maxCost <= 0) return 'ok'
  if (currentCost >= maxCost) return 'exceeded'
  if (currentCost >= maxCost * warningThreshold) return 'warning'
  return 'ok'
}

/**
 * Calculate cache hit rate as a percentage (0-100).
 * Formula: cacheRead / (cacheRead + input) * 100
 * @param {{ cacheRead?: number, input?: number }} tokenUsage
 * @returns {number}
 */
export function calculateCacheHitRate(tokenUsage) {
  if (!tokenUsage) return 0
  const cacheRead = tokenUsage.cacheRead || 0
  const input = tokenUsage.input || 0
  const total = cacheRead + input
  if (total === 0) return 0
  return (cacheRead / total) * 100
}

/**
 * Estimate how full the context window is, based on token usage and model.
 * Uses (input + output + cacheWrite) / contextWindow as the ratio.
 * @param {{ input?: number, output?: number, cacheWrite?: number }} tokenUsage
 * @param {string} model - Model string (e.g. 'claude-sonnet-4-6')
 * @returns {{ ratio: number, status: 'ok' | 'warning' | 'critical' } | null}
 */
export function estimateContextUsage(tokenUsage, model) {
  if (!tokenUsage) return null
  const family = detectModelFamily(model)
  if (!family) return null
  const pricing = MODEL_PRICING[family]
  const contextWindow = pricing.contextWindow

  const input = tokenUsage.input || 0
  const output = tokenUsage.output || 0
  const cacheWrite = tokenUsage.cacheWrite || 0
  const used = input + output + cacheWrite

  const ratio = used / contextWindow

  let status = 'ok'
  if (ratio >= 0.95) status = 'critical'
  else if (ratio >= 0.8) status = 'warning'

  return { ratio, status }
}
