#!/usr/bin/env node
// Oversight hook bridge — entry point.
//
// This is a Claude Code HOOK command (not a long-running server). Claude Code
// invokes it for each tool call (register it as a PreToolUse hook — see README)
// and passes the hook payload as JSON on stdin. We map that to a normalized
// tool-call event and drop it into the cockpit's hook-log dir; the cockpit
// relays it to MeshView as a live packet.
//
// Design notes:
//   - Zero dependencies. Pure Node. No inbound port, no network — a local file
//     drop the cockpit already watches (lib/hook-receiver.js).
//   - Fail OPEN: any error here must NOT block the tool call. We always exit 0
//     and never write to stderr in a way that could interfere with the hook
//     protocol. Losing a cosmetic packet is acceptable; blocking a tool is not.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEvent, writeToolCallEvent } from "./hook-emitter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Default to the cockpit's hook-log dir (sibling apps/cockpit/server/data/...),
// overridable so the bridge can target a cockpit installed elsewhere.
const HOOK_LOG_DIR =
  process.env.OVERSIGHT_HOOK_LOG_DIR ||
  path.resolve(
    __dirname,
    "..",
    "..",
    "apps",
    "cockpit",
    "server",
    "data",
    "hook-log",
  );

function readStdin() {
  return new Promise((resolve) => {
    let buf = "";
    const t = setTimeout(() => resolve(buf), 2000); // never hang a tool call
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (buf += c));
    process.stdin.on("end", () => {
      clearTimeout(t);
      resolve(buf);
    });
    process.stdin.on("error", () => {
      clearTimeout(t);
      resolve(buf);
    });
  });
}

async function main() {
  try {
    const raw = await readStdin();
    const payload = raw ? JSON.parse(raw) : null;
    const event = buildEvent(payload, Date.now());
    if (event) writeToolCallEvent(HOOK_LOG_DIR, event);
  } catch {
    // Fail open — never block the tool call.
  }
  process.exit(0);
}

main();
