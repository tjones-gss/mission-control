import { describe, it, expect } from 'vitest'
import { seatFromHeaders, SEAT_HEADER } from '../../lib/seat.js'

// Sprint 2-b "team-lead mode": in a multi-seat LAN deployment several leads may
// share one cockpit. The X-Oversight-Seat header identifies WHICH lead resolved
// an approval so their identity lands in the audit log. seatFromHeaders is the
// pure extractor — sanitised, never trusted verbatim.

describe('seatFromHeaders', () => {
  it('returns the trimmed seat identity from the X-Oversight-Seat header', () => {
    expect(seatFromHeaders({ [SEAT_HEADER]: '  Travis  ' })).toBe('Travis')
  })

  it('returns null when the header is absent', () => {
    expect(seatFromHeaders({})).toBeNull()
    expect(seatFromHeaders(undefined)).toBeNull()
  })

  it('returns null for an empty / whitespace-only value', () => {
    expect(seatFromHeaders({ [SEAT_HEADER]: '   ' })).toBeNull()
  })

  it('strips CR/LF so a seat value can never forge an extra audit log line', () => {
    expect(seatFromHeaders({ [SEAT_HEADER]: 'a\r\nb' })).toBe('a b')
  })

  it('caps an over-long value at 120 chars', () => {
    expect(seatFromHeaders({ [SEAT_HEADER]: 'x'.repeat(500) }).length).toBe(120)
  })

  it('exposes the header name as a stable lowercase constant', () => {
    expect(SEAT_HEADER).toBe('x-oversight-seat')
  })
})
