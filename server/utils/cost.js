// Model pricing in dollars per million tokens (from claw-code usage.rs)
export const MODEL_PRICING = {
  haiku:  { input: 1.00, output: 5.00, cacheCreate: 1.25, cacheRead: 0.10 },
  sonnet: { input: 3.00, output: 15.00, cacheCreate: 3.75, cacheRead: 0.30 },
  opus:   { input: 15.00, output: 75.00, cacheCreate: 18.75, cacheRead: 1.50 },
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
    input: (tokenUsage.input || 0) / 1_000_000 * pricing.input,
    output: (tokenUsage.output || 0) / 1_000_000 * pricing.output,
    cacheWrite: (tokenUsage.cacheWrite || 0) / 1_000_000 * pricing.cacheCreate,
    cacheRead: (tokenUsage.cacheRead || 0) / 1_000_000 * pricing.cacheRead,
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
