import fs from 'fs'
import { emit } from '../sse.js'
import { logger } from './logger.js'

// Centralized parser version-guard + graceful-degrade layer.
//
// The cockpit is a *window* onto Claude Code's on-disk state under ~/.claude.
// That format is owned by Claude Code and can change under us on any update.
// The dangerous failure mode is the *silent* one: a parser swallows a parse
// error, returns [] or a bare {}, and the dashboard renders "no sessions" or
// "no guardrails active" when the truth is "we could not read your data." A
// blank that looks like a fact is a lie.
//
// This module draws the one distinction that matters and makes it loud:
//
//   - ABSENT / EMPTY  — the file/dir is missing, or present-but-empty. This is
//     NORMAL. A fresh machine has no sessions; a project may configure no
//     hooks. Return the natural empty value ([] or {}); do NOT degrade.
//
//   - PRESENT-BUT-UNPARSEABLE — the file exists with content, but we cannot
//     make sense of it (JSON parse failure, lines>0/parsed==0, a scan that
//     should have found a field and did not). This is DEGRADED. Return a
//     distinguishable degraded MARKER (never [] and never a bare {}) AND emit a
//     persistent `parser_degraded` SSE event so the UI can surface a banner.
//
// The marker is an object carrying a non-enumerable-ish discriminator key so it
// never collides with real parsed data and is trivially testable.

export const DEGRADED_MARKER = '__claudeFormatDegraded'

/**
 * Build a degraded marker. Distinct from [] and from a bare {} so the UI can
 * tell "we could not read this" apart from "there is nothing here."
 *
 * @param {string} parser  the parser name (e.g. 'sessions', 'config', 'hooks')
 * @param {string} reason  short machine-ish reason ('parse-failed', 'format-change', 'scan-miss')
 * @param {object} [detail] optional extra context (filePath, lineCount, ...)
 */
export function makeDegraded(parser, reason, detail = {}) {
  return {
    [DEGRADED_MARKER]: true,
    parser,
    reason,
    ...detail,
  }
}

/**
 * Is this value a degraded marker (as opposed to real data, [], or a bare {})?
 */
export function isDegraded(value) {
  return Boolean(
    value && typeof value === 'object' && !Array.isArray(value) && value[DEGRADED_MARKER] === true,
  )
}

// Dedupe SSE noise: a degraded read can happen on every poll/scan. We only want
// to announce a given (parser, reason) transition once per process, the same
// way the old one-shot console.warn behaved — but as a persistent, structured
// signal instead of a single line buried in stdout.
//
// Keyed by `${parser}:${reason}`; the value is the {parser, reason} pair so the
// same registry that dedupes the SSE event also serves as the source of truth
// for active degraded signals (exposed on GET /api/health as schema_warnings).
const announced = new Map()

/**
 * Reset the dedupe set. Test-only seam.
 */
export function _resetDegradedDedupe() {
  announced.clear()
}

/**
 * The set of currently-active degraded-parser signals, one {parser, reason} per
 * distinct (parser, reason) that has degraded this process. Returns [] when no
 * parser has degraded. Consumed by GET /api/health as schema_warnings.
 */
export function getDegradedSignals() {
  return Array.from(announced.values())
}

/**
 * Emit a persistent `parser_degraded` SSE event, deduped per (parser, reason).
 * Returns the degraded marker for convenience so callers can `return
 * signalDegraded(...)`.
 */
export function signalDegraded(parser, reason, detail = {}) {
  const key = `${parser}:${reason}`
  const marker = makeDegraded(parser, reason, detail)
  if (announced.has(key)) return marker
  announced.set(key, { parser, reason })
  logger.warn(
    { parser, reason, ...detail },
    'parser_degraded — Claude data present but unparseable (Claude Code may have updated)',
  )
  try {
    emit('parser_degraded', { parser, reason, ...detail })
  } catch (err) {
    logger.warn({ err, parser, reason }, 'parser_degraded_emit_failed')
  }
  return marker
}

/**
 * Read + JSON.parse a ~/.claude file, distinguishing absent/empty (normal) from
 * present-but-unparseable (degraded). On degradation it both returns a degraded
 * marker as `value` AND emits the SSE event.
 *
 * @param {string} filePath
 * @param {string} parser  the parser name for the SSE event
 * @param {{ fsImpl?: typeof fs }} [opts]  fsImpl is a test seam
 * @returns {{ status: 'absent'|'ok'|'degraded', value: any }}
 */
export function readClaudeJson(filePath, parser, opts = {}) {
  const fsImpl = opts.fsImpl || fs
  if (!fsImpl.existsSync(filePath)) {
    return { status: 'absent', value: null }
  }
  let raw
  try {
    raw = fsImpl.readFileSync(filePath, 'utf-8')
  } catch (err) {
    // Present (existsSync said so) but unreadable — treat as degraded, not
    // "none configured". A permission flip or a race shouldn't silently read as
    // "no guardrails."
    return {
      status: 'degraded',
      value: signalDegraded(parser, 'read-failed', { filePath, err: String(err) }),
    }
  }
  if (!raw || !raw.trim()) {
    // Present-but-empty file is normal (e.g. a touched settings.json).
    return { status: 'absent', value: null }
  }
  try {
    return { status: 'ok', value: JSON.parse(raw) }
  } catch {
    return { status: 'degraded', value: signalDegraded(parser, 'parse-failed', { filePath }) }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// PARSER COVERAGE — every ~/.claude reader is now degrade-guarded (council HIGH #1).
//
// Critical three (1e):
//   [x] parsers/sessions.js      — lines>0/parsed==0 → persistent degraded marker + SSE
//   [x] parsers/config.js        — present-but-unparseable settings.json → degraded, not {}
//   [x] parsers/hooks.js         — present-but-unparseable settings.json → degraded, not {}
//   [x] lib/session-discovery.js — 8KB scan miss → degraded/diagnostic signal, not silent drop
//
// Remaining parsers (loose-end #3 — present-but-unparseable → degraded, never silent-empty):
//   [x] parsers/mcp.js           — unparseable ~/.claude.json/settings → servers list flagged degraded
//   [x] parsers/memory.js        — session JSONL all-lines-fail → degraded (cwd resolution)
//   [x] parsers/skills.js        — unparseable installed_plugins.json/settings → response.pluginsDegraded
//   [x] parsers/plans.js         — present-but-unreadable PLANS_DIR → degraded
//   [x] parsers/history.js       — history.jsonl lines>0/parsed==0 → degraded
//   [x] parsers/tasks.js         — task dir .json all-fail → degraded
//   [x] parsers/teams.js         — unparseable team config.json / inbox → degraded element, not dropped
//   [x] parsers/conductor.js     — unparseable status.json → degraded run, not a silent drop
//   [x] parsers/messages.js      — session JSONL all-lines-fail → degraded, not empty message list
//
// Note: list-returning parsers (history/tasks/plans) keep returning the tolerant []
// to their routes (wire contract) — the persistent deduped parser_degraded SSE event
// IS the signal the client banner consumes. Object/array returns (mcp/memory/skills/
// teams/conductor/messages) carry a distinguishable degraded marker/flag.
// ───────────────────────────────────────────────────────────────────────────
