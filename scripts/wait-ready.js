// Startup launcher + health gate for `npm run up` (GOALS_SERVER_RELIABILITY).
//
// Flow:
//   1. Pre-flight the ports (reusing the server's prestart guard) — bail early
//      with kill instructions instead of a cryptic EADDRINUSE later.
//   2. Spawn the cockpit dev process (server + client via concurrently).
//   3. Poll http://localhost:3001/api/health every 500ms until it answers 200.
//   4. Print a single, unambiguous "ready" banner pointing at the client URL.
//   5. Time out after 30s with a clear message (without killing a process that
//      may still be coming up — the dev logs stay attached for diagnosis).
//
// Node built-ins + global fetch only; no new dependencies.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { argv, platform } from "node:process";
import { main as checkPortsCli } from "../apps/cockpit/server/scripts/prestart.js";

const HEALTH_URL = "http://localhost:3001/api/health";
const CLIENT_URL = "http://localhost:5173";
const POLL_INTERVAL_MS = 500;
const READY_TIMEOUT_MS = 30_000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Core poll loop. Pure + injectable (fetch/sleep/now) so it is unit-testable
// without a live server. Resolves true on the first 200, false once timeoutMs
// elapses with no healthy response. Connection errors while the server boots
// are expected and swallowed.
export async function waitForReady({
  url = HEALTH_URL,
  intervalMs = POLL_INTERVAL_MS,
  timeoutMs = READY_TIMEOUT_MS,
  fetchImpl = (u) => fetch(u),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
} = {}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    try {
      const res = await fetchImpl(url);
      if (res && (res.ok || res.status === 200)) return true;
    } catch {
      // server not accepting connections yet — keep polling
    }
    await sleep(intervalMs);
  }
  return false;
}

async function run() {
  // 1. Port pre-flight (exits non-zero with instructions if blocked).
  const portCode = await checkPortsCli();
  if (portCode !== 0) process.exit(portCode);

  // 2. Spawn the dev process. shell:true so npm/npm.cmd resolves on Windows.
  const child = spawn("npm", ["--prefix", "apps/cockpit", "run", "dev"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: true,
  });

  // Forward termination so Ctrl-C tears down the dev tree, not just this gate.
  const forward = (sig) => {
    if (!child.killed) child.kill(sig);
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));
  child.on("exit", (code) => process.exit(code ?? 0));

  // 3-5. Gate on health, then announce.
  const ready = await waitForReady();
  if (ready) {
    console.log(`\n✓ Mission Control ready → ${CLIENT_URL}\n`);
  } else {
    console.error(
      `\n⚠ Mission Control did not report healthy within ${READY_TIMEOUT_MS / 1000}s.\n` +
        `  The dev process is still attached above — check its logs for errors,\n` +
        `  or confirm ${HEALTH_URL} responds.\n`,
    );
  }
}

const isEntry = argv[1] && fileURLToPath(import.meta.url) === argv[1];
if (isEntry) {
  run();
}
