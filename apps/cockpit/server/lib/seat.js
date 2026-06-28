// Multi-seat operator identity (Sprint 2-b, "team-lead mode"). When several leads
// share one LAN-exposed cockpit, the X-Oversight-Seat request header carries the
// acting lead's identity. The approval route records it into the audit event's
// `actor` field (already in the contract — "a human operator identity for
// approvals") so an approval decision is attributable to the seat that made it.
//
// Untrusted input: the value is sanitised here — CR/LF stripped (it flows into the
// newline-delimited audit log) and length-capped — and is never used for auth or
// access control, only attribution.

export const SEAT_HEADER = 'x-oversight-seat'
const MAX_LEN = 120

export function seatFromHeaders(headers) {
  const raw = headers?.[SEAT_HEADER]
  if (typeof raw !== 'string') return null
  const cleaned = raw
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, MAX_LEN)
  return cleaned.length ? cleaned : null
}
