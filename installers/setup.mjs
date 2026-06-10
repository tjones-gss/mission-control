#!/usr/bin/env node
// @ts-check
/**
 * Mission Control — one-command installer (cross-platform, Node ESM).
 *
 * This is the source of truth. setup.ps1 and setup.sh are thin wrappers that
 * just locate node and run this file.
 *
 * HONEST FRAMING (matches README.md / CLAUDE.md):
 *   - The cockpit (the window) is the front door. It needs ONLY Node + npm.
 *   - The harness (the rails) is OPT-IN, per-project, and needs Python
 *     (+ Git Bash on Windows to run its .sh hooks). It is NOT installed here.
 *
 * This installer NEVER claims the rails are "active"/"governed" when their
 * prerequisites are missing. It summarizes precisely what works (cockpit) vs.
 * what needs more (rails).
 *
 * Usage:
 *   node installers/setup.mjs            preflight + install, print next steps (no launch)
 *   node installers/setup.mjs --launch   ... then run `npm run up`
 *   node installers/setup.mjs --check     preflight ONLY (CI/verification); no install, no launch
 *   node installers/setup.mjs --help
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// installers/ lives at the repo root, so the repo root is one level up.
const REPO_ROOT = dirname(__dirname);

const IS_WIN = process.platform === "win32";

// ---------- console helpers ----------

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  reset: useColor ? "\x1b[0m" : "",
  bold: useColor ? "\x1b[1m" : "",
  dim: useColor ? "\x1b[2m" : "",
  red: useColor ? "\x1b[31m" : "",
  green: useColor ? "\x1b[32m" : "",
  yellow: useColor ? "\x1b[33m" : "",
  cyan: useColor ? "\x1b[36m" : "",
};

const tick = useColor ? "✓" : "[ok]";
const cross = useColor ? "✗" : "[FAIL]";
const warnMark = useColor ? "⚠" : "[warn]";

function section(title) {
  console.log("");
  console.log(`${c.bold}${c.cyan}== ${title} ==${c.reset}`);
}
function ok(msg) {
  console.log(`  ${c.green}${tick}${c.reset} ${msg}`);
}
function fail(msg) {
  console.log(`  ${c.red}${cross}${c.reset} ${msg}`);
}
function warn(msg) {
  console.log(`  ${c.yellow}${warnMark}${c.reset} ${msg}`);
}
function info(msg) {
  console.log(`    ${c.dim}${msg}${c.reset}`);
}

// ---------- detection (never throws) ----------

/**
 * Run a command for detection only. windowsHide so no console flashes.
 * Never throws — returns a normalized result.
 * @param {string} cmd
 * @param {string[]} args
 */
function probe(cmd, args) {
  try {
    const r = spawnSync(cmd, args, {
      encoding: "utf8",
      windowsHide: true,
      // On Windows, .cmd shims (npm) need a shell to be resolvable.
      shell: IS_WIN,
      timeout: 15000,
    });
    if (r.error) return { ok: false, stdout: "", stderr: String(r.error.message) };
    return {
      ok: r.status === 0,
      stdout: (r.stdout || "").trim(),
      stderr: (r.stderr || "").trim(),
    };
  } catch (e) {
    return { ok: false, stdout: "", stderr: String(e && e.message) };
  }
}

/** Parse a leading semver-ish "X.Y.Z" out of arbitrary text. */
function parseMajorMinor(text) {
  const m = String(text).match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), raw: m[0] };
}

/** First command in `candidates` that reports a version. */
function detectVersion(candidates, versionArgs = ["--version"]) {
  for (const cmd of candidates) {
    const r = probe(cmd, versionArgs);
    const text = r.stdout || r.stderr;
    if (r.ok && text) {
      const v = parseMajorMinor(text);
      if (v) return { cmd, version: v, raw: text };
    }
  }
  return null;
}

/** Detect a tool's presence (any exit, just needs to run). */
function detectPresence(cmd, args = ["--version"]) {
  const r = probe(cmd, args);
  const text = r.stdout || r.stderr;
  if (r.ok || text) return { cmd, raw: text || "(present)" };
  return null;
}

// ---------- preflight ----------

/**
 * @returns {{ cockpitOk: boolean, railsReady: boolean, node: any, npm: any,
 *   python: any, bash: any, jq: any }}
 */
