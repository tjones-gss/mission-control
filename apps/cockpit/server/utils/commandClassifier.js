// Bash command classifier — ported from ClaudeCodeSource/src/bash_security/
// Classifies shell commands by risk level for the tool approval UI.

// ── Classifications ──────────────────────────────────────────────────────────

export const Classification = Object.freeze({
  SAFE_READONLY: 'SAFE_READONLY',
  DESTRUCTIVE: 'DESTRUCTIVE',
  CODE_EXECUTION: 'CODE_EXECUTION',
  REQUIRES_REVIEW: 'REQUIRES_REVIEW',
  UNKNOWN: 'UNKNOWN',
})

// Severity order (higher index = worse)
const SEVERITY = [
  Classification.SAFE_READONLY,
  Classification.UNKNOWN,
  Classification.REQUIRES_REVIEW,
  Classification.CODE_EXECUTION,
  Classification.DESTRUCTIVE,
]

// ── Safe command sets ────────────────────────────────────────────────────────

const GIT_READONLY = new Set([
  'log',
  'show',
  'diff',
  'status',
  'branch',
  'remote -v',
  'ls-files',
  'rev-parse',
  'tag -l',
  'describe',
  'shortlog',
  'stash list',
  'reflog',
  'blame',
])

const DOCKER_READONLY = new Set([
  'ps',
  'inspect',
  'images',
  'logs',
  'stats',
  'info',
  'version',
  'network ls',
  'volume ls',
  'top',
])

const GH_READONLY = new Set([
  'pr list',
  'pr view',
  'issue list',
  'issue view',
  'run list',
  'run view',
  'repo view',
  'release list',
  'api',
])

const READONLY_SUBCOMMANDS = {
  git: GIT_READONLY,
  docker: DOCKER_READONLY,
  gh: GH_READONLY,
}

const SEARCH_COMMANDS = new Set([
  'rg',
  'grep',
  'find',
  'locate',
  'fd',
  'ag',
  'fzf',
  'which',
  'whereis',
  'type',
])

const READ_COMMANDS = new Set([
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'wc',
  'file',
  'stat',
  'du',
  'df',
  'ls',
  'tree',
  'pwd',
  'date',
  'whoami',
  'uname',
  'hostname',
  'id',
  'env',
  'printenv',
  'echo',
])

// ── Dangerous patterns ───────────────────────────────────────────────────────

// Each entry: [pattern, description]
const DESTRUCTIVE_COMMANDS = [
  ['rm', 'Remove files'],
  ['rm -rf', 'Recursive force remove'],
  ['rmdir', 'Remove directory'],
  ['dd', 'Raw disk write'],
  ['mkfs', 'Create filesystem (destroys data)'],
  ['fdisk', 'Partition table editor'],
  ['git reset --hard', 'Discard all uncommitted changes'],
  ['git push --force', 'Force push (rewrites remote history)'],
  ['git push -f', 'Force push (short flag)'],
  ['git clean', 'Remove untracked files'],
  ['git clean -fd', 'Force remove untracked files and directories'],
  ['chmod -R', 'Recursive permission change'],
  ['chown -R', 'Recursive ownership change'],
  ['mv /', 'Move root paths'],
  ['cp /', 'Overwrite root paths'],
  ['truncate', 'Truncate file to size'],
  ['> ', 'Redirect overwrite (clobber)'],
]

// Each entry: [pattern, description]
const CODE_EXECUTION_PATTERNS = [
  ['python', 'Python interpreter'],
  ['python3', 'Python 3 interpreter'],
  ['node', 'Node.js runtime'],
  ['deno', 'Deno runtime'],
  ['tsx', 'TSX runner'],
  ['ruby', 'Ruby interpreter'],
  ['perl', 'Perl interpreter'],
  ['php', 'PHP interpreter'],
  ['lua', 'Lua interpreter'],
  ['npm run', 'npm script runner'],
  ['npx', 'npm package executor'],
  ['yarn run', 'Yarn script runner'],
  ['pnpm run', 'pnpm script runner'],
  ['bun run', 'Bun script runner'],
  ['bash -c', 'Bash inline execution'],
  ['sh -c', 'Shell inline execution'],
  ['ssh', 'Remote shell execution'],
  ['bash', 'Bash shell'],
  ['sh', 'POSIX shell'],
  ['zsh', 'Z shell'],
  ['eval', 'Shell eval builtin'],
  ['exec', 'Shell exec builtin'],
  ['source', 'Shell source builtin'],
]

