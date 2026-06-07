import { spawn } from 'child_process'
import { getClaudeBin, isShellScript } from './lib/claude-bin.js'

/**
 * Spawn the claude CLI as a subprocess with proper environment isolation.
 * @param {object} options
 * @param {string[]} options.args - CLI arguments
 * @param {string} [options.cwd] - Working directory (important for --resume to find sessions)
 * @param {number} [options.timeoutMs=120000] - Timeout in milliseconds
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number }>}
 */
// Module-scope env snapshot. CLAUDECODE + CLAUDE_CODE_* are set at process
// startup and don't change during the lifetime of the server; scrubbing them
// once here avoids cloning ~100 env keys + running a filter loop on every
// spawn. Any variable that DOES change at runtime (PATH edits, temp auth
// tokens) still refreshes naturally because Node's process.env is live here.
const CLEANED_ENV = (() => {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_')) delete env[key]
  }
  return env
})()

export function runClaude({ args, cwd, timeoutMs = 120_000 }) {
  return runClaudeCancellable({ args, cwd, timeoutMs }).promise
}

// The claude CLI rejects `--output-format stream-json` in print (-p) mode unless
// `--verbose` is also present ("When using --print, --output-format=stream-json
// requires --verbose"). Every stream-json spawn in the cockpit flows through
// runClaudeCancellable, so we enforce that invariant ONCE here, at the spawn
// boundary, instead of at each call site — scattering it across arg-builders is
// exactly the drift that let three sites (compile, mission-execute, new-session)
// ship without it. Idempotent, and a no-op for `--output-format json`
// (intelligence/analyzer.js), which does not require --verbose.
export function withStreamJsonVerbose(args) {
  if (!Array.isArray(args)) return args
  const i = args.indexOf('--output-format')
  // Handle both the two-token form (--output-format stream-json) and the
  // equals form (--output-format=stream-json) that the CLI also accepts.
  const usesStreamJson =
    (i !== -1 && args[i + 1] === 'stream-json') || args.includes('--output-format=stream-json')
  if (!usesStreamJson || args.includes('--verbose')) return args
  return [...args, '--verbose']
}

// Resolve how to spawn the claude bin WITHOUT ever passing user-controlled args
// through a shell. Spawning a .cmd/.bat/.ps1 directly needs shell:true on Node
// >=20.12 (CVE-2024-27980), but shell:true splices the args into a command line
// that cmd.exe/PowerShell then RE-PARSES — so shell metacharacters in the prompt,
// --name, PRD/spec fields (`; & | > $() ` backticks ` %VAR%`) become host command
// execution. Instead we invoke the interpreter explicitly and hand it the script
// plus args as a DISCRETE argv array with shell:false, so Node quotes each element
// and the interpreter receives them as literal arguments — closing the injection
// vector on exactly the Windows install (npm-shim .cmd / PS-only .ps1) where it bites.
// A resolved .exe is spawned directly (shell:false), which was always safe.
export function buildSpawn(bin, args) {
  if (!isShellScript(bin)) return { command: bin, commandArgs: args }
  const lower = bin.toLowerCase()
  if (lower.endsWith('.ps1')) {
    return {
      command: 'powershell.exe',
      commandArgs: ['-NoProfile', '-NonInteractive', '-File', bin, ...args],
    }
  }
  // .cmd / .bat — `cmd.exe /d /s /c <bin> <args...>`. /d skips AutoRun, /s + the
  // discrete argv keeps cmd from stripping/!-expanding our quotes.
  return { command: 'cmd.exe', commandArgs: ['/d', '/s', '/c', bin, ...args] }
}

/**
 * Like runClaude but also returns a cancel() function that kills the child
 * process. The promise rejects with an error if cancel() is called.
 * @param {object} options
 * @param {string[]} options.args
 * @param {string} [options.cwd]
 * @param {number} [options.timeoutMs=120000]
 * @returns {{ promise: Promise<{ stdout: string, stderr: string, exitCode: number }>, cancel: () => void }}
 */
export function runClaudeCancellable({ args, cwd, timeoutMs = 120_000 }) {
  const env = CLEANED_ENV
  let childRef = null
  let cancelledFlag = false

  const promise = new Promise((resolve, reject) => {
    let bin
    try {
      bin = getClaudeBin()
    } catch (err) {
      return reject(err)
    }
    const spawnOpts = { env, stdio: ['pipe', 'pipe', 'pipe'] }
    if (cwd) spawnOpts.cwd = cwd
    // shell:false ALWAYS. For .cmd/.bat/.ps1, buildSpawn routes through the
    // interpreter explicitly so args stay literal argv (no shell re-parse) — see
    // buildSpawn for the CVE-2024-27980 / injection rationale.
    const { command, commandArgs } = buildSpawn(bin, withStreamJsonVerbose(args))
    const child = spawn(command, commandArgs, spawnOpts)
    childRef = child

    // Close stdin immediately — claude CLI waits for EOF on stdin when it is a pipe
    child.stdin.end()

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })

    const timer = setTimeout(() => {
      child.kill()
      const err = new Error(`claude CLI timed out after ${timeoutMs / 1000}s`)
      err.stderrOutput = stderr
      err.stdoutOutput = stdout
      reject(err)
    }, timeoutMs)

    child.on('error', (err) => {
      clearTimeout(timer)
      err.stderrOutput = stderr
      err.stdoutOutput = stdout
      reject(err)
    })

    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (cancelledFlag) {
        const err = new Error('claude CLI cancelled')
        err.stderrOutput = stderr
        err.stdoutOutput = stdout
        return reject(err)
      }
      if (code !== 0 || signal) {
        const err = new Error(`claude CLI exited with code=${code} signal=${signal}`)
        err.code = code
        err.stderrOutput = stderr
        // On non-zero exit, the CLI often still emits structured JSON (e.g. quota
        // errors) on stdout. Preserve it so callers can surface a useful message.
        err.stdoutOutput = stdout
        return reject(err)
      }
      resolve({ stdout, stderr, exitCode: code })
    })
  })

  function cancel() {
    if (childRef) {
      cancelledFlag = true
      try {
        childRef.kill()
      } catch {
        /* ignore if already exited */
      }
    }
  }

  return { promise, cancel }
}
