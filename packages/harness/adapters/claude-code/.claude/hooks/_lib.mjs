// Harness Claude-adapter hooks — shared pure-Node helpers.
//
// This is the Node port of the logic in block-danger.sh / require-mission.sh /
// session-start-load-state.sh / stop-session-note-reminder.sh. It uses ONLY Node
// built-ins (node:fs, node:path, node:process) because .claude/hooks/ is copied
// verbatim into arbitrary target projects — it can never depend on node_modules.
//
// Behavior is intended to be IDENTICAL to the shell hooks (proven by
// packages/harness/tests/test_hook_parity.py). The win over the shell hooks:
// JSON.parse replaces jq, so a machine with neither jq NOR bash still enforces.
//
// HONEST SCOPE: best-effort ACCIDENT prevention, not an adversarial sandbox — the
// same caveat the shell hooks carry. OS-level sandboxing is the real control.

import fs from 'node:fs'
import path from 'node:path'

// ──────────────────────────────────────────────────────────────────────────────
// tiny fs helpers (never throw)
// ──────────────────────────────────────────────────────────────────────────────

export function readFileSafe(p) {
  try {
    return fs.readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

export function isDir(p) {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

export function isFile(p) {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

// List *.md under dir (depth ≤ 2, matching `find -maxdepth 2`) modified within the
// last maxAgeMinutes, sorted for determinism. Mirrors the stop-hook `find -mmin`.
export function findRecentMarkdown(dir, maxAgeMinutes) {
  const cutoff = Date.now() - maxAgeMinutes * 60 * 1000
  const out = []
  const scan = (d, depth) => {
    let entries
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) {
        if (depth < 2) scan(full, depth + 1)
      } else if (e.isFile() && e.name.endsWith('.md')) {
        let mtime
        try {
          mtime = fs.statSync(full).mtimeMs
        } catch {
          continue
        }
        if (mtime >= cutoff) out.push(full)
      }
    }
  }
  scan(dir, 1)
  return out.sort()
}

// ──────────────────────────────────────────────────────────────────────────────
// stdin
// ──────────────────────────────────────────────────────────────────────────────

// Read all of stdin to a string. Mirrors INPUT="$(cat)" in the shell hooks.
export async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

// ──────────────────────────────────────────────────────────────────────────────
// block-danger: command extraction + danger matching
// ──────────────────────────────────────────────────────────────────────────────

// Extract .tool_input.command. Mirrors the jq path of extract_command:
//  - invalid JSON (incl. empty/whitespace input)  → { ok:false }  (caller FAILS CLOSED)
//  - valid JSON, command field absent/null         → { ok:true, command:'' }
//  - valid JSON, command present                    → { ok:true, command:String(cmd) }
export function extractCommand(input) {
  let parsed
  try {
    parsed = JSON.parse(input)
  } catch {
    return { ok: false }
  }
  const cmd = parsed && parsed.tool_input ? parsed.tool_input.command : undefined
  if (cmd === undefined || cmd === null) return { ok: true, command: '' }
  return { ok: true, command: String(cmd) }
}

// Built-in fallback list (LOWERCASE — matching is case-insensitive). Kept in sync
// with .harness/danger-zone.yml so behavior is reasonable when the YAML is missing
// or unreadable. Mirrors FALLBACK_PATTERNS in block-danger.sh.
export const FALLBACK_PATTERNS = [
  'rm -rf',
  'drop table',
  'drop database',
  'delete from',
  'truncate table',
  'terraform apply',
  'terraform destroy',
  'kubectl delete',
  'vercel --prod',
  'railway down',
  'stripe live',
  'firebase deploy --only hosting:prod',
  'aws s3 rb',
  'gcloud sql instances delete',
]

// Regex rules for destructive VARIANTS a flat substring list misses. Each bash ERE
// from DANGER_REGEXES is hand-translated to a JS RegExp ([[:space:]] → \s). They are
// applied to the normalized, lowercased command (so no flags needed) and are
// unanchored, matching bash [[ =~ ]] semantics. Best-effort only.
export const DANGER_REGEXES = [
  {
    // Label must match the shell DANGER_REGEXES entry EXACTLY (it is emitted in
    // the deny reason and asserted by test_hook_parity.py): "rm: recursive+force rm".
    label: 'rm: recursive+force rm',
    re: /(^|[^a-z])rm(\s+-[a-z]*r[a-z]*\s+-[a-z]*f|\s+-[a-z]*f[a-z]*\s+-[a-z]*r|\s+-[a-z]*(rf|fr)[a-z]*|\s.*(--recursive|--force).*(--force|--recursive))/,
  },
  { label: 'find -delete', re: /(^|[^a-z])find(\s+.*)?\s-delete(\s|$)/ },
  {
    label: 'git clean -f+dirs',
    re: /(^|[^a-z])git\s+clean(\s+.*)?\s-([a-z]*f[a-z]*[dx]|[dx][a-z]*f)(\s|$)/,
  },
  {
    label: 'git clean --force',
    re: /(^|[^a-z])git\s+clean(\s+.*)?(--force).*(-d|-x|--ignored)/,
  },
  {
    label: 'overwrite block device',
    re: />\s*\/dev\/(sd[a-z]|nvme[0-9]|disk[0-9]|hd[a-z]|vd[a-z])/,
  },
  { label: 'dd to device', re: /(^|[^a-z])dd\s.*of=\s*\/dev\// },
  { label: 'mkfs', re: /(^|[^a-z])mkfs(\.[a-z0-9]+)?\s/ },
  {
    label: 'chmod -R 777 root',
    re: /(^|[^a-z])chmod\s+(-[a-z]*r[a-z]*\s+)?(--recursive\s+)?0?777\s+\/($|\s)/,
  },
  { label: 'fork bomb', re: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/ },
]

// Lowercase + collapse all whitespace (incl. newlines/tabs) to single spaces.
// Mirrors "${s,,}" then `tr -s '[:space:]' ' '`.
export function normalizeWs(s) {
  return String(s).toLowerCase().replace(/\s+/g, ' ')
}

// Tolerant parser for blocked_command_patterns in danger-zone.yml. No YAML lib —
// grep the block like the shell does. Returns a lowercased pattern array (possibly
// empty); the caller falls back to FALLBACK_PATTERNS when empty/unreadable.
export function parseDangerYaml(content) {
  const out = []
  if (typeof content !== 'string') return out
  let inBlock = false
  for (let line of content.split('\n')) {
    line = line.replace(/\r$/, '') // tolerate CRLF
    if (/^blocked_command_patterns:/.test(line)) {
      inBlock = true
      continue
    }
    if (inBlock) {
      if (/^[a-zA-Z_]/.test(line)) break // next top-level key
      const stripped = line.replace(/^\s+/, '')
      const m = /^-\s*(.+)$/.exec(stripped)
      if (m) {
        let val = m[1]
        val = val.replace(/^"/, '').replace(/"$/, '')
        val = val.replace(/^'/, '').replace(/'$/, '')
        out.push(val.toLowerCase())
      }
    }
  }
  return out
}

// Load danger patterns for a project. { patterns, source } — built-in fallback
// when danger-zone.yml is missing/unreadable/empty.
export function loadDangerPatterns(projectDir) {
  const yamlPath = path.join(projectDir, '.harness', 'danger-zone.yml')
  let content = null
  try {
    content = fs.readFileSync(yamlPath, 'utf8')
  } catch {
    content = null
  }
  const parsed = content != null ? parseDangerYaml(content) : []
  if (parsed.length > 0) return { patterns: parsed, source: '.harness/danger-zone.yml' }
  return {
    patterns: [...FALLBACK_PATTERNS],
    source: 'built-in fallback (danger-zone.yml unreadable)',
  }
}

// Check a command against substring patterns then regex rules. Returns the first
// match { kind:'substr'|'regex', label, source } or null. Substring patterns win
// over regex rules, mirroring the shell ordering.
export function matchDanger(command, patterns, source) {
  const cmdNorm = normalizeWs(command)
  for (const pattern of patterns) {
    const patNorm = normalizeWs(pattern)
    if (cmdNorm.includes(patNorm)) return { kind: 'substr', label: pattern, source }
  }
  for (const { label, re } of DANGER_REGEXES) {
    if (re.test(cmdNorm)) return { kind: 'regex', label, source: `${source} (regex rule)` }
  }
  return null
}

// Build the block-danger deny reason string. Mirrors the shell emit_deny text
// EXACTLY (the \n are real newlines; JSON.stringify escapes them like jq does).
export function denyReason(pattern, command, source) {
  return (
    `Blocked by harness danger-zone policy (source: ${source}).\n` +
    `Matched pattern: "${pattern}"\n` +
    `Command was: ${command}\n` +
    `If this operation is intentional and approved, follow .harness/human-approval-policy.yml: ` +
    `request explicit human approval and retry in an interactive turn. Do not bypass this hook silently.`
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Permission-decision JSON builders (shared)
// ──────────────────────────────────────────────────────────────────────────────

// PreToolUse decision document. Key order matches the jq programs so structural
// (and pretty-printed) output lines up with the shell hooks.
export function preToolUseDecision(decision, reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  }
}

// Print a decision document as 2-space-indented JSON (matches jq's default indent).
export function emitDecision(doc) {
  process.stdout.write(JSON.stringify(doc, null, 2) + '\n')
}

// ──────────────────────────────────────────────────────────────────────────────
// require-mission: path normalization
// ──────────────────────────────────────────────────────────────────────────────

export function extractFilePath(input) {
  let parsed
  try {
    parsed = JSON.parse(input)
  } catch {
    return ''
  }
  const ti = parsed && parsed.tool_input ? parsed.tool_input : {}
  return ti.file_path || ti.notebook_path || ''
}

export function normalizeSlashes(p) {
  return String(p).replace(/\\/g, '/')
}

// /c/Users → C:/Users ; c:/users → C:/users. Mirrors normalize_drive_letter.
export function normalizeDriveLetter(p) {
  if (/^\/[a-zA-Z]\//.test(p)) {
    const drive = p[1].toUpperCase()
    return `${drive}:${p.slice(2)}`
  }
  if (/^[a-zA-Z]:/.test(p)) {
    const drive = p[0].toUpperCase()
    return `${drive}:${p.slice(2)}`
  }
  return p
}

// Compute the project-relative path for matching. Mirrors the REL_PATH block.
export function computeRelPath(filePath, projectDir) {
  const proj = normalizeDriveLetter(normalizeSlashes(projectDir))
  let rel = normalizeDriveLetter(normalizeSlashes(filePath))
  if (rel.startsWith(proj + '/')) rel = rel.slice(proj.length + 1)
  else if (rel === proj) rel = ''
  return rel
}

// True if the relpath contains a '..' path segment (matches the shell case list:
// .. | ../* | */.. | */../*).
export function hasDotDotSegment(rel) {
  if (rel === '..') return true
  if (rel.startsWith('../')) return true
  if (rel.endsWith('/..')) return true
  if (rel.includes('/../')) return true
  return false
}

// ──────────────────────────────────────────────────────────────────────────────
// require-mission / stop-note: tolerant YAML + mission lookup
// ──────────────────────────────────────────────────────────────────────────────

// Read a flat dotted scalar (top → sub) from YAML content. No PyYAML — walk lines
// like the awk fallback. Returns the (comment/quote-stripped) value or null.
export function readYamlScalar(content, top, sub) {
  if (typeof content !== 'string') return null
  let inTop = false
  for (let line of content.split('\n')) {
    line = line.replace(/\r$/, '')
    if (/^[A-Za-z_]/.test(line)) {
      inTop = new RegExp('^' + top + ':').test(line)
      continue
    }
    if (inTop) {
      const re = new RegExp('^\\s+' + sub + ':\\s*(.*)$')
      const m = re.exec(line)
      if (m) {
        let val = m[1]
        val = val.replace(/\s*#.*$/, '') // strip trailing comment
        val = val.trim()
        val = val.replace(/^["']/, '').replace(/["']$/, '')
        return val
      }
    }
  }
  return null
}

// Normalize a current.mission value: "", null, None, unset → '' (no mission).
export function normalizeMission(v) {
  if (v == null) return ''
  const s = String(v).trim()
  if (s === '' || s === 'null' || s === 'None' || s === 'unset') return ''
  return s
}

// Normalize a project.mode value: null/None/'' → 'unset'.
export function normalizeMode(v) {
  if (v == null) return 'unset'
  const s = String(v).trim()
  if (s === '' || s === 'null' || s === 'None') return 'unset'
  return s
}

export function isBootstrapMode(mode) {
  return mode === 'idea-to-mvp' || mode === 'existing-repo-retrofit'
}

// Find the `file:` value for a mission id in mission-index.yml content. Mirrors the
// indent-tracking awk. Returns the relative path string or null.
export function missionFileFromIndex(content, missionId) {
  if (typeof content !== 'string') return null
  const lines = content.split('\n')
  let inMission = false
  let indentSeen = 0
  const idRe = new RegExp('^\\s*' + escapeRegExp(missionId) + ':\\s*$')
  for (let line of lines) {
    line = line.replace(/\r$/, '')
    if (!inMission) {
      if (idRe.test(line)) {
        inMission = true
        indentSeen = 0
      }
      continue
    }
    // inMission
    const indentMatch = /^(\s*)/.exec(line)
    const curIndent = indentMatch ? indentMatch[1].length : 0
    if (line.length === 0) continue
    if (indentSeen === 0 && curIndent > 0) indentSeen = curIndent
    // A less-indented key line ends the block.
    if (indentSeen > 0 && curIndent < indentSeen && /^\s*[A-Za-z_][A-Za-z0-9_-]*:/.test(line)) {
      inMission = false
      continue
    }
    const m = /^\s+file:\s*(.*)$/.exec(line)
    if (m) {
      let val = m[1]
      val = val.replace(/\s*#.*$/, '').trim()
      val = val.replace(/^["']/, '').replace(/["']$/, '')
      return val
    }
  }
  return null
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Parse a markdown list section ("## Allowed Files" / "## Forbidden Files"). Returns
// the list items (leading "- " stripped, surrounding quote/backtick stripped).
// Mirrors parse_mission_section.
export function parseMissionSection(content, headerRe) {
  const out = []
  if (typeof content !== 'string') return out
  let inSec = false
  for (let line of content.split('\n')) {
    line = line.replace(/\r$/, '')
    if (/^##\s/.test(line)) {
      if (headerRe.test(line)) {
        inSec = true
        continue
      } else if (inSec) {
        inSec = false
      }
    }
    if (inSec && /^-\s/.test(line)) {
      let item = line.replace(/^-\s+/, '').replace(/\s+$/, '')
      item = item.replace(/^["'`]/, '').replace(/["'`]$/, '')
      if (item.length > 0) out.push(item)
    }
  }
  return out
}

// ──────────────────────────────────────────────────────────────────────────────
// require-mission: glob matching + harness-owned paths
// ──────────────────────────────────────────────────────────────────────────────

export const HARNESS_PREFIXES = [
  '.harness/',
  '.claude/',
  '.github/',
  'docs/',
  'runs/',
  'agents/',
  'pipelines/',
  'prompts/',
  'adapters/',
  'tools/',
  'cli/',
  'tests/',
]

export const HARNESS_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
  'ARTIFACTS_MANIFEST.md',
  'CHANGELOG.md',
]

export function isHarnessPath(rel) {
  for (const pre of HARNESS_PREFIXES) if (rel.startsWith(pre)) return true
  for (const f of HARNESS_FILES) if (rel === f) return true
  return false
}

// Match a relpath against a mission pattern. Mirrors match_pattern precedence:
// prose-skip → exact → trailing-'/' prefix → '/**' prefix → glob (* and ?, ** as *).
export function matchPattern(p, pat) {
  // Prose-only entries ("application source files"): space, no slash, no dot → skip.
  if (pat.includes(' ') && !pat.includes('/') && !pat.includes('.')) return false
  if (p === pat) return true
  if (pat.endsWith('/')) return p.startsWith(pat)
  if (pat.endsWith('/**')) {
    const prefix = pat.slice(0, -'/**'.length) + '/'
    return p.startsWith(prefix)
  }
  return globToRegExp(pat).test(p)
}

// Convert a glob (supporting * ? and ** treated as *) into an anchored RegExp.
// NOTE: bash `[[ string == pattern ]]` is NOT pathname-aware — `*` matches ANY
// characters incl. '/', and `?` matches ANY single char incl. '/'. So for parity
// `*` → `.*` and `?` → `.` (do NOT use [^/]). `**` collapses to a single `*`.
function globToRegExp(glob) {
  let re = '^'
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '*') {
      if (glob[i + 1] === '*') i++ // collapse ** into a single *
      re += '.*'
    } else if (ch === '?') {
      re += '.'
    } else {
      re += escapeRegExp(ch)
    }
  }
  re += '$'
  return new RegExp(re)
}
