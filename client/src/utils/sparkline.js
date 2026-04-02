import { calculateCost } from './cost.js'

export function buildCostTimeline(messages, model) {
  if (!messages?.length) return []

  const timeline = []
  let cumulative = 0

  for (const msg of messages) {
    if (msg.type !== 'assistant' || !msg.usage) continue

    const cost = calculateCost(msg.usage, model || msg.model)
    const turnCost = cost?.totalCost || 0
    cumulative += turnCost

    timeline.push({
      timestamp: msg.timestamp,
      turnCost,
      cumulativeCost: cumulative,
      tokenCount: (msg.usage.input || 0) + (msg.usage.output || 0),
    })
  }

  return timeline
}
