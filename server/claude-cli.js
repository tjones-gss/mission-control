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
  const env = CLEANED_ENV
  return new Promise((resolve, reject) => {
    let bin
    try {
      bin = getClaudeBin()
    } catch (err) {
      return reject(err)
    }
    const spawnOpts = { env, stdio: ['pipe', 'pipe', 'pipe'] }
    if (cwd) spawnOpts.cwd = cwd
    // Node >=20.12 refuses to spawn .cmd/.bat without shell:true (CVE-2024-27980).
    // For a resolved .exe absolute path, shell:false is correct and safer.
    if (isShellScript(bin)) spawnOpts.shell = true

    const child = spawn(bin, args, spawnOpts)

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
}
