// Sprint 2 — semantic alerting: cost runway. Warn a human before a session burns
// through the budget ceiling, rather than only after it has been breached (the
// existing `budget` anomaly). Pure and synchronous — no LLM, no side effects.
//
// With no ceiling (max 0 = unlimited) there is no runway to run out of, so it
// never fires. The warn threshold is configurable; crossing CRITICAL_PCT escalates
// the same alert to critical (ceiling imminent).

export const DEFAULT_WARN_PCT = 80
export const CRITICAL_PCT = 95

function resolveWarnPct(opt) {
  if (Number.isFinite(opt) && opt > 0) return opt
  const env = parseFloat(process.env.COST_RUNWAY_WARN_PCT ?? '')
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_WARN_PCT
}

export function detectCostRunway(session, globalBudgetMax, options = {}) {
  const max = Number(globalBudgetMax)
  if (!(max > 0)) return { runway_alert: false }

  const cost = Number(session?.estimatedCost) || 0
  const pct = Math.round((cost / max) * 100)
  if (pct < resolveWarnPct(options.warnPct)) return { runway_alert: false }

  const result = { runway_alert: true, pct }
  if (pct >= CRITICAL_PCT) result.critical = true
  return result
}
