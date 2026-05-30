# Setup this machine (harness core)

**Paste to Cursor or Claude Code:**

> Set up the Adaptive Agentic Engineering Harness on this machine — core control plane only, not the experimental SDK/MCP stack. Follow `prompts/setup-workstation.md` exactly, run the commands yourself, and give me a short pass/fail report.

---

## What you are doing

Wire the **harness itself** so missions, hooks, and quality gates work on **this** computer. This repo is the harness product (`tjones-gss/adaptive-agentic-engineering-harness`), not an application under build.

## In scope (do these)

1. **Python** — ensure `python` or `python3` runs; install PyYAML if import fails:
   ```bash
   python -m pip install pyyaml
   ```
2. **One command** (preferred):
   ```bash
   python tools/harness setup
   ```
   Windows PowerShell equivalent:
   ```powershell
   python tools/harness setup
   ```
3. **Verify** — run `python tools/harness check` and report Control plane + adapter sections.
4. **IDE** — tell the user to restart Cursor and/or Claude Code, open this folder as the project root, then:
   - Cursor: trust workspace; hooks load from `.cursor/`
   - Claude Code: run `/hooks` (four hooks) and `/agents` (four `harness-*` agents)
5. **Windows only** — if hooks may not fire: confirm Git for Windows is installed and `C:\Program Files\Git\bin` is on the user PATH before the generic `bash` stub. Re-run `python tools/harness install claude` if `settings.json` still points at another machine's paths.

## Out of scope (skip unless the user explicitly asks)

- `pip install -e sdk/python[cursor,dev]` and `harness_orchestrator run-loop`
- MCP servers, `CURSOR_API_KEY` live tests, cloud agents
- Bootstrapping a **different** application repo (use `harness init <mode>` there later)
- Filling every `unknown` in `project-state.yml` (that's MISSION-001 / orchestrator work)

## If `harness setup` is unavailable

Run manually:

```bash
python tools/install-cursor-adapter.py --hooks-only
python tools/harness install claude
python tools/harness check
```

## Success looks like

- `harness check`: control plane and both adapters show `[ok]` (functional smoke tests may warn on Windows — note that, don't hide it)
- User can start a session; SessionStart hook preloads `.harness/` state
- User knows the next command: `harness status` or `harness next`

## Stop

Do not edit application code. Do not weaken hooks or danger-zone policy. Report blockers clearly (missing Git Bash, missing Python, etc.).
