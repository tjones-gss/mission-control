// Node-built-in test suite for the pure-Node harness hooks. Run with:
//   node --test packages/harness/adapters/claude-code/.claude/hooks/
// Zero dependencies (node:test). This is the authoritative behavioral proof on a
// machine without jq; test_hook_parity.py additionally cross-checks the .sh hooks
// where bash+jq+node are all present (CI).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  extractCommand,
  normalizeWs,
  parseDangerYaml,
  loadDangerPatterns,
  matchDanger,
  FALLBACK_PATTERNS,
  normalizeDriveLetter,
  normalizeSlashes,
  computeRelPath,
  hasDotDotSegment,
  readYamlScalar,
  normalizeMission,
  normalizeMode,
  isBootstrapMode,
  missionFileFromIndex,
  parseMissionSection,
  matchPattern,
  isHarnessPath,
} from './_lib.mjs'

const HOOKS_DIR = path.dirname(fileURLToPath(import.meta.url))

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hooktest-'))
}

// Run a hook entrypoint with stdin + CLAUDE_PROJECT_DIR; return {status, stdout, stderr, json}.
function runHook(name, { input = '', projectDir, env = {} } = {}) {
  const r = spawnSync(process.execPath, [path.join(HOOKS_DIR, name)], {
    input,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir || process.cwd(), ...env },
  })
  let json = null
  const out = (r.stdout || '').trim()
  if (out.startsWith('{')) {
    try {
      json = JSON.parse(out)
    } catch {
      json = null
    }
  }
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', json }
}

const bashInput = (command) => JSON.stringify({ tool_input: { command } })
const editInput = (file_path) => JSON.stringify({ tool_input: { file_path } })

// ──────────────────────────────────────────────────────────────────────────────
// _lib unit tests
// ──────────────────────────────────────────────────────────────────────────────

test('extractCommand: valid/absent/invalid', () => {
  assert.deepEqual(extractCommand(bashInput('ls')), { ok: true, command: 'ls' })
  assert.deepEqual(extractCommand(JSON.stringify({ tool_input: {} })), { ok: true, command: '' })
  assert.deepEqual(extractCommand('not json'), { ok: false })
  assert.deepEqual(extractCommand(''), { ok: false }) // empty → fail closed
})

test('normalizeWs: lowercase + collapse all whitespace', () => {
  assert.equal(normalizeWs('RM   -RF\t/tmp'), 'rm -rf /tmp')
  assert.equal(normalizeWs('a\nb'), 'a b')
})

test('parseDangerYaml: tolerant block parse with quotes/CRLF', () => {
  const yaml = ['blocked_command_patterns:', '  - "Foo Bar"', "  - 'baz'", '  - qux', 'other_key: 1'].join(
    '\r\n',
  )
  assert.deepEqual(parseDangerYaml(yaml), ['foo bar', 'baz', 'qux'])
  assert.deepEqual(parseDangerYaml('nothing here'), [])
})

test('matchDanger: substring (fallback) + case-insensitive', () => {
  const m = matchDanger('sudo RM -rf /', FALLBACK_PATTERNS, 'src')
  assert.equal(m.kind, 'substr')
  assert.equal(m.label, 'rm -rf')
  assert.equal(matchDanger('echo hello', FALLBACK_PATTERNS, 'src'), null)
  assert.equal(matchDanger('DROP TABLE users', FALLBACK_PATTERNS, 'src').label, 'drop table')
})

test('matchDanger: regex variants', () => {
  const cases = [
    ['rm --recursive --force build', 'rm: recursive+force'],
    ['rm -fr node_modules', 'rm: recursive+force'],
    ['find . -name x -delete', 'find -delete'],
    ['git clean -fdx', 'git clean -f+dirs'],
    ['dd if=/dev/zero of=/dev/sda', 'dd to device'],
    ['mkfs.ext4 /dev/sdb', 'mkfs'],
    ['echo x > /dev/sda', 'overwrite block device'],
    ['chmod -R 777 /', 'chmod -R 777 root'],
    [':(){ :|:& };:', 'fork bomb'],
  ]
  for (const [cmd, label] of cases) {
    const m = matchDanger(cmd, FALLBACK_PATTERNS, 'src')
    assert.ok(m, `expected a match for: ${cmd}`)
    assert.equal(m.label, label, `wrong label for: ${cmd}`)
    assert.ok(m.source.includes('regex rule'))
  }
})

