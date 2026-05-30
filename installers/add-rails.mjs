#!/usr/bin/env node
// @ts-check
/**
 * Mission Control — add the opt-in harness rails to a project.
 *
 * This is the OPT-IN, per-project step. It does NOT reimplement the
 * hook-copying / Windows-Git-Bash logic — it reuses the harness's existing
 * Claude adapter installer:
 *
 *   packages/harness/tools/install-claude-adapter.py
 *
 * which already handles copying .claude/ + CLAUDE.md, chmod +x on hooks via
 * Git Bash on Windows, and patching settings.json to be WSL-safe.
 *
 * Invocation reused (confirmed by reading the harness tools):
 *   python tools/install-claude-adapter.py --root <PROJECT>
 *   (equivalently: python tools/harness install claude, run from the project)
 *
 * Requires Python. Fails clearly if Python is absent.
 *
 * Usage:
 *   node installers/add-rails.mjs --project <path>
 *   node installers/add-rails.mjs --project <path> --print   # print command(s), don't run
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = dirname(__dirname);
const HARNESS_ROOT = join(REPO_ROOT, "packages", "harness");
const ADAPTER_INSTALLER = join(HARNESS_ROOT, "tools", "install-claude-adapter.py");

const IS_WIN = process.platform === "win32";

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

function ok(m) { console.log(`  ${c.green}${tick}${c.reset} ${m}`); }
function fail(m) { console.log(`  ${c.red}${cross}${c.reset} ${m}`); }
function warn(m) { console.log(`  ${c.yellow}${warnMark}${c.reset} ${m}`); }
function info(m) { console.log(`    ${c.dim}${m}${c.reset}`); }

function parseArgs(argv) {
  const out = { project: null, print: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--print") out.print = true;
    else if (a === "--project") out.project = argv[++i] ?? null;
    else if (a.startsWith("--project=")) out.project = a.slice("--project=".length);
  }
  return out;
}

function probe(cmd, args) {
  try {
    const r = spawnSync(cmd, args, {
      encoding: "utf8",
      windowsHide: true,
      shell: IS_WIN,
      timeout: 15000,
    });
    if (r.error) return { ok: false, text: String(r.error.message) };
    return { ok: r.status === 0, text: (r.stdout || r.stderr || "").trim() };
  } catch (e) {
    return { ok: false, text: String(e && e.message) };
  }
}

/** First python command that runs. Returns { cmd, text } or null. */
function detectPython() {
  for (const cmd of ["python3", "python"]) {
    const r = probe(cmd, ["--version"]);
    if (r.ok && r.text) return { cmd, text: r.text };
  }
  return null;
}

function printHelp() {
  console.log(`Mission Control — add the opt-in harness rails to a project

Usage:
  node installers/add-rails.mjs --project <path>
  node installers/add-rails.mjs --project <path> --print

This reuses the harness's own adapter installer
(packages/harness/tools/install-claude-adapter.py) — it does not reimplement
hook copying or the Windows Git-Bash logic.

Requires Python (3.10+ recommended). On Windows the rails' .sh hooks also need
Git Bash; the adapter installer wires settings.json to Git Bash automatically.`);
}

/** The exact manual command, for documentation/fallback. */
function manualCommand(pythonCmd, projectAbs) {
  return `${pythonCmd} "${ADAPTER_INSTALLER}" --root "${projectAbs}"`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }

  console.log(`${c.bold}Mission Control — add rails (opt-in, per project)${c.reset}`);

  if (!args.project) {
    fail("--project <path> is required.");
    info("Example: node installers/add-rails.mjs --project ../my-app");
    return 2;
  }

  const projectAbs = isAbsolute(args.project) ? args.project : resolve(process.cwd(), args.project);
  if (!existsSync(projectAbs)) {
    fail(`project path does not exist: ${projectAbs}`);
    return 2;
  }

  if (!existsSync(ADAPTER_INSTALLER)) {
    fail(`harness adapter installer not found: ${ADAPTER_INSTALLER}`);
    info("Expected packages/harness/tools/install-claude-adapter.py in this repo.");
    return 2;
  }

  // Require Python — the rails are Python; fail clearly if absent.
  const py = detectPython();
  if (!py) {
    fail("Python not found — the opt-in rails require Python (3.10+ recommended).");
    info("Install from https://www.python.org/ and re-run.");
    console.log("");
    console.log("  Once Python is installed, the rails are wired with:");
    console.log(`     ${c.bold}python "${ADAPTER_INSTALLER}" --root "${projectAbs}"${c.reset}`);
    return 1;
  }
  // Reject Python 2 clearly (it would fail inside the adapter with a cryptic
  // SyntaxError). The harness requires Python 3.10+.
  const pyMajor = (() => {
    const m = /(\d+)\.(\d+)/.exec(py.text || "");
    return m ? Number(m[1]) : null;
  })();
  if (pyMajor !== null && pyMajor < 3) {
    fail(`${py.text} found, but the rails require Python 3.10+ (Python 2 cannot run the harness).`);
    info("Install Python 3.10+ from https://www.python.org/ and re-run.");
    console.log("");
    console.log("  Once Python 3.10+ is installed, the rails are wired with:");
    console.log(`     ${c.bold}python "${ADAPTER_INSTALLER}" --root "${projectAbs}"${c.reset}`);
    return 1;
  }
  ok(`Python found: ${py.text} (${py.cmd})`);

  if (IS_WIN) {
    const bash = probe("bash", ["--version"]);
    if (!bash.ok && !bash.text) {
      warn("Git Bash not detected — the adapter copies hooks but they may not be executable.");
      info("Install Git for Windows (https://git-scm.com/download/win), then re-run.");
      info("The adapter installer auto-wires settings.json to Git Bash when present.");
    } else {
      ok("bash present — hooks can be made executable / wired WSL-safe on Windows.");
    }
  }

  const cmdStr = manualCommand(py.cmd, projectAbs);

  if (args.print) {
    console.log("");
    console.log("  Run this to wire the rails into the project:");
    console.log(`     ${c.bold}${cmdStr}${c.reset}`);
    return 0;
  }

  console.log("");
  console.log(`${c.bold}-> Wiring rails via harness adapter installer${c.reset}`);
  info(cmdStr);
  const r = spawnSync(py.cmd, [ADAPTER_INSTALLER, "--root", projectAbs], {
    cwd: HARNESS_ROOT,
    stdio: "inherit",
    windowsHide: true,
    shell: IS_WIN,
  });
  if (r.error) {
    fail(`failed to run the adapter installer: ${r.error.message}`);
    console.log("  Run it manually:");
    console.log(`     ${c.bold}${cmdStr}${c.reset}`);
    return 1;
  }
  const code = r.status === null ? 1 : r.status;
  console.log("");
  if (code === 0) {
    ok("Rails wired. The harness is opt-in and best-effort accident-prevention,");
    info("not an adversary-proof boundary — pair it with OS-level sandboxing.");
    info("In the project: restart Claude Code and run /hooks to verify.");
  } else {
    warn(`adapter installer exited ${code} — see output above.`);
    info("On Windows this can mean jq is not on the Git Bash PATH yet (hooks fail-open).");
  }
  return code;
}

process.exit(main());
