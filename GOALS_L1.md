# GOALS_L1 — Trustworthy (L1 DoD ladder)

**One-line goal:** Reach the L1 "TRUSTWORTHY" bar from `DOD-LADDER.md` — every criterion proven by a passing test, working tree clean, full suite green.

**Success criteria:**
- `npm run test:cockpit` passes (server + client)
- `npm run lint` clean
- All L1 criteria in `DOD-LADDER.md` have a passing test that proves each claim
- `apps/cockpit/package.json` has no corruption (no null bytes)

---

## §0 — Fix before anything else

`apps/cockpit/package.json` has null bytes appended after the closing `}`. Strip them:
```bash
python3 -c "
import sys
data = open('apps/cockpit/package.json','rb').read()
clean = data.rstrip(b'\x00').rstrip()
open('apps/cockpit/package.json','wb').write(clean)
print('fixed:', len(data), '->', len(clean), 'bytes')
"
```
Verify `npm --prefix apps/cockpit test:coverage` runs without JSON parse error before proceeding.

---

## §1 — L1 Criteria to implement

Work through each criterion in order. Write failing test first, then implement to green. Commit on green after each criterion.

### L1-A: Windows shell injection guard (`claude-cli.js`)
**Test:** `tests/claude-cli.test.js` — metacharacter roundtrip test
- Assert that spawning a session with a CWD or prompt containing shell metacharacters (`& | ; < > $ \``) does NOT result in `shell: true` being passed to `child_process.spawn`
- Assert that `.cmd`/`.ps1` paths on Windows are invoked with an explicit interpreter (e.g. `cmd /c` or `node`) rather than relying on shell expansion
- If `buildSpawn()` already handles this correctly (per CLAUDE.md), write the test to document/verify the existing behavior rather than adding new code

### L1-B: PTY does not default to `--dangerously-skip-permissions`
**Test:** `tests/pty-session.test.js`
- Assert that `createPtySession()` does NOT pass `--dangerously-skip-permissions` unless a per-CWD trust grant has been explicitly persisted
- If the trust-grant mechanism doesn't exist yet, the test should assert the flag is NEVER passed (the safe default)
- Document the trust grant path in a TODO comment if not yet implemented

### L1-C: No LLM in the deterministic trust path
**Test:** fleet escalation test
- When a Fleet run needs human approval, the approval path calls the harness CLI directly (`harness approve` or equivalent)
- The test asserts no `claude` sub-session is spawned as part of the approval flow
- This is a negative assertion — mock the spawn and verify no `claude` or `claude.exe` is called during `handleFleetApproval()`

### L1-D: `SCHEMA_VERSION` single-sourced; CI reds on drift
**Test:** add a contract parity test
- `packages/contracts/index.js` exports `SCHEMA_VERSION`
- `packages/harness/harness_core/contract_parity.py` (create if missing) imports the version from `schema-version.json` and asserts it matches
- Server test: assert `require('../../contracts').SCHEMA_VERSION` is a non-empty semver string matching `packages/contracts/schema-version.json`
- The test must FAIL (not skip) if the version drifts

### L1-E: Fleet survives a mid-run restart — `orphaned` terminal state
**Test:** kill-and-restart integration test in `tests/fleet/fleet-runner.test.js`
- Start a Fleet run, immediately call `reconcileFleetRuns()` as if the server restarted mid-run
- Assert that the run transitions to `orphaned` state (not stuck in `running`)
- Assert that a fresh `POST /api/fleet/run` after reconciliation succeeds (not blocked by the orphaned run)
- `reconcileFleetRuns()` is already in `fleet-runner.js` per CLAUDE.md — verify it handles this correctly

### L1-F: Known-bad diff is actually rejected (verification isn't theater)
**Test:** e2e or integration test
- In the Fleet pipeline, a "verify" phase that receives a diff containing a known-bad pattern (e.g. hardcoded secret, `shell: true` in spawn args) must cause the run to halt with status `rejected`, not proceed to `synthesis`
- This is the most complex criterion. If a full e2e test is too expensive, write an integration test that calls the verification module directly with a bad diff and asserts `rejected` is returned.
- If a verification module doesn't exist yet, create a minimal `server/fleet/verifier.js` with one rule: reject diffs containing `shell: true` in modified spawn code. Write the test first.

### L1-G: Gates HALT dependent phases and check evidence
**Test:** gate control-flow test
- In `packages/harness/harness_core/gates.py`, assert that if a phase gate returns a non-zero exit or raises, the dependent phase does NOT run
- Use subprocess mocking — no real Claude invocations
- This is a Python test, add to `packages/harness/tests/test_gates.py`

---

## §2 — After all L1 criteria pass

1. Run the full suite: `npm run test:cockpit` (server + client) + `python -m pytest packages/harness/`
2. Run `npm run lint` and fix any issues
3. Commit everything as `feat(L1): reach TRUSTWORTHY bar — all L1 criteria proven`
4. Update `STATE.md`: add "L1 achieved — TRUSTWORTHY" with the commit hash
5. Update `PROGRESS.md` with final status

---

## §3 — Constraints

- **TDD-first**: write failing test → implement → commit on green. No implementing without a test first.
- **Surgical**: touch only files needed for each criterion. Don't refactor adjacent code.
- **No new deps**: use existing test infrastructure (Vitest, Sinon, node:test).
- **No force push**.
- **Commit on green after each L1 criterion** — don't batch all 7 into one commit.
- If context runs low mid-implementation, commit whatever is green and update this file with a `## Progress` section noting where you stopped.
- If a criterion requires functionality that doesn't exist yet (e.g. `verifier.js`), build the minimal version needed to make the test pass — no over-engineering.
