# Definition-of-Done ladder — the testable "2027 bar"

Four rungs, each a **release gate**: you cannot tag L*n+1* until L*n* is green in CI **and** verified
on the author's Windows 11 box. The existing 981 server / 504 client / 77 python suites stay green
throughout; all new code is TDD-first. Each criterion is tied to the CI check / test that proves it and
the council gap or premortem mode it closes.

## L0 — HONEST (no silent lies) · owner: Phase 1

| Criterion | Proven by | Closes |
|---|---|---|
| The 3 critical parsers surface a persistent `parser_degraded` state, never a silent blank | `tests/parsers/*` + client banner test; SSE `parser_degraded` emitted | council HIGH #1; durability/absorption/adoption premortems |
| `hooks.js`/`config.js` distinguish "parse failed" from "none configured" (never a bare `{}`) | parser unit test asserts degraded marker ≠ empty | durability premortem "misreports safety posture" |

## L1 — TRUSTWORTHY (survives reality) · owner: Phase 1 (+ Phase 2 loop work)

| Criterion | Proven by | Closes |
|---|---|---|
| No Windows `shell:true` command injection on `.cmd`/`.ps1` | metacharacter-roundtrip test asserts literal argv (`tests/claude-cli.test.js`) + manual Win11 | council HIGH #4(a); security premortem fatal |
| PTY does not default to `--dangerously-skip-permissions` | `tests/pty-session.test.js`: no skip without persisted per-cwd trust grant | council HIGH #4(b); security premortem fatal |
| No LLM in the deterministic trust path (`harness approve`) | fleet escalation test: harness CLI called directly, no `claude` session | council MED #6 |
| `SCHEMA_VERSION` single-sourced; CI reds on JS/Python drift | CI parity step + `test_contract.py` parity assertion (fails, not skips) | council MED #7 |
| Fleet survives a mid-run restart — no run wedged at `running` | kill-and-restart e2e test; boot reconciler; `orphaned` terminal state | council HIGH #2; durability/security premortems |
| A known-bad diff is actually rejected (verification isn't theater) | real-child e2e Fleet test (verify→reject→retry→synthesis) | council HIGH #3; loop-reliability premortem |
| Gates HALT dependent phases and check evidence | `loop.py` control-flow tests; evidence gates in `test_gates.py` | loop-reliability premortem (Phase 2) |

## L2 — ADOPTABLE (someone returns day-2) · owner: Phase 3

| Criterion | Proven by | Closes |
|---|---|---|
| Empty `~/.claude/projects` shows a Welcome + one-click first agent, not a blank | client first-run test | adoption premortem fatal "empty front door" |
| One-click in-cockpit rails adoption (pure-Node hook fallback) | rails-adoption integration test | adoption premortem fatal "rails ceremony" |
| CI gates coverage (realistic floor, ratcheted) + runs the e2e suite | `.github/workflows/ci.yml` coverage + e2e jobs block merge | maturity scorecard (Testing/CI not gated) |

## L3 — STANDARD (vendor-resistant) · owner: Phase 4

| Criterion | Proven by | Closes |
|---|---|---|
| Cross-vendor oversight label DROPPED — oversight scoped to Claude Code only; cross-vendor lives in the RAILS + the contract, not the viewer | ADR-0005 Amendment label correction; no multi-vendor reader shipped | absorption premortem "cross-vendor never built" |
| `harness status` published as a versioned vendor-neutral spec | contracts CHANGELOG + CI parity gate | absorption premortem "contract is the moat" |
| Observability is THREE delivered proofs, not OpenAPI alone: (1) OpenAPI served at `/api/docs`, (2) env-gated OTel traces (`OTEL_ENABLED`, OFF by default), (3) an append-only JSONL audit log of every spawn/approval/merge with the **cockpit as sole writer** | (1) `/api/docs` live + CI exports OpenAPI; (2) in-process `InMemorySpanExporter` span-export test (no collector, green on Win11+CI); (3) audit-write + append-only-invariant tests (`lib/audit-log.test.js`, `lib/audit-wiring.test.js`, `fleet/fleet-audit-wiring.test.js`). KNOWN LIMITATION: decisions made against the harness CLI **directly** (outside the dashboard) are not yet captured — no second Python-side writer this phase (ADR-0004) | maturity scorecard (Observability); security premortem |
| Release engineering: semver off 0.1.0, CHANGELOG, runbook, release automation + SBOM | release workflow produces a tagged GitHub release + SBOM | maturity scorecard (Versioning 2/10) |

**Litmus (L3 complete):** a Claude Code release shipping native cross-session view does **not** make
Mission Control redundant — value lives in the durable rails + the versioned contract, not the window.