function preflight() {
  section("Preflight");

  // --- HARD: Node >= 22.13 (cockpit prerequisite — the server's SQLite
  // read-cache uses the built-in node:sqlite, unflagged from 22.13; see
  // ADR-0008 and the server package.json `engines` field) ---
  const node = detectVersion(["node"]);
  let cockpitNodeOk = false;
  const nodeTooOld =
    node &&
    (node.version.major < 22 || (node.version.major === 22 && node.version.minor < 13));
  if (!node) {
    fail("Node.js not found on PATH (REQUIRED for the cockpit).");
    info("Install Node 22.13+ from https://nodejs.org/ and re-run.");
  } else if (nodeTooOld) {
    fail(`Node ${node.version.raw} found, but the cockpit needs Node >= 22.13 (node:sqlite).`);
    info("Upgrade Node from https://nodejs.org/ and re-run.");
  } else {
    cockpitNodeOk = true;
    ok(`Node ${node.version.raw} (>= 22.13)`);
  }

  // --- HARD: npm (cockpit prerequisite) ---
  const npm = detectVersion(["npm"]);
  let cockpitNpmOk = false;
  if (!npm) {
    fail("npm not found on PATH (REQUIRED for the cockpit).");
    info("npm ships with Node.js — reinstall Node from https://nodejs.org/.");
  } else {
    cockpitNpmOk = true;
    ok(`npm ${npm.version.raw}`);
  }

  const cockpitOk = cockpitNodeOk && cockpitNpmOk;

  // --- SOFT: Python (rails only) ---
  const python = detectVersion(["python3", "python"]);
  let pythonRailsOk = false;
  if (!python) {
    warn("Python not found — the cockpit will run; the opt-in harness rails need Python.");
    info("Install Python 3.10+ from https://www.python.org/ to use the rails.");
  } else if (python.version.major < 3) {
    // Python 2 cannot run the harness at all — treat as NOT rails-capable.
    pythonRailsOk = false;
    warn(`Python ${python.version.raw} found, but the rails require Python 3.10+ (Python 2 cannot run the harness).`);
    info("Install Python 3.10+ from https://www.python.org/ to use the rails.");
  } else if (python.version.major === 3 && python.version.minor < 10) {
    pythonRailsOk = true; // usable; just nudge toward >=3.10
    warn(`Python ${python.version.raw} found (3.10+ recommended for the rails).`);
  } else {
    pythonRailsOk = true;
    ok(`Python ${python.version.raw} (rails-capable)`);
  }

  // --- SOFT: Git Bash on Windows (rails .sh hooks only) ---
  let bash = null;
  let bashRailsOk = !IS_WIN; // on non-Windows, bash isn't the gating concern for hooks
  if (IS_WIN) {
    bash = detectPresence("bash", ["--version"]);
    // The harness ignores the WSL stub; for preflight we only report presence.
    if (!bash) {
      warn("Git Bash (bash) not found — the cockpit will run; the rails' .sh hooks need it on Windows.");
      info("Install Git for Windows: https://git-scm.com/download/win");
    } else {
      bashRailsOk = true;
      ok("bash present (needed to run the harness .sh hooks on Windows)");
    }
  }

  // --- OPTIONAL: jq (no longer required) ---
  const jq = detectPresence("jq", ["--version"]);
  if (!jq) {
    info("jq not found — optional. Hooks work without it; jq improves fidelity.");
  } else {
    ok(`jq ${jq.raw} (optional, improves hook fidelity)`);
  }

  const railsReady = Boolean(pythonRailsOk && bashRailsOk);

  return { cockpitOk, railsReady, node, npm, python, bash, jq };
}

// ---------- install ----------

/**
 * Run a command with inherited stdio so the user sees progress.
 * @returns {number} exit code
 */
function runInherit(cmd, args, cwd) {
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    windowsHide: true,
    shell: IS_WIN, // npm is a .cmd shim on Windows
  });
  if (r.error) {
    fail(`failed to run: ${cmd} ${args.join(" ")}`);
    info(String(r.error.message));
    return 1;
  }
  return r.status === null ? 1 : r.status;
}

/**
 * npm install at the root, then in apps/cockpit/server and apps/cockpit/client.
 * The server/client are NOT npm workspaces, so root install does NOT cover them.
 * Idempotent: npm install is safe to re-run.
 * @returns {boolean} success
 */
