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

  it('detects fable from claude-fable-5', () => {
    expect(detectModelFamily('claude-fable-5')).toBe('fable')
  })

  it('detects fable from claude-mythos-5 (same model tier)', () => {
    expect(detectModelFamily('claude-mythos-5')).toBe('fable')
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
    const result = calculateCost(usage, 'claude-haiku-4-5')
    expect(result.breakdown.input).toBeCloseTo(0.5) // 500k * $1.00/M
    expect(result.breakdown.output).toBeCloseTo(0.25) // 50k * $5.00/M
    expect(result.totalCost).toBeCloseTo(0.75)
  })

  it('calculates correct cost for opus at current (4.5+) list prices', () => {
    const usage = { input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0 }
    const result = calculateCost(usage, 'claude-opus-4-8')
    expect(result.breakdown.input).toBeCloseTo(5.0) // 1M * $5/M
    expect(result.breakdown.output).toBeCloseTo(2.5) // 100k * $25/M
    expect(result.totalCost).toBeCloseTo(7.5)
  })

  it('calculates correct cost for fable (Fleet budget enforcement depends on this)', () => {
    const usage = { input: 1_000_000, output: 100_000, cacheRead: 500_000, cacheWrite: 200_000 }
    const result = calculateCost(usage, 'claude-fable-5')
    expect(result.family).toBe('fable')
    expect(result.breakdown.input).toBeCloseTo(10.0) // 1M * $10/M
    expect(result.breakdown.output).toBeCloseTo(5.0) // 100k * $50/M
    expect(result.breakdown.cacheRead).toBeCloseTo(0.5) // 500k * $1.00/M (0.1x input)
    expect(result.breakdown.cacheWrite).toBeCloseTo(2.5) // 200k * $12.50/M (1.25x input)
    expect(result.totalCost).toBeCloseTo(18.0)
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
