import { describe, it, expect, afterEach } from 'vitest'
import { detectCostRunway, DEFAULT_WARN_PCT, CRITICAL_PCT } from '../../intelligence/cost-runway.js'

// Sprint 2 — semantic alerting. detectCostRunway is PURE and synchronous: it warns
// before a session burns through the budget ceiling. No ceiling (max 0 = unlimited)
// means no possible runway, so it never fires.

afterEach(() => {
  delete process.env.COST_RUNWAY_WARN_PCT
})

describe('detectCostRunway', () => {
  it('test_no_alert_under_threshold — 40% consumed → no alert', () => {
    expect(detectCostRunway({ estimatedCost: 0.4 }, 1.0)).toEqual({ runway_alert: false })
  })

  it('test_alert_at_80_percent — 80% consumed → alert at 80%, not critical', () => {
    const out = detectCostRunway({ estimatedCost: 0.8 }, 1.0)
    expect(out.runway_alert).toBe(true)
    expect(out.pct).toBe(80)
    expect(out.critical).toBeFalsy()
  })

  it('test_alert_at_95_percent — 95% consumed → critical alert', () => {
    expect(detectCostRunway({ estimatedCost: 0.95 }, 1.0)).toEqual({
      runway_alert: true,
      pct: 95,
      critical: true,
    })
  })

  it('test_no_alert_when_no_budget_ceiling — max 0 (unlimited) → no alert', () => {
    expect(detectCostRunway({ estimatedCost: 99 }, 0)).toEqual({ runway_alert: false })
  })

  it('test_threshold_configurable — COST_RUNWAY_WARN_PCT overrides the default of 80', () => {
    expect(DEFAULT_WARN_PCT).toBe(80)
    expect(CRITICAL_PCT).toBe(95)
    // 60% consumed: no alert by default, but an alert once the warn threshold is 50%.
    expect(detectCostRunway({ estimatedCost: 0.6 }, 1.0)).toEqual({ runway_alert: false })
    process.env.COST_RUNWAY_WARN_PCT = '50'
    expect(detectCostRunway({ estimatedCost: 0.6 }, 1.0)).toEqual({ runway_alert: true, pct: 60 })
  })
})