const DANGEROUS_ENV_VARS = new Set([
  'PROMPT_COMMAND',
  'PS4',
  'BASH_ENV',
  'ENV',
  'BASH_FUNC_',
  'SHELLOPTS',
  'BASHOPTS',
  'GLOBIGNORE',
  'CDPATH',
  'IFS',
  'PATH',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'PERL5OPT',
  'PYTHONPATH',
  'PYTHONSTARTUP',
  'RUBYOPT',
  'NODE_OPTIONS',
  'NODE_PATH',
])

const DANGEROUS_ZSH_COMMANDS = new Set([
  'zmodload',
  'ztcp',
  'zpty',
  'mapfile',
  'zf_open',
  'zf_close',
  'zf_read',
  'zf_seek',
  'zf_mkdir',
  'zf_rm',
  'zf_rmdir',
  'zf_ln',
  'zf_mv',
  'zsocket',
  'zselect',
  'zcompile',
])

// ── Pre-compiled regex ───────────────────────────────────────────────────────

const COMPOUND_SPLIT_RE = /\s*(?:&&|\|\||[;|])\s*/
const ENV_PREFIX_RE = /^(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]*\s+)*/
const DANGEROUS_ENV_RE = /^([A-Za-z_][A-Za-z0-9_]*)=/

// ── Human-readable descriptions per classification ───────────────────────────

