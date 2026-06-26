// Port-conflict guard for `npm run up` / `npm start` (GOALS_SERVER_RELIABILITY).
//
// Stale processes holding 3001 (server) or 5173 (client) are the #1 cause of a
// confusing half-start. This script detects an occupied port BEFORE the server
// or Vite tries to bind, prints the offending PID plus copy-paste kill
// instructions, and exits non-zero so the failure is obvious instead of a
// cryptic EADDRINUSE stack later. It deliberately does NOT kill anything — that
// stays a human decision. Node built-ins only (net + child_process), no deps.
import net from 'node:net'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { argv, platform } from 'node:process'

const DEFAULT_PORTS = [3001, 5173]

// True if `port` cannot be bound on `host` because something already holds it.
// Probe by binding rather than connecting: binding is the exact operation the
// server/Vite will attempt, so EADDRINUSE here is a faithful prediction. Any
// other bind error (e.g. EACCES) is treated as "not our conflict" → false.
export function isPortInUse(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const tester = net.createServer()
    tester.once('error', (err) => resolve(err.code === 'EADDRINUSE'))
    tester.once('listening', () => tester.close(() => resolve(false)))
    tester.listen(port, host)
  })
}

// Best-effort PID lookup for an occupied port. Platform-specific and never
// fatal: returns a number when a single owner is found, otherwise null. The
// guard works without it — the PID just makes the kill instruction concrete.
export function findPid(port) {
  try {
    if (platform === 'win32') {
      const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], {
        encoding: 'utf8',
        windowsHide: true,
      })
      for (const line of out.split(/\r?\n/)) {
        // e.g. "  TCP    127.0.0.1:3001   0.0.0.0:0   LISTENING   12345"
        const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i)
        if (m && Number(m[1]) === port) return Number(m[2])
      }
      return null
    }
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
    })
    const pid = parseInt(out.split(/\r?\n/)[0], 10)
    return Number.isInteger(pid) ? pid : null
  } catch {
    // netstat/lsof missing, or no match — PID is optional context, never fatal.
    return null
  }
}

// Resolve each port to { port, inUse, pid }. pid is only probed for occupied
// ports (lookup is the expensive part).
export async function checkPorts(ports = DEFAULT_PORTS) {
  const results = []
  for (const port of ports) {
    // eslint-disable-next-line no-await-in-loop
    const inUse = await isPortInUse(port)
    results.push({ port, inUse, pid: inUse ? findPid(port) : null })
  }
  return results
}

function killHint(pid) {
  if (pid == null) return null
  return platform === 'win32' ? `  taskkill /PID ${pid} /F` : `  kill ${pid}`
}

// CLI entry: warn about any blocked port and exit 1 if blocked, else exit 0.
export async function main(ports = DEFAULT_PORTS) {
  const results = await checkPorts(ports)
  const blocked = results.filter((r) => r.inUse)
  if (blocked.length === 0) return 0

  console.error('\n✖ Mission Control cannot start — port(s) already in use:\n')
  for (const { port, pid } of blocked) {
    const who = pid != null ? `held by PID ${pid}` : 'holder PID unknown'
    console.error(`  • port ${port} (${who})`)
    const hint = killHint(pid)
    if (hint) console.error(`    free it with:\n  ${hint}`)
  }
  console.error('\nClose the stale process(es) above, then run the command again.\n')
  return 1
}

// Auto-run only as the entry module (node scripts/prestart.js) so the exported
// helpers stay import-safe for tests.
const isEntry = argv[1] && fileURLToPath(import.meta.url) === argv[1]
if (isEntry) {
  main().then((code) => process.exit(code))
}