test('matchDanger: benign near-misses do NOT match', () => {
  for (const cmd of ['rm file.txt', 'npm run format', 'git status', 'grep -r foo .', 'mkdir build']) {
    assert.equal(matchDanger(cmd, FALLBACK_PATTERNS, 'src'), null, `false positive: ${cmd}`)
  }
})

test('normalizeSlashes + normalizeDriveLetter', () => {
  assert.equal(normalizeSlashes('a\\b\\c'), 'a/b/c')
  assert.equal(normalizeDriveLetter('/c/Users/x'), 'C:/Users/x')
  assert.equal(normalizeDriveLetter('c:/users/x'), 'C:/users/x')
  assert.equal(normalizeDriveLetter('relative/path'), 'relative/path')
})

test('computeRelPath: strips project prefix, handles equal', () => {
  assert.equal(computeRelPath('C:/proj/src/a.ts', 'C:/proj'), 'src/a.ts')
  assert.equal(computeRelPath('C:\\proj\\src\\a.ts', 'C:/proj'), 'src/a.ts')
  assert.equal(computeRelPath('/c/proj', '/c/proj'), '')
  assert.equal(computeRelPath('/d/other/x', '/c/proj'), 'D:/other/x')
})

test('hasDotDotSegment', () => {
  for (const p of ['..', '../x', 'a/..', 'a/../b']) assert.ok(hasDotDotSegment(p), p)
  for (const p of ['a/b', 'a..b', 'x.md', '']) assert.ok(!hasDotDotSegment(p), p)
})

test('readYamlScalar + normalizers', () => {
  const state = ['project:', '  mode: idea-to-mvp', 'current:', '  mission: MISSION-007  # active'].join('\n')
  assert.equal(readYamlScalar(state, 'project', 'mode'), 'idea-to-mvp')
  assert.equal(readYamlScalar(state, 'current', 'mission'), 'MISSION-007')
  assert.equal(normalizeMission('null'), '')
  assert.equal(normalizeMission('  MISSION-1 '), 'MISSION-1')
  assert.equal(normalizeMode(''), 'unset')
  assert.equal(isBootstrapMode('idea-to-mvp'), true)
  assert.equal(isBootstrapMode('build'), false)
})

test('missionFileFromIndex: indent-tracked file lookup', () => {
  const idx = [
    'MISSION-001:',
    '  file: runs/missions/MISSION-001-foo.md',
    '  status: ready',
    'MISSION-002:',
    '  file: runs/missions/MISSION-002-bar.md',
  ].join('\n')
  assert.equal(missionFileFromIndex(idx, 'MISSION-001'), 'runs/missions/MISSION-001-foo.md')
  assert.equal(missionFileFromIndex(idx, 'MISSION-002'), 'runs/missions/MISSION-002-bar.md')
  assert.equal(missionFileFromIndex(idx, 'MISSION-999'), null)
})

