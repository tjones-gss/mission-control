# Mission Control

Governed agent work, watched live. Unifies the adaptive agentic engineering harness (the rails) with Oversight (the window).

- `apps/cockpit` — the Oversight dashboard (global runtime)
- `packages/harness` — the harness control plane (per-project rails)
- `packages/contracts` — shared JSON schemas between them
- `installers` — one-command setup

## Quick start

From the repo root:

```
npm install
npm run up
```

`npm run up` launches the cockpit dashboard (the Oversight window) with one command.

## Layout

- **`apps/cockpit`** — the Oversight dashboard, "the window." A Node + React app
  that visualizes agent runs live. Manages its own `client/` and `server/`.
- **`packages/harness`** — the harness control plane, "the rails." Python.
  The per-project governance layer agents run inside; the cockpit shells out to
  `harness status --json` rather than reparsing its YAML.
- **`packages/contracts`** — shared JSON schemas defining the data the harness
  emits and the cockpit consumes.
- **`installers`** — one-command setup.
