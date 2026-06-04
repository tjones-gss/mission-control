# Dockerize the interactive Mission Control cockpit

**Date:** 2026-05-30
**Status:** Approved (design), in implementation

## Goal

Run the *complete, interactive* Oversight cockpit inside one container — spawn,
drive, and approve Claude Code agents from the browser — using the operator's
existing Claude subscription auth, with the apps those agents build landing on
the host disk. **Zero changes to cockpit source code.**

The container is the tool. The "thing we build" is a separate app created
*through* the running cockpit, living under a host-mounted `/workspace`.

## Approach (chosen)

Dev-mode-in-container: run the existing `npm run up` flow (Express API on `:3001`
+ Vite dev server on `:5173`, Vite proxying `/api` → `:3001`) inside a container
that also has the `claude` CLI installed. The browser only ever talks to Vite.

Rejected alternative: a slim prod image that adds static-serving of `client/dist`
to `server/index.js`. Rejected to keep cockpit source untouched.

## Architecture

```
HOST (Windows + Docker Desktop)
  browser ──► 127.0.0.1:5173  (published)
  C:\Users\Travis\.claude        ──(bind, rw)──► /root/.claude
  C:\Users\Travis\Desktop\Projects\mc-workspace ──(bind, rw)──► /workspace

CONTAINER (node:22, Debian)
  Vite :5173 (--host 0.0.0.0, serves UI) ──/api proxy (changeOrigin)──► Express :3001 (127.0.0.1)
  Express spawns claude CLI:
    - `claude -p`       → new sessions
    - `claude --resume` → PTY messaging (node-pty)
  claude writes session JSONL ──► /root/.claude ──► host ~/.claude
  agents build app          ──► /workspace      ──► host mc-workspace
```

Security passes unchanged: Vite's `changeOrigin: true` rewrites Host to
`localhost:3001` (loopback → `hostCheck` ok); the browser Origin
`http://localhost:5173` is already in the cockpit's default allowed-origin list
(`originGuard` ok). The API server stays on `127.0.0.1` *inside* the container —
only Vite is published, only to host loopback (`127.0.0.1:5173`), so there is no
LAN exposure.

## Files (all new — no cockpit source touched)

- `docker/Dockerfile` — base `node:22`; `apt-get install python3 make g++ git`
  (native build of `node-pty`); `npm i -g @anthropic-ai/claude-code`; `COPY` repo
  (context = repo root); `RUN node installers/setup.mjs` (canonical installer:
  root workspaces + cockpit server + client); entrypoint launches both procs.
- `docker/entrypoint.sh` — starts `node apps/cockpit/server/index.js` and
  `vite --host 0.0.0.0 --port 5173` concurrently; forwards SIGTERM/SIGINT for a
  clean `docker stop`. `--host` is the only thing the stock `dev:client` lacks
  for container access; supplied at the command layer, not by editing source.
- `docker/docker-compose.yml` — context `..`, `dockerfile: docker/Dockerfile`;
  publishes `127.0.0.1:5173:5173` only; binds `${CLAUDE_DIR}:/root/.claude` and
  `${WORKSPACE_DIR}:/workspace`; env `CHOKIDAR_USEPOLLING=true`,
  `NODE_ENV=development`, `PORT=3001`.
- `docker/.env.example` — `CLAUDE_DIR`, `WORKSPACE_DIR` (compose can't expand `~`
  on Windows; paths are explicit via `.env`).
- `docker/README.md` — build/run, the auth caveat + fallback, first-build
  walkthrough.
- root `package.json`: add `"up:docker": "docker compose -f docker/docker-compose.yml up --build"`.

## Risks & mitigations

- **Auth token (main risk):** `~/.claude/.credentials.json` is a portable OAuth
  token (not a Windows keychain). Bind-mounted rw so the container `claude` reads
  and can refresh it. Fallback: `docker compose exec` an interactive `claude`
  login once, or pass `ANTHROPIC_API_KEY`.
- **Two `claude`s sharing one config:** container + host writing
  `~/.claude/.claude.json` can contend on its lockfile. Mitigation: drive agents
  through the container; don't run host Claude Code on the same config at once.
- **node-pty native build:** `python3 make g++` installed before `setup.mjs`.
- **File-watching across the bind mount:** `CHOKIDAR_USEPOLLING=true`.

## Acceptance

1. `npm run up:docker` builds and starts; `http://localhost:5173` loads the dashboard.
2. `docker compose exec oversight claude --version` works and is authenticated.
3. A browser-spawned session in `/workspace` appears live, tool-approval works,
   and a file the agent writes shows up in the host `mc-workspace`.
