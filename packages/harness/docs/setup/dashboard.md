# Local dashboard

`harness dashboard` renders a single self-contained HTML page at
`runs/dashboard/index.html` so you can glance at project state without
piecing together half a dozen YAML files in your head.

The dashboard is a **read-only view** over the harness state files already
on disk. It does not edit, infer, or supplement anything. To change what
the dashboard shows, edit the underlying YAML or markdown.

## Quick start

```bash
./tools/harness dashboard
open runs/dashboard/index.html        # macOS
xdg-open runs/dashboard/index.html    # Linux
start runs/dashboard/index.html       # Windows (Git Bash)
```

Or auto-open after generating:

```bash
./tools/harness dashboard --open
```

## What it shows

Each panel reads from one or two harness files and gracefully hides
empty content. Nothing is fabricated.

| Panel                 | Source                                            |
|-----------------------|---------------------------------------------------|
| Project               | `.harness/project-state.yml` — `project.*`, `current.*` |
| Current Mission       | `project-state.yml` `current.mission` + the mission markdown |
| Next Recommended Action | `project-state.yml` `next.*`                    |
| Readiness             | `.harness/readiness-score.yml`                    |
| MVP Checklist         | `.harness/mvp-checklist.yml`                      |
| Mission Board         | `.harness/mission-index.yml`                      |
| Risks                 | `## Risks` section of the current mission         |
| Open Questions        | `## Open Questions` section of the current mission |
| Recent Session Notes  | `runs/session-notes/*.md` (newest first)          |
| Friction & Improvements | `.harness/friction-log.yml` + `.harness/improvement-backlog.yml` (open items only) |
| Validation / Tests    | `runs/test-reports/*` (newest first)              |

## Configuration

Optional. Drop `.harness/dashboard-config.yml` into the project to override
defaults. The shipped template lists every knob; the most useful ones:

```yaml
dashboard:
  theme: dark               # "dark" or "light"
  recent_notes: 5
  output: runs/dashboard/index.html
  panels:
    tests: false            # hide the test-reports panel
```

Missing config file → defaults apply. Unknown keys are ignored, not errors.

## Where it fits

- **Source of truth stays in YAML and markdown.** Edit those.
- **The dashboard is regenerable.** Re-run `harness dashboard` whenever
  you want fresh output. There is no incremental update; it always
  rewrites `runs/dashboard/index.html` in one go.
- **No network, no external assets.** The HTML inlines its own CSS.
  You can open it offline, or commit it to a static site if you want a
  shared view. (`runs/dashboard/` is already in your `runs/` tree;
  whether to git-ignore it is a per-team call.)
- **No new state files.** The optional `dashboard-config.yml` is config,
  not state. The dashboard does not write anywhere except its own output
  file.

## What it deliberately does not do

- Compute or normalize scores beyond what `readiness-score.yml` says.
  If you want a different overall score, change the YAML.
- Run `harness check` or `harness validate` for you. It will display the
  newest test report it finds, but it does not invoke anything.
- Replace `harness status`. `status` is the canonical text view; the
  dashboard is the at-a-glance counterpart.

## Troubleshooting

- **`harness check --strict` flags the dashboard file** — it won't.
  `runs/dashboard/` is output, not a tracked state file, and `harness check`
  doesn't read it.
- **Panel shows "Panel error: ..."** — one panel's render raised an
  exception. The other panels still render. Open the issue against
  `tools/harness` and include the message.
- **Theme is wrong** — set `dashboard.theme` in
  `.harness/dashboard-config.yml`. Dark is the default.
