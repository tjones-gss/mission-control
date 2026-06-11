---
name: run
description: Launch the Mission Control dev environment (server + client). Use when the user asks to run, start, or launch the app, or wants to test changes in the live UI.
---

# Run Mission Control

## Launch

From the project root:

```bash
npm run up
```

This starts both halves concurrently:
- **Server** (Express) → http://localhost:3001
- **Client** (Vite/React) → http://localhost:5173

## Smoke test

After ~5 seconds, verify both are up:

```bash
# Server
curl -s http://localhost:3001/api/sessions | head -c 100

# Client
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173
# expect 200
```

## Usage

Open http://localhost:5173 in the browser. The server serves live data from `~/.claude` — no seed data needed.

## Notes

- Run `npm run setup` first if this is a fresh clone (installs root + server + client deps in the correct order).
- Server binds to `127.0.0.1:3001` by default. Set `OVERSIGHT_HOST=0.0.0.0` to expose on LAN.
- Alternate launch: `npm run up:docker` for the Docker Compose path.
