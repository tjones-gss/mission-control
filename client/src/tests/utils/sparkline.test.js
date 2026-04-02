import { buildCostTimeline } from '../../utils/sparkline.js'

describe('buildCostTimeline()', () => {
  it('computes cumulative costs from assistant messages', () => {
    const messages = [
      { type: 'user', uuid: 'u1' },
      { type: 'assistant', uuid: 'a1', model: 'claude-sonnet-4-6', usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 }, timestamp: '2024-01-01T00:00:00Z' },
      { type: 'user', uuid: 'u2' },
      { type: 'assistant', uuid: 'a2', model: 'claude-sonnet-4-6', usage: { input: 2000, output: 1000, cacheRead: 0, cacheWrite: 0 }, timestamp: '2024-01-01T00:01:00Z' },
    ]
    const result = buildCostTimeline(messages, 'claude-sonnet-4-6')
    expect(result).toHaveLength(2)
    expect(result[0].turnCost).toBeGreaterThan(0)
    expect(result[1].cumulativeCost).toBeGreaterThan(result[0].cumulativeCost)
  })

  it('returns empty for empty messages', () => {
    expect(buildCostTimeline([], 'sonnet')).toEqual([])
  })

  it('returns empty for null messages', () => {
    expect(buildCostTimeline(null, 'sonnet')).toEqual([])
  })

  it('skips user messages', () => {
    const messages = [
      { type: 'user', uuid: 'u1' },
      { type: 'user', uuid: 'u2' },
    ]
    expect(buildCostTimeline(messages, 'sonnet')).toEqual([])
  })

  it('skips assistant messages without usage', () => {
    const messages = [
      { type: 'assistant', uuid: 'a1', model: 'sonnet', blocks: [] },
    ]
    expect(buildCostTimeline(messages, 'sonnet')).toEqual([])
  })

  it('includes timestamp in output', () => {
    const messages = [
      { type: 'assistant', uuid: 'a1', model: 'claude-sonnet-4-6', usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 }, timestamp: '2024-01-01T00:00:00Z' },
    ]
    const result = buildCostTimeline(messages, 'claude-sonnet-4-6')
    expect(result[0].timestamp).toBe('2024-01-01T00:00:00Z')
  })
})
