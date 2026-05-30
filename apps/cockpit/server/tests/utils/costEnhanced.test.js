import {
  checkBudget,
  calculateCacheHitRate,
  estimateContextUsage,
  MODEL_PRICING,
} from '../../utils/cost.js'

// ── checkBudget ─────────────────────────────────────────────────────────

describe('checkBudget()', () => {
  it('returns ok when spend is well below threshold', () => {
    expect(checkBudget(1.0, 10.0)).toBe('ok')
  })

  it('returns warning when spend reaches 80% of max', () => {
    expect(checkBudget(8.0, 10.0)).toBe('warning')
  })

  it('returns warning at exactly the threshold boundary', () => {
    expect(checkBudget(8.0, 10.0, 0.8)).toBe('warning')
  })

  it('returns exceeded when spend equals max', () => {
    expect(checkBudget(10.0, 10.0)).toBe('exceeded')
  })

  it('returns exceeded when spend exceeds max', () => {
    expect(checkBudget(15.0, 10.0)).toBe('exceeded')
  })

  it('returns ok when maxCost is zero (no budget)', () => {
    expect(checkBudget(100.0, 0)).toBe('ok')
  })

  it('returns ok when maxCost is negative', () => {
    expect(checkBudget(50.0, -5.0)).toBe('ok')
  })

  it('respects custom warningThreshold', () => {
    // 50% threshold: $5 of $10 should trigger warning
    expect(checkBudget(5.0, 10.0, 0.5)).toBe('warning')
    // But $4.99 should still be ok
    expect(checkBudget(4.99, 10.0, 0.5)).toBe('ok')
  })
})

// ── calculateCacheHitRate ───────────────────────────────────────────────

describe('calculateCacheHitRate()', () => {
  it('returns correct rate for normal usage', () => {
    const rate = calculateCacheHitRate({ cacheRead: 750_000, input: 250_000 })
    expect(rate).toBeCloseTo(75.0)
  })

  it('returns 0 when there are zero tokens', () => {
    expect(calculateCacheHitRate({ cacheRead: 0, input: 0 })).toBe(0)
  })

  it('returns 0 when no cache reads', () => {
    expect(calculateCacheHitRate({ cacheRead: 0, input: 100_000 })).toBe(0)
  })

  it('returns 100 when everything is cache read', () => {
    expect(calculateCacheHitRate({ cacheRead: 500_000, input: 0 })).toBeCloseTo(100.0)
  })

  it('returns 0 for null tokenUsage', () => {
    expect(calculateCacheHitRate(null)).toBe(0)
  })

  it('returns 0 for empty object', () => {
    expect(calculateCacheHitRate({})).toBe(0)
  })
})

// ── estimateContextUsage ────────────────────────────────────────────────

describe('estimateContextUsage()', () => {
  it('returns ok when usage is under 80%', () => {
    // sonnet context = 200k. 50k total = 25%
    const result = estimateContextUsage(
      { input: 30_000, output: 10_000, cacheWrite: 10_000 },
      'claude-sonnet-4-6',
    )
    expect(result.status).toBe('ok')
    expect(result.ratio).toBeCloseTo(0.25)
  })

  it('returns warning when usage is between 80% and 95%', () => {
    // sonnet context = 200k. 180k total = 90%
    const result = estimateContextUsage(
      { input: 100_000, output: 50_000, cacheWrite: 30_000 },
      'claude-sonnet-4-6',
    )
    expect(result.status).toBe('warning')
    expect(result.ratio).toBeCloseTo(0.9)
  })

  it('returns critical when usage is 95% or above', () => {
    // sonnet context = 200k. 196k total = 98%
    const result = estimateContextUsage(
      { input: 120_000, output: 50_000, cacheWrite: 26_000 },
      'claude-sonnet-4-6',
    )
    expect(result.status).toBe('critical')
    expect(result.ratio).toBeCloseTo(0.98)
  })

  it('returns critical at exactly 95%', () => {
    // sonnet context = 200k. 190k total = 95%
    const result = estimateContextUsage(
      { input: 100_000, output: 50_000, cacheWrite: 40_000 },
      'claude-sonnet-4-6',
    )
    expect(result.status).toBe('critical')
    expect(result.ratio).toBeCloseTo(0.95)
  })

  it('uses different context windows per model family', () => {
    // opus context = 1M. 200k = 20% -> ok
    const opusResult = estimateContextUsage(
      { input: 100_000, output: 50_000, cacheWrite: 50_000 },
      'claude-opus-4-6',
    )
    expect(opusResult.status).toBe('ok')
    expect(opusResult.ratio).toBeCloseTo(0.2)

    // Same tokens on sonnet = 200k/200k = 100% -> critical
    const sonnetResult = estimateContextUsage(
      { input: 100_000, output: 50_000, cacheWrite: 50_000 },
      'claude-sonnet-4-6',
    )
    expect(sonnetResult.status).toBe('critical')
    expect(sonnetResult.ratio).toBeCloseTo(1.0)
  })

  it('returns null for unknown model', () => {
    expect(estimateContextUsage({ input: 1000 }, 'gpt-4o')).toBeNull()
  })

  it('returns null for null tokenUsage', () => {
    expect(estimateContextUsage(null, 'claude-sonnet-4-6')).toBeNull()
  })
})

// ── MODEL_PRICING structure ─────────────────────────────────────────────

describe('MODEL_PRICING', () => {
  it('has contextWindow for all model families', () => {
    for (const family of ['haiku', 'sonnet', 'opus']) {
      expect(MODEL_PRICING[family]).toHaveProperty('contextWindow')
      expect(MODEL_PRICING[family].contextWindow).toBeGreaterThan(0)
    }
  })

  it('has maxOutput for all model families', () => {
    for (const family of ['haiku', 'sonnet', 'opus']) {
      expect(MODEL_PRICING[family]).toHaveProperty('maxOutput')
      expect(MODEL_PRICING[family].maxOutput).toBeGreaterThan(0)
    }
  })

  it('opus has 1M context window', () => {
    expect(MODEL_PRICING.opus.contextWindow).toBe(1_000_000)
  })

  it('sonnet has 200K context window', () => {
    expect(MODEL_PRICING.sonnet.contextWindow).toBe(200_000)
  })

  it('haiku has 200K context window', () => {
    expect(MODEL_PRICING.haiku.contextWindow).toBe(200_000)
  })

  it('opus has 32K max output', () => {
    expect(MODEL_PRICING.opus.maxOutput).toBe(32_000)
  })

  it('sonnet has 16K max output', () => {
    expect(MODEL_PRICING.sonnet.maxOutput).toBe(16_000)
  })

  it('haiku has 8192 max output', () => {
    expect(MODEL_PRICING.haiku.maxOutput).toBe(8_192)
  })
})
