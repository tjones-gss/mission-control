import { detectModelFamily, calculateCost, formatCost, MODEL_PRICING } from '../../utils/cost.js'

describe('detectModelFamily()', () => {
  it('detects sonnet from claude-3-5-sonnet-20241022', () => {
    expect(detectModelFamily('claude-3-5-sonnet-20241022')).toBe('sonnet')
  })

  it('detects sonnet from claude-sonnet-4-6-20250514', () => {
    expect(detectModelFamily('claude-sonnet-4-6-20250514')).toBe('sonnet')
  })

  it('detects haiku from claude-3-haiku-20240307', () => {
    expect(detectModelFamily('claude-3-haiku-20240307')).toBe('haiku')
  })

  it('detects opus from claude-opus-4-6', () => {
    expect(detectModelFamily('claude-opus-4-6')).toBe('opus')
  })

  it('returns null for unknown model', () => {
    expect(detectModelFamily('gpt-4o')).toBeNull()
  })

  it('returns null for null input', () => {
    expect(detectModelFamily(null)).toBeNull()
  })
})

describe('calculateCost()', () => {
  it('calculates correct cost for sonnet', () => {
    const usage = { input: 1_000_000, output: 100_000, cacheRead: 500_000, cacheWrite: 200_000 }
    const result = calculateCost(usage, 'claude-sonnet-4-6')
    expect(result.family).toBe('sonnet')
    expect(result.breakdown.input).toBeCloseTo(3.0) // 1M * $3/M
    expect(result.breakdown.output).toBeCloseTo(1.5) // 100k * $15/M
    expect(result.breakdown.cacheRead).toBeCloseTo(0.15) // 500k * $0.30/M
    expect(result.breakdown.cacheWrite).toBeCloseTo(0.75) // 200k * $3.75/M
    expect(result.totalCost).toBeCloseTo(5.4)
  })

  it('calculates correct cost for haiku', () => {
    const usage = { input: 500_000, output: 50_000, cacheRead: 0, cacheWrite: 0 }
    const result = calculateCost(usage, 'claude-3-haiku')
    expect(result.breakdown.input).toBeCloseTo(0.4) // 500k * $0.80/M
    expect(result.breakdown.output).toBeCloseTo(0.2) // 50k * $4.00/M
    expect(result.totalCost).toBeCloseTo(0.6)
  })

  it('returns null for unknown model', () => {
    expect(calculateCost({ input: 100 }, 'gpt-4')).toBeNull()
  })

  it('returns null for null usage', () => {
    expect(calculateCost(null, 'sonnet')).toBeNull()
  })

  it('handles zero tokens', () => {
    const result = calculateCost(
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      'claude-sonnet-4-6',
    )
    expect(result.totalCost).toBe(0)
  })
})

describe('formatCost()', () => {
  it('formats small amounts', () => {
    expect(formatCost(0.005)).toBe('<$0.01')
  })

  it('formats cents', () => {
    expect(formatCost(0.12)).toBe('$0.12')
  })

  it('formats dollars', () => {
    expect(formatCost(5.67)).toBe('$5.67')
  })

  it('returns null for null input', () => {
    expect(formatCost(null)).toBeNull()
  })
})
