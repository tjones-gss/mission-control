// hook-emitter — the pure core of the opt-in Oversight hook bridge.
//
// It maps a Claude Code hook payload to a normalized tool-call event and drops
// it as one JSON file into the cockpit's hook-log dir (server/data/hook-log/).
// The cockpit's lib/hook-receiver.js watches that dir and relays each file as a
// `tool_call` SSE event, which MeshView renders as a real packet.
//
// Transport is deliberately a local file drop, NOT a network socket: it needs
// zero dependencies, opens no inbound port (consistent with the localhost-first,
// no-inbound-path posture), and reuses the dir the L2-b pure-Node shim already
// uses. If the cockpit isn't running, the files simply accumulate harmlessly
// until it next starts (or are ignored).

import fs from "node:fs";
import path from "node:path";

// Map a Claude Code hook stdin payload ({ session_id, tool_name, ... }) to the
// normalized event the cockpit expects. Returns null when required fields are
// absent so the caller writes nothing.
export function buildEvent(payload, ts) {
  if (!payload || typeof payload !== "object") return null;
  const sessionId =
    typeof payload.session_id === "string" ? payload.session_id : "";
  const tool = typeof payload.tool_name === "string" ? payload.tool_name : "";
  if (!sessionId || !tool) return null;
  return { sessionId, tool, ts };
}

let seq = 0;

// Write one tool-call event file into `dir`. The filename is unique per call so
// concurrent tool invocations never clobber each other. Returns the file path,
// or null for an invalid event.
export function writeToolCallEvent(dir, event) {
  if (!event || !event.sessionId || !event.tool) return null;
  fs.mkdirSync(dir, { recursive: true });
  seq += 1;
  const safeSession = String(event.sessionId).replace(/[^a-zA-Z0-9_-]/g, "_");
  const fileName = `${safeSession}-${event.ts}-${process.pid}-${seq}.json`;
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      sessionId: event.sessionId,
      tool: event.tool,
      ts: event.ts,
    }),
  );
  return filePath;
}