function install() {
  section("Install (npm)");

  const targets = [
    { label: "root workspaces (cockpit + contracts)", dir: REPO_ROOT },
    { label: "apps/cockpit/server (own package.json)", dir: join(REPO_ROOT, "apps", "cockpit", "server") },
    { label: "apps/cockpit/client (own package.json)", dir: join(REPO_ROOT, "apps", "cockpit", "client") },
  ];

  for (const t of targets) {
    if (!existsSync(join(t.dir, "package.json"))) {
      fail(`expected package.json not found in ${t.dir}`);
      return false;
    }
    console.log("");
    console.log(`${c.bold}-> npm install: ${t.label}${c.reset}`);
    info(t.dir);
    const code = runInherit("npm", ["install"], t.dir);
    if (code !== 0) {
      fail(`npm install failed in ${t.label} (exit ${code}).`);
      return false;
    }
    ok(`installed: ${t.label}`);
  }
  return true;
}

// ---------- summaries ----------

function summarizeState({ cockpitOk, railsReady }) {
  section("Summary");
  if (cockpitOk) {
    ok("Cockpit (the window): prerequisites met — Node + npm present.");
  } else {
    fail("Cockpit (the window): prerequisites NOT met — Node 22.13+ and npm are required.");
  }

  if (railsReady) {
    ok("Harness rails: prerequisites present (Python" + (IS_WIN ? " + bash" : "") + ").");
    info("The rails are still OPT-IN and per-project — nothing was wired yet.");
    info("Wire them into a project with: node installers/add-rails.mjs --project <path>");
  } else {
    warn("Harness rails: NOT ready — they are opt-in and need Python" + (IS_WIN ? " + Git Bash" : "") + ".");
    info("This is fine: the cockpit runs without the rails. Add them later, per project.");
  }
  // Honesty: never imply rails are active.
  info("Note: the rails are best-effort accident-prevention, not an adversary-proof boundary.");
}

function printNextSteps() {
  section("Next steps");
  console.log(`  1. Launch the cockpit:      ${c.bold}npm run up${c.reset}`);
  console.log(`  2. Open the dashboard:      ${c.bold}http://localhost:5173${c.reset}`);
  console.log("");
  console.log("  Add the opt-in rails to a project (later, when you feel the pain):");
  console.log(`     ${c.bold}node installers/add-rails.mjs --project <path-to-your-project>${c.reset}`);
  info("(requires Python; on Windows also Git Bash to run the .sh hooks)");
}

// ---------- main ----------

function printHelp() {
  console.log(`Mission Control installer

Usage:
  node installers/setup.mjs            preflight + install, then print next steps (no launch)
  node installers/setup.mjs --launch   also run \`npm run up\` after install
  node installers/setup.mjs --check    preflight ONLY (CI/verification); no install, no launch
  node installers/setup.mjs --help     show this message

The cockpit needs only Node + npm. The harness rails are opt-in (Python, plus
Git Bash on Windows) and are NOT installed by this script.`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return 0;
  }
  const checkOnly = args.includes("--check");
  const launch = args.includes("--launch");

  console.log(`${c.bold}Mission Control — setup${c.reset}`);
  console.log(`${c.dim}repo: ${REPO_ROOT}${c.reset}`);

  const state = preflight();

  // --check: preflight only. Exit 0 iff cockpit prerequisites are met.
  if (checkOnly) {
    summarizeState(state);
    section("Check result");
    if (state.cockpitOk) {
      ok("Cockpit prerequisites satisfied (exit 0).");
      return 0;
    }
    fail("Cockpit prerequisites NOT satisfied (nonzero exit).");
    return 1;
  }

  // Default / --launch: cockpit prereqs are a hard gate before installing.
  if (!state.cockpitOk) {
    summarizeState(state);
    section("Aborting");
    fail("Cannot install the cockpit without Node 22.13+ and npm. Fix the above and re-run.");
    return 1;
  }

  const installed = install();
  if (!installed) {
    summarizeState(state);
    section("Aborting");
    fail("Install failed. See the npm output above for the underlying error.");
    return 1;
  }

  summarizeState(state);

  if (launch) {
    section("Launch");
    console.log(`  Running ${c.bold}npm run up${c.reset} ...`);
    const code = runInherit("npm", ["run", "up"], REPO_ROOT);
    return code;
  }

  printNextSteps();
  return 0;
}

process.exit(main());