test('parseMissionSection: lists with quotes/backticks', () => {
  const md = [
    '## Allowed Files',
    '- src/**',
    '- "package.json"',
    '- `docs/specs/*.md`',
    '- application source files',
    '',
    '## Forbidden Files',
    '- src/secret.ts',
  ].join('\n')
  assert.deepEqual(parseMissionSection(md, /^##\s+Allowed Files/), [
    'src/**',
    'package.json',
    'docs/specs/*.md',
    'application source files',
  ])
  assert.deepEqual(parseMissionSection(md, /^##\s+Forbidden Files/), ['src/secret.ts'])
})

test('matchPattern: precedence + prose-skip + glob crosses slashes', () => {
  assert.equal(matchPattern('src/a.ts', 'src/**'), true)
  assert.equal(matchPattern('src/deep/a.ts', 'src/**'), true)
  assert.equal(matchPattern('lib/a.ts', 'src/**'), false)
  assert.equal(matchPattern('src/x/y.md', '*.md'), true) // * crosses '/' like bash [[ == ]]
  assert.equal(matchPattern('package.json', 'package.json'), true)
  assert.equal(matchPattern('src/', 'src/'), true)
  assert.equal(matchPattern('anything', 'application source files'), false) // prose-skip
})

test('isHarnessPath', () => {
  assert.ok(isHarnessPath('.harness/x.yml'))
  assert.ok(isHarnessPath('docs/adr/1.md'))
  assert.ok(isHarnessPath('CLAUDE.md'))
  assert.ok(!isHarnessPath('src/app.ts'))
})

// ──────────────────────────────────────────────────────────────────────────────
// block-danger.mjs (end-to-end)
// ──────────────────────────────────────────────────────────────────────────────

test('block-danger: denies rm -rf, allows benign, fails closed', () => {
  const deny = runHook('block-danger.mjs', { input: bashInput('rm -rf /tmp/x') })
  assert.equal(deny.status, 0)
  assert.equal(deny.json.hookSpecificOutput.permissionDecision, 'deny')

  const ok = runHook('block-danger.mjs', { input: bashInput('ls -la') })
  assert.equal(ok.status, 0)
  assert.equal(ok.stdout.trim(), '') // no output → normal flow

  const failClosed = runHook('block-danger.mjs', { input: 'garbage{' })
  assert.equal(failClosed.json.hookSpecificOutput.permissionDecision, 'deny')

  const absent = runHook('block-danger.mjs', { input: JSON.stringify({ tool_input: {} }) })
  assert.equal(absent.stdout.trim(), '') // valid JSON, no command → allow
})

test('block-danger: danger-zone.yml custom pattern is sourced', () => {
  const proj = mkTmp()
  fs.mkdirSync(path.join(proj, '.harness'), { recursive: true })
  fs.writeFileSync(
    path.join(proj, '.harness', 'danger-zone.yml'),
    'blocked_command_patterns:\n  - "deploy to prod"\n',
  )
  const r = runHook('block-danger.mjs', { input: bashInput('./deploy to prod now'), projectDir: proj })
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny')
  assert.ok(r.json.hookSpecificOutput.permissionDecisionReason.includes('.harness/danger-zone.yml'))
  fs.rmSync(proj, { recursive: true, force: true })
})

// ──────────────────────────────────────────────────────────────────────────────
// require-mission.mjs (end-to-end)
// ──────────────────────────────────────────────────────────────────────────────

function missionProject({ mode = 'build', mission = 'MISSION-001', allowed = [], forbidden = [] } = {}) {
  const proj = mkTmp()
  fs.mkdirSync(path.join(proj, '.harness'), { recursive: true })
  fs.writeFileSync(
    path.join(proj, '.harness', 'project-state.yml'),
    `project:\n  mode: ${mode}\ncurrent:\n  mission: ${mission}\n`,
  )
  if (mission && mission !== 'null') {
    fs.mkdirSync(path.join(proj, 'runs', 'missions'), { recursive: true })
    const mf = `runs/missions/${mission}-x.md`
    fs.writeFileSync(
      path.join(proj, '.harness', 'mission-index.yml'),
      `${mission}:\n  file: ${mf}\n`,
    )
    const sections = [
      '## Allowed Files',
      ...allowed.map((a) => `- ${a}`),
      '',
      '## Forbidden Files',
      ...forbidden.map((f) => `- ${f}`),
      '',
    ].join('\n')
    fs.writeFileSync(path.join(proj, mf), `# ${mission}\n\n${sections}`)
  }
  return proj
}

test('require-mission: allow within Allowed, deny outside, deny Forbidden', () => {
  const proj = missionProject({ allowed: ['src/**'], forbidden: ['src/secret.ts'] })

  const allow = runHook('require-mission.mjs', { input: editInput(`${proj}/src/a.ts`), projectDir: proj })
  assert.equal(allow.stdout.trim(), '') // allowed → no output

  const denyOut = runHook('require-mission.mjs', { input: editInput(`${proj}/lib/b.ts`), projectDir: proj })
  assert.equal(denyOut.json.hookSpecificOutput.permissionDecision, 'deny')

  const denyForbidden = runHook('require-mission.mjs', {
    input: editInput(`${proj}/src/secret.ts`),
    projectDir: proj,
  })
  assert.equal(denyForbidden.json.hookSpecificOutput.permissionDecision, 'deny')
  assert.ok(denyForbidden.json.hookSpecificOutput.permissionDecisionReason.includes('Forbidden'))
  fs.rmSync(proj, { recursive: true, force: true })
})

test('require-mission: traversal denied, no path passes through', () => {
  const proj = missionProject({ allowed: ['src/**'] })
  const trav = runHook('require-mission.mjs', { input: editInput(`${proj}/src/../secret.ts`), projectDir: proj })
  assert.equal(trav.json.hookSpecificOutput.permissionDecision, 'deny')
  assert.ok(trav.json.hookSpecificOutput.permissionDecisionReason.includes("'..'"))

  const nopath = runHook('require-mission.mjs', { input: JSON.stringify({ tool_input: {} }), projectDir: proj })
  assert.equal(nopath.stdout.trim(), '')
  fs.rmSync(proj, { recursive: true, force: true })
})

test('require-mission: harness path ask under mission, allow under bootstrap', () => {
  const strict = missionProject({ mode: 'build', allowed: ['src/**'] })
  const ask = runHook('require-mission.mjs', { input: editInput(`${strict}/docs/x.md`), projectDir: strict })
  assert.equal(ask.json.hookSpecificOutput.permissionDecision, 'ask')

  const boot = missionProject({ mode: 'idea-to-mvp', allowed: ['src/**'] })
  const allow = runHook('require-mission.mjs', { input: editInput(`${boot}/docs/x.md`), projectDir: boot })
  assert.equal(allow.stdout.trim(), '')
  fs.rmSync(strict, { recursive: true, force: true })
  fs.rmSync(boot, { recursive: true, force: true })
})

test('require-mission: app code with no mission asks', () => {
  const proj = mkTmp()
  fs.mkdirSync(path.join(proj, '.harness'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.harness', 'project-state.yml'), 'project:\n  mode: build\ncurrent:\n  mission: null\n')
  const ask = runHook('require-mission.mjs', { input: editInput(`${proj}/src/a.ts`), projectDir: proj })
  assert.equal(ask.json.hookSpecificOutput.permissionDecision, 'ask')
  fs.rmSync(proj, { recursive: true, force: true })
})

// ──────────────────────────────────────────────────────────────────────────────
// session-start + stop (end-to-end)
// ──────────────────────────────────────────────────────────────────────────────

test('session-start: silent without .harness, context with it', () => {
  const empty = mkTmp()
  const silent = runHook('session-start-load-state.mjs', { projectDir: empty })
  assert.equal(silent.stdout.trim(), '')

  const proj = mkTmp()
  fs.mkdirSync(path.join(proj, '.harness'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.harness', 'project-state.yml'), 'project:\n  mode: build\n')
  const ctx = runHook('session-start-load-state.mjs', { projectDir: proj })
  assert.ok(ctx.stdout.includes('[Harness context'))
  assert.ok(ctx.stdout.includes('=== .harness/project-state.yml ==='))
  fs.rmSync(empty, { recursive: true, force: true })
  fs.rmSync(proj, { recursive: true, force: true })
})

test('stop-note: advisory by default, blocks under enforce', () => {
  const proj = mkTmp()
  fs.mkdirSync(path.join(proj, '.harness'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.harness', 'project-state.yml'), 'current:\n  mission: MISSION-007\n')

  const advisory = runHook('stop-session-note-reminder.mjs', { projectDir: proj })
  assert.equal(advisory.status, 0)
  assert.ok(advisory.stdout.includes('[harness reminder]'))

  const blocked = runHook('stop-session-note-reminder.mjs', {
    projectDir: proj,
    env: { HARNESS_ENFORCE_SESSION_NOTE: '1' },
  })
  assert.equal(blocked.status, 2)
  assert.ok(blocked.stderr.includes('MISSION-007'))

  // A matching recent note clears it.
  fs.mkdirSync(path.join(proj, 'runs', 'session-notes'), { recursive: true })
  fs.writeFileSync(path.join(proj, 'runs', 'session-notes', '2026-06-08-MISSION-007.md'), 'work')
  const cleared = runHook('stop-session-note-reminder.mjs', {
    projectDir: proj,
    env: { HARNESS_ENFORCE_SESSION_NOTE: '1' },
  })
  assert.equal(cleared.status, 0)
  fs.rmSync(proj, { recursive: true, force: true })
})

test('stop-note: no mission is advisory-only', () => {
  const proj = mkTmp()
  const r = runHook('stop-session-note-reminder.mjs', { projectDir: proj, env: { HARNESS_ENFORCE_SESSION_NOTE: '1' } })
  assert.equal(r.status, 0)
  assert.ok(r.stdout.includes('advisory only'))
  fs.rmSync(proj, { recursive: true, force: true })
})

// loadDangerPatterns fallback when no yaml
test('loadDangerPatterns: fallback source when yaml missing', () => {
  const proj = mkTmp()
  const { patterns, source } = loadDangerPatterns(proj)
  assert.ok(patterns.includes('rm -rf'))
  assert.ok(source.includes('built-in fallback'))
  fs.rmSync(proj, { recursive: true, force: true })
})
