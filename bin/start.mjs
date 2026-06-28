#!/usr/bin/env node
// Entry point for `npx @mission-control/app` — zero-to-running cockpit.
//
// Flow:
//   1. Hard-gate Node >= 22.13 (the server's node:sqlite read-cache needs it).
//   2. Install dependencies via `npm run setup` if they aren't present yet
//      (idempotent — setup.mjs is safe to re-run, so we only skip the wait when
//      every workspace already has node_modules).
//   3. Launch the cockpit via `npm run up` (server + client).
//   4. Once /api/health answers, open the browser at the client URL.
//
// Node built-ins only; no new dependencies. The pure helpers are exported so
// they can be unit-tested without spawning anything.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";
import { argv, platform } from "node:process";
import { waitForReady } from "../scripts/wait-ready.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// bin/ lives at the repo root, so the repo root is one level up.
const REPO_ROOT = path.resolve(__dirname, "..");
const CLIENT_URL = "http://localhost:5173";

const MIN_NODE = { major: 22, minor: 13 };
const IS_WIN = platform === "win32";

// --- pure helpers (exported for tests) -------------------------------------

// True iff a "X.Y.Z" version string meets the Node >= 22.13 floor.
export function nodeVersionMeetsMin(versionString, min = MIN_NODE) {
  const m = String(versionString).match(/(\d+)\.(\d+)/);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major !== min.major) return major > min.major;
  return minor >= min.minor;
}

// Resolve the OS command that opens a URL in the default browser. WSL reports
// platform "linux", so xdg-open covers it (provided by wslu's wslview shim);
// the caller falls back to printing the URL if the command isn't available.
export function browserOpenCommand(plat, url) {
  if (plat === "darwin") return { cmd: "open", args: [url] };
  if (plat === "win32") return { cmd: "cmd", args: ["/c", "start", "", url] };
  return { cmd: "xdg-open", args: [url] };
}

// True iff every workspace that setup.mjs installs already has node_modules.
export function dependenciesInstalled(root = REPO_ROOT, exists = existsSync) {
  return [
    path.join(root, "node_modules"),
    path.join(root, "apps", "cockpit", "server", "node_modules"),
    path.join(root, "apps", "cockpit", "client", "node_modules"),
  ].every((dir) => exists(dir));
}

// --- side-effecting steps --------------------------------------------------

function openBrowser(url) {
  const { cmd, args } = browserOpenCommand(platform, url);
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => console.log(`  Open ${url} in your browser.`));
    child.unref();
  } catch {
    console.log(`  Open ${url} in your browser.`);
  }
}

function npmRun(scriptArgs) {
  // shell:true so npm/npm.cmd resolves on Windows.
  return spawn("npm", scriptArgs, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: true,
  });
}

async function run() {
  // 1. Node version gate (the bin itself runs under the user's node).
  if (!nodeVersionMeetsMin(process.versions.node)) {
    console.error(
      `\n✗ Mission Control needs Node >= ${MIN_NODE.major}.${MIN_NODE.minor} (found ${process.versions.node}).\n` +
        `  The cockpit server uses the built-in node:sqlite, unflagged from 22.13.\n` +
        `  Upgrade Node from https://nodejs.org/ and re-run.\n`,
    );
    process.exit(1);
  }

  // 2. Install if needed (blocking; inherits stdio so progress is visible).
  if (!dependenciesInstalled()) {
    console.log("Installing dependencies (first run)…\n");
    const setup = npmRun(["run", "setup"]);
    const code = await new Promise((resolve) => setup.on("exit", resolve));
    if (code !== 0) {
      console.error(
        `\n✗ Setup failed (exit ${code}). See the npm output above.\n`,
      );
      process.exit(code ?? 1);
    }
  }

  // 3. Launch server + client. `npm run up` stays attached and owns the banner.
  const up = npmRun(["run", "up"]);
  const forward = (sig) => {
    if (!up.killed) up.kill(sig);
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));
  up.on("exit", (code) => process.exit(code ?? 0));

  // 4. Open the browser once the server reports healthy.
  const ready = await waitForReady();
  if (ready) {
    console.log(`\n✓ Opening ${CLIENT_URL} …\n`);
    openBrowser(CLIENT_URL);
  } else {
    console.error(
      `\n⚠ The cockpit didn't report healthy in time — not opening the browser.\n` +
        `  The dev process is still attached above; once it's up, open ${CLIENT_URL}.\n`,
    );
  }
}

const isEntry =
  argv[1] && fileURLToPath(import.meta.url) === path.resolve(argv[1]);
if (isEntry) {
  run();
}
