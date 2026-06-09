# CI & required checks

The monorepo CI lives in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). It runs
on every push and PR.

## Jobs

| Job | What it gates |
|---|---|
| **harness (Python)** | `unittest` over the control plane (CLI, gates, pipelines, loop, cost, fleet-dispatch) + the cross-language schema-version parity check + the pure-Node hook unit tests (`node --test`) + the shell↔Node **hook parity** test (`test_hook_parity`, needs `jq`, installed in the job) + the adapter-install `--hooks` test. |
| **cockpit (Node)** | `prettier --check`, then the server and client Vitest suites **with the v8 coverage gate** (`vitest run --coverage`). A coverage threshold miss fails the job. |
| **cockpit e2e (Fleet + Playwright)** | `needs: cockpit`. The real-subprocess Fleet reject/retry lane (`RUN_E2E=1`) + the Playwright browser suite. |

## Coverage gate (measure-then-floor)

Thresholds live in each suite's config — server [`vitest.config.js`](../apps/cockpit/server/vitest.config.js)
and client [`vite.config.js`](../apps/cockpit/client/vite.config.js). They were set a few points
below the measured baseline so CI reds on a real regression without flaking:

| Suite | lines | branches | functions | statements | scope (`include`) |
|---|---|---|---|---|---|
| server | 80 | 68 | 82 | 80 | `routes/ lib/ utils/ parsers/` |
| client | 70 | 58 | 64 | 67 | `src/components/ src/hooks/` |

**Ratchet policy:** raise these floors as coverage improves; never lower them. If a PR legitimately
needs a lower floor, that is a review conversation, not a silent edit.

## Required status checks (manual GitHub setting)

Branch protection is a GitHub repo setting, **not** a file — CI passing in-repo does not by itself
block a merge. A repo admin must mark these as **required status checks** on the `main` branch
(Settings → Branches → branch protection rule):

- `harness (Python)`
- `cockpit (Node)` — carries the coverage gate
- `cockpit e2e (Fleet + Playwright)` — makes the e2e suite **blocking** (the L2 criterion)

Until `cockpit e2e` is marked required, the e2e lane runs but does not block merge.
