# Continuous QA Automation — two Claude Routines, zero API key

A self-driving QA loop for Mission Control, built entirely on **Claude Code
Routines**: scheduled cloud runs that bill against your **Claude subscription**
(Pro/Max/Team/Enterprise) — **no `ANTHROPIC_API_KEY`, no self-hosted runners.**

```
QA Routine (nightly, subscription, Anthropic cloud)         Fix Routine (subscription)
 • ephemeral container, cached setup script                  • triggers on PR labeled `qa-fix`
 • seeds ~/.claude fixtures (npm run seed:qa)     ─────────▶ • investigates + pushes a fix
 • runs the cockpit + Playwright, exercises it     opens a    • to that same PR
 • opens a DRAFT PR labeled `qa-fix` per bug       draft PR   • CI (.github/workflows/ci.yml)
                                                              •   gates it → a human merges
```

> **Why PR-based, not issue-based?** Routine **GitHub triggers fire on
> `pull_request` and `release` events only — not on issues.** They *can* filter
> PRs by label, draft status, branch, author, etc. So the handoff artifact is a
> labeled draft PR, which is also nicer: the fix lands on the same PR the QA agent
> opened, and CI gates the result. (See "Triggers" in the
> [Routines docs](https://code.claude.com/docs/en/routines.md).)

---

## Prerequisites

1. A plan with **Claude Code on the web** enabled (Pro, Max, Team, or Enterprise).
2. This repo connected at [claude.ai/code](https://claude.ai/code).
3. An **environment** configured for the repo (see next section).
4. The fixture seeder in this repo: `npm run seed:qa` → `scripts/seed-claude-fixtures.mjs`.

## The fixture wrinkle (read this first)

The cockpit's entire data source is the developer's **live**
`~/.claude/projects/<project>/<session>.jsonl` files. A fresh cloud container has
**none** — so a naive QA pass "discovers" an empty dashboard and files false bugs.

`npm run seed:qa` writes a spread of synthetic sessions (active, awaiting-input,
heavy-token, compacted, and one with a subagent tree) into `~/.claude/projects`
under a namespaced fixture dir, with file mtimes set so the parser's
`isActive` / `needsInput` / `abandoned` logic all have something to exercise.
`npm run seed:qa -- --clean` removes just that dir.

Two things make this trustworthy:
- The fixtures are shaped to match `apps/cockpit/server/parsers/sessions.js` and are
  round-trip tested against it.
- If the fixtures (or real Claude data) ever drift from the on-disk format, the
  parser and the Claude driver now **warn loudly** rather than render empty — so
  the QA agent can *assert on those warnings* as a first-class signal.

## Environment setup (one-time, in the web UI)

Configure the repo's environment with a **setup script** (cached across runs) and
the **Trusted** network level (the default allowlist covers npm + pip):

```bash
# Setup script — installs both halves and pre-seeds QA data.
npm install
npm --prefix apps/cockpit install
npm --prefix apps/cockpit/server install
npm --prefix apps/cockpit/client install
python3 -m pip install --quiet pyyaml jsonschema
npx --prefix apps/cockpit/client playwright install --with-deps chromium
npm run seed:qa
```

Keep the network level at **Trusted** unless a test genuinely needs an external
domain; raise it deliberately, never by default.

---

## QA Routine

**Trigger:** Schedule — daily (e.g. 03:00). Custom cron minimum is 1h; nightly is
the right cadence (see Cost below). You can add a `workflow_dispatch`-style one-off
run for manual kicks.

**Repository:** `tjones-gss/mission-control` · **Branch:** `main`

**Prompt (paste into the Routine):**

```
You are the QA agent for Mission Control. The environment setup script has already
installed deps and run `npm run seed:qa`, so ~/.claude has synthetic sessions.

Goal: find real, reproducible defects — not missing-data artifacts.

1. Start the cockpit: `npm run up` (server + client). Wait until both are up.
2. Run the existing suites first and treat failures as bugs:
     - cockpit server:  (cd apps/cockpit/server && npx vitest run)
     - cockpit client:  (cd apps/cockpit/client && npx vitest run)
     - harness:         (cd packages/harness && python3 -m unittest tests.test_cli tests.test_gates tests.test_model_tiers tests.test_contract)
     - e2e (browser):   (cd apps/cockpit && npx playwright test)   # exploratory UI checks
3. Exploratory pass: drive the dashboard with Playwright against the seeded
   sessions. Verify the core loop renders: session list, conversation view,
   token/cost, needs-input badges, the subagent tree, and the harness status
   overlay. Watch the server logs for the format-drift warnings from
   parsers/sessions.js and the Claude driver — if they fire on valid data, that is
   itself a bug.

For EACH distinct defect:
 a. Before filing, search open PRs labeled `qa-fix` for the same signature
    (same failing test / same component / same error). If one exists, comment with
    the new reproduction instead of opening a duplicate.
 b. Otherwise open a DRAFT PR labeled `qa-fix` whose body has: a one-line title,
    exact reproduction steps, expected vs actual, the failing test or log excerpt,
    and the suspected file(s). Put a failing test in the PR if you can write one
    cheaply; otherwise leave the branch as a stub with the repro in the body.
 c. Title every such PR `[qa] <short description>` so they are easy to scan.

Do NOT fix anything yourself, and do NOT open more than 5 PRs in one run — if you
find more, file the top 5 by severity and summarize the rest in the last PR's body.
If everything passes, post a single short comment on the latest commit and open no
PRs.
```

## Fix Routine

**Trigger:** GitHub → **Pull request**, filtered to **Labels include `qa-fix`**
(and *Is draft: true* if you want to only act on the QA agent's drafts).

**Repository:** `tjones-gss/mission-control`

**Prompt (paste into the Routine):**

```
You are the fix agent for Mission Control. A QA PR labeled `qa-fix` describes a
defect. Read the PR body and diff, reproduce the bug, and fix it.

Rules of engagement:
 - Stay in scope: fix the described defect and add/adjust a test that fails before
   and passes after. Do not refactor unrelated code.
 - Match the surrounding code style. Run the relevant suite locally before pushing:
   cockpit → vitest + `npm --prefix apps/cockpit run lint`; harness → unittest.
 - Push your fix to the SAME PR branch (do not open a new PR). Mark it ready for
   review only when the suite is green locally.
 - The repo's CI (.github/workflows/ci.yml) will gate the PR. Do NOT merge — a human
   approves the merge.
 - If the bug is not reproducible, is out of scope, or needs an architectural
   decision, do not guess: post a comment explaining what you found and what you
   need, leave the PR in draft, and stop.
```

---

## Guardrails (the part that bites if skipped)

- **Loop prevention.** The fix Routine triggers only on `qa-fix`; the QA agent
  never touches `qa-fix` PRs except to dedup. The fix agent pushes to the existing
  PR (no new PR), so it can't re-trigger a cascade.
- **Dedup.** QA searches existing `qa-fix` PRs by signature before filing, and is
  capped at 5 PRs per run.
- **Human merge gate.** Neither agent merges. CI gates; you merge. Never enable
  auto-merge for bot PRs.
- **Cost.** Routines draw down subscription usage and have a **daily run cap**
  (visible at claude.ai/code/routines; one-off runs don't count against it). Prefer
  nightly + on-demand over high-frequency schedules. Cap agent effort with a
  turn/iteration limit in the Routine config.
- **Network.** Stay at **Trusted**; widen only for a specific tested domain.
- **Scope.** This is your own repo — legitimate QA automation. Keep secrets in the
  environment's encrypted env vars, never in prompts or fixtures.

## Optional: the GitHub Action path (requires an API key)

If you ever want event-driven runs *outside* Routines, the Claude Code GitHub
Action can trigger on `issues.labeled` (which Routines cannot) and on `@claude`
mentions — but it **requires `ANTHROPIC_API_KEY`** in repo secrets (separate API
billing; no subscription/OAuth path today). Trade-off: richer GitHub event coverage
vs. a metered API key. For a subscription-only setup, stay on Routines.
See [GitHub Actions docs](https://code.claude.com/docs/en/github-actions.md).

## References

- [Routines — triggers, environments, billing](https://code.claude.com/docs/en/routines.md)
- [Claude Code on the web — cloud environments, setup scripts, network](https://code.claude.com/docs/en/claude-code-on-the-web.md)
- [GitHub Actions — event triggers, auth](https://code.claude.com/docs/en/github-actions.md)
- This repo: `scripts/seed-claude-fixtures.mjs`, `.github/workflows/ci.yml`,
  `docs/governance/council-review.md`, `docs/governance/feature-sweep.md`
