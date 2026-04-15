import { spawn } from 'child_process'

// On Windows, npm shims are .cmd files — child_process.spawn needs shell:true or the full name
const CLAUDE_CMD = process.platform === 'win32' ? 'claude.cmd' : 'claude'

/**
 * Spawn the claude CLI as a subprocess with proper environment isolation.
 * @param {object} options
 * @param {string[]} options.args - CLI arguments
 * @param {string} [options.cwd] - Working directory (important for --resume to find sessions)
 * @param {number} [options.timeoutMs=120000] - Timeout in milliseconds
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number }>}
 */
export function runClaude({ args, cwd, timeoutMs = 120_000 }) {
  // Unset CLAUDECODE and all CLAUDE_CODE_* vars so the CLI doesn't refuse to run inside an active session
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_')) delete env[key]
  }

  return new Promise((resolve, reject) => {
    const spawnOpts = { env, stdio: ['pipe', 'pipe', 'pipe'] }
    if (cwd) spawnOpts.cwd = cwd

    const child = spawn(CLAUDE_CMD, args, spawnOpts)

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
      reject(err)
    }, timeoutMs)

    child.on('error', (err) => {
      clearTimeout(timer)
      err.stderrOutput = stderr
      reject(err)
    })

    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (code !== 0 || signal) {
        const err = new Error(`claude CLI exited with code=${code} signal=${signal}`)
        err.code = code
        err.stderrOutput = stderr
        return reject(err)
      }
      resolve({ stdout, stderr, exitCode: code })
    })
  })
}
