# Mission Control — Agent Guide

This monorepo unifies two halves. Know which one you are touching.

## The two halves

- **`apps/cockpit`** — the Oversight dashboard, "the window." A Node + React app
  (Express server + Vite/React client) that visualizes agent runs live. It is the
  global runtime you look *at*. It manages its own `client/` and `server/` via
  `cd` scripts — do NOT restructure it into workspaces.
- **`packages/harness`** — the harness control plane, "the rails." Python. It is
  the per-project governance layer that agents run *inside*. Not an npm workspace.

## How they talk

The cockpit does **not** reparse harness YAML. It shells out to the harness CLI:

```
harness status --json
```

and renders the structured output. Treat `harness status --json` as the contract
boundary: if the dashboard needs new data, the harness emits it, the cockpit
consumes it. Never duplicate harness parsing logic in the cockpit.

## Shared schemas

- **`packages/contracts`** — the shared JSON schemas that define the shape of what
  the harness emits and the cockpit consumes. When you change the `--json` output,
  update the schema here first, then both sides.

## Layout

- `apps/cockpit` — Oversight dashboard (the window)
- `packages/harness` — harness control plane (the rails, Python)
- `packages/contracts` — shared JSON schemas
- `installers` — one-command setup

## Running it

From the repo root:

```
npm install      # installs cockpit + contracts workspaces
npm run up       # one command — launches the cockpit dashboard
```

`npm run up` is the canonical launch. It runs the cockpit's `dev` script, which
starts the server and client together.

## Conventions

- npm workspaces cover only the Node side (`apps/cockpit`, `packages/contracts`).
  `packages/harness` is Python — manage it with its own tooling, not npm.
- Root scripts are thin pass-throughs (`npm --prefix apps/cockpit ...`). Keep heavy
  logic in the subprojects, not in the root `package.json`.
