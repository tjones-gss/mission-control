# Oversight hook bridge (`packages/hook-server`)

**Opt-in.** Turns real Claude Code tool calls into live packets in Mission
Control's **Mesh** view (V3 hook instrumentation). Without it, Mesh works exactly
as before — packets are simulated. With it, each packet is an actual tool
invocation.

## How it works

```
Claude Code session
  → tool call fires
  → Claude Code runs this hook (PreToolUse), passing { session_id, tool_name } on stdin
  → index.js drops a tool-call JSON file into the cockpit's hook-log dir
  → cockpit (lib/hook-receiver.js) watches that dir and relays each file
       as a `tool_call` SSE event
  → MeshView renders it as a real packet on that session's node
```

Transport is a **local file drop**, not a network socket: zero dependencies, no
inbound port, consistent with Oversight's localhost-first / no-inbound-path
posture (ADR-0004). The drop dir is the same `server/data/hook-log/` directory
the one-click "pure-Node rails" fallback (L2-b) uses.

> **Design note / deviation from the original V3 sketch.** The spec sketched an
> MCP server emitting WebSocket events. We ship a dependency-free hook script +
> file drop instead: it needs no `@modelcontextprotocol/sdk`, opens no socket,
> and reuses an existing watched directory. The cockpit-side contract (a
> `tool_call` SSE event) is identical.

## Register it

Add a `PreToolUse` hook to `~/.claude/settings.json`. The command runs this entry
for every tool call:

```jsonc
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/mission-control/packages/hook-server/index.js",
          },
        ],
      },
    ],
  },
}
```

The hook **fails open**: any error (including the cockpit not running) is
swallowed and the tool call proceeds normally. It always exits 0.

### Targeting a cockpit installed elsewhere

By default the bridge writes to the sibling
`apps/cockpit/server/data/hook-log/`. To point it at a cockpit checked out
elsewhere, set `OVERSIGHT_HOOK_LOG_DIR`:

```bash
OVERSIGHT_HOOK_LOG_DIR=/path/to/cockpit/server/data/hook-log \
  node /path/to/mission-control/packages/hook-server/index.js
```

## Uninstall

Remove the `PreToolUse` entry from `~/.claude/settings.json`. Mesh returns to
simulated packets.