const CLASSIFICATION_DESCRIPTIONS = {
  [Classification.SAFE_READONLY]: 'Read-only command',
  [Classification.DESTRUCTIVE]: 'Destructive command that may cause data loss',
  [Classification.CODE_EXECUTION]: 'Executes code or spawns a runtime',
  [Classification.REQUIRES_REVIEW]: 'Requires manual review before execution',
  [Classification.UNKNOWN]: 'Unknown command — review recommended',
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Split a compound command on &&, ||, ;, and |.
 * Basic tokeniser — not a full shell parser.
 * @param {string} command
 * @returns {string[]}
 */
export function splitCompound(command) {
  const parts = command.split(COMPOUND_SPLIT_RE)
  return parts.filter((p) => p.trim())
}

/**
 * Extract the first word / executable from a command string.
 * Strips leading env-var assignments (FOO=bar cmd ...).
 * @param {string} command
 * @returns {string}
 */
export function getBaseCommand(command) {
  const stripped = command.replace(ENV_PREFIX_RE, '').trim()
  if (!stripped) return ''
  return stripped.split(/\s+/)[0]
}

/**
 * Classify a full (possibly compound) command string.
 * For compound commands, returns the worst-case classification.
 * @param {string} command
 * @returns {{ classification: string, description: string, isReadOnly: boolean, isDestructive: boolean }}
 */
export function classify(command) {
  if (!command || typeof command !== 'string') {
    return buildResult(Classification.UNKNOWN)
  }

  const parts = splitCompound(command)
  const classifications = parts.map((part) => classifySingle(part.trim()))

  // Worst-case wins
  let worst = Classification.SAFE_READONLY
  let worstSeverity = 0
  for (const c of classifications) {
    const idx = SEVERITY.indexOf(c)
    if (idx > worstSeverity) {
      worstSeverity = idx
      worst = c
    }
  }

  // Find a matching description from the specific pattern that triggered it
  const specificDesc = getSpecificDescription(command, worst)
  return buildResult(worst, specificDesc)
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function buildResult(classification, specificDescription) {
  return {
    classification,
    description: specificDescription || CLASSIFICATION_DESCRIPTIONS[classification],
    isReadOnly: classification === Classification.SAFE_READONLY,
    isDestructive: classification === Classification.DESTRUCTIVE,
  }
}

function classifySingle(command) {
  if (!command) return Classification.UNKNOWN

  const base = getBaseCommand(command)
  if (!base) return Classification.UNKNOWN

  // Dangerous env vars in assignments (checked first)
  if (hasDangerousEnvPrefix(command)) return Classification.REQUIRES_REVIEW

  // Safe read-only shortcuts
  if (READ_COMMANDS.has(base) || SEARCH_COMMANDS.has(base)) return Classification.SAFE_READONLY

  // Subcommand-aware check (git, docker, gh)
  if (READONLY_SUBCOMMANDS[base]) {
    const baseIdx = command.indexOf(base)
    const remainder = command.slice(baseIdx + base.length).trim()
    const readonlySubs = READONLY_SUBCOMMANDS[base]
    // Sort by length descending so longer subcommands match first
    const sorted = [...readonlySubs].sort((a, b) => b.length - a.length)
    for (const sub of sorted) {
      if (remainder === sub || remainder.startsWith(sub + ' ')) {
        return Classification.SAFE_READONLY
      }
    }
  }

  // Destructive
  if (matchesDestructive(base, command)) return Classification.DESTRUCTIVE

  // Code execution
  if (matchesCodeExecution(base, command)) return Classification.CODE_EXECUTION

  // Dangerous zsh builtins
  if (DANGEROUS_ZSH_COMMANDS.has(base)) return Classification.DESTRUCTIVE

  return Classification.UNKNOWN
}

function matchesDestructive(base, command) {
  for (const [pattern] of DESTRUCTIVE_COMMANDS) {
    const parts = pattern.split(/\s+/)
    if (parts[0] === base) {
      if (parts.length === 1) return true
      // Multi-word pattern: check the full command contains all flags
      if (parts.slice(1).every((flag) => command.includes(flag))) return true
    }
  }
  return false
}

function matchesCodeExecution(base, command) {
  for (const [pattern] of CODE_EXECUTION_PATTERNS) {
    const parts = pattern.split(/\s+/)
    if (parts[0] === base) {
      if (parts.length === 1) return true
      // Multi-word pattern (e.g. "npm run")
      const baseIdx = command.indexOf(base)
      const remainder = command.slice(baseIdx + base.length).trim()
      const suffix = parts.slice(1).join(' ')
      if (remainder.startsWith(suffix)) return true
    }
  }
  return false
}

function hasDangerousEnvPrefix(command) {
  const match = command.match(DANGEROUS_ENV_RE)
  if (!match) return false

  const varName = match[1]
  if (DANGEROUS_ENV_VARS.has(varName)) return true

  // Check prefix match (BASH_FUNC_*)
  for (const dv of DANGEROUS_ENV_VARS) {
    if (dv.endsWith('_') && varName.startsWith(dv)) return true
  }
  return false
}

/**
 * Get a more specific description by finding which pattern matched.
 */
function getSpecificDescription(command, classification) {
  if (classification === Classification.DESTRUCTIVE) {
    const base = getBaseCommand(command)
    // Find the most specific (longest) matching pattern
    let bestDesc = null
    let bestLen = 0
    for (const [pattern, desc] of DESTRUCTIVE_COMMANDS) {
      const parts = pattern.split(/\s+/)
      if (parts[0] === base) {
        if (parts.length === 1 && pattern.length > bestLen) {
          bestDesc = desc
          bestLen = pattern.length
        } else if (
          parts.slice(1).every((flag) => command.includes(flag)) &&
          pattern.length > bestLen
        ) {
          bestDesc = desc
          bestLen = pattern.length
        }
      }
    }
    if (bestDesc) return bestDesc
    // Check zsh
    if (DANGEROUS_ZSH_COMMANDS.has(base)) return `Dangerous zsh builtin: ${base}`
  }

  if (classification === Classification.CODE_EXECUTION) {
    const base = getBaseCommand(command)
    let bestDesc = null
    let bestLen = 0
    for (const [pattern, desc] of CODE_EXECUTION_PATTERNS) {
      const parts = pattern.split(/\s+/)
      if (parts[0] === base) {
        if (parts.length === 1 && pattern.length > bestLen) {
          bestDesc = desc
          bestLen = pattern.length
        } else {
          const baseIdx = command.indexOf(base)
          const remainder = command.slice(baseIdx + base.length).trim()
          const suffix = parts.slice(1).join(' ')
          if (remainder.startsWith(suffix) && pattern.length > bestLen) {
            bestDesc = desc
            bestLen = pattern.length
          }
        }
      }
    }
    if (bestDesc) return bestDesc
  }

  return null
}
