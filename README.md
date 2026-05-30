# Mission Control

A live cockpit for the coding agents you're already running. If you have several
Claude Code (and Cursor/Codex) agents going at once and want to see and steer
them from one place, this is for you.

Mission Control unifies two pieces: **Oversight** (the window — a live, multi-project
mission view) and the **adaptive agentic engineering harness** (the rails — opt-in
guardrails you adopt when you feel the pain, not a prerequisite for the window).

- `apps/cockpit` — the Oversight dashboard (global runtime, the front door)
- `packages/harness` — the harness control plane (per-project, opt-in rails)
- `packages/contracts` — shared JSON schemas between them
- `installers` — one-command setup

## Who this is for

People already running multiple Claude Code (and Cursor/Codex) agents who want to
see and steer them in one place. It assumes you've felt the friction of juggling
several agent sessions and want a single live view — it does not promise to turn a
first-time user into a power user.

## What this is / isn't

- **Is**: a live cockpit for your agents plus accident-prevention. The window
  works with zero harness setup; the rails are progressive disclosure you opt into.
- **The danger-zone rails are best-effort accident-prevention, not an
  adversary-proof security boundary.** They catch common mistakes (a stray
  `rm -rf`, a forgotten mission scope) at the tool-call boundary. They are not
  designed to stop a determined or adversarial agent, and you should not treat
  them as a sandbox.
- **The real control for destructive operations is OS-level sandboxing** —
  containers, VMs, restricted users, scoped credentials. The harness hooks
  complement that; they do not replace it.
- **Browser-side approval of destructive commands is deliberately NOT shipped
  yet**, pending a hardened trust model. Today, approval flows live in the
  harness/CLI layer, not in the cockpit UI.

## Quick start

From the repo root:

```
npm install
npm run up
```

`npm run up` launches the cockpit dashboard (the Oversight window) with one
command. The window is the front door: it works on its own, with no harness
setup. Adopt the rails later, per project, when you want them.

## Layout

- **`apps/cockpit`** — the Oversight dashboard, "the window." A Node + React app
  that gives you a live, multi-project mission view across your running agents.
  Manages its own `client/` and `server/`. This is the front door and needs no
  harness setup.
- **`packages/harness`** — the harness control plane, "the rails." Python.
  An opt-in, per-project guardrail layer agents can run inside. The cockpit shells
  out to `harness status --json` rather than reparsing its YAML, so the window can
  read the rails without being coupled to them.
- **`packages/contracts`** — shared JSON schemas defining the data the harness
  emits and the cockpit consumes.
- **`installers`** — one-command setup.
