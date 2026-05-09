---
adr: '0003'
slice: 1
risk: low
acceptance_commands:
  - 'cd server && npx vitest run'
  - 'cd client && npx vitest run'
---

# Spec: Code-quality polish

- **ADR:** [0003](../adr/_proposals/0003-code-quality-polish.draft.md) (will move to `../adr/0003-code-quality-polish.md` once Accepted)
- **Status:** Draft
- **Date:** 2026-05-09

## Goal

Remove three pieces of latent dead/buggy surface in one bounded slice: the `decodeProjectDir()` function and its `projectName` consumer, the unused `sessionError`/`sessionComplete` sound prefs, and the inconsistent error-response shape in the new conductor route.

## Acceptance criteria

1. `server/parsers/sessions.js` no longer defines or exports `decodeProjectDir`, and the session object returned by `parseSessionFile()` no longer carries a `projectName` field.
2. `client/src/utils/session.js`'s `projectLabel(session)` returns a stable string when `session.cwd` is `null`/`undefined` (e.g., a short session-id-derived placeholder), and references no `projectName` field.
3. `client/src/hooks/useSound.js` `DEFAULT_PREFS.events` no longer contains `sessionError` or `sessionComplete` keys.
4. `client/src/audio/tts.js` `TTS_TEMPLATES` no longer contains `sessionError` or `sessionComplete` keys.
5. `client/src/components/settings/SoundsVoiceTab.jsx` `EVENT_LABELS` no longer contains `sessionError` or `sessionComplete` keys.
6. `server/routes/conductor.js` returns `{ error: 'invalid_adr' }` (no `detail` key) for the malformed-ADR validation path; consistent with every other route's error shape.
7. The full server test suite passes (acceptance command 1).
8. The full client test suite passes (acceptance command 2).
9. Any existing test asserting on `decodeProjectDir`, `projectName`, the dead sound prefs, or the dropped `detail` key is updated to match the new behavior — not skipped or weakened.

## Task decomposition hints

Rough cuts; the planner refines.

- **t1 — Remove `decodeProjectDir` and the `projectName` field.**
  Touch `server/parsers/sessions.js` (remove function + the field assignment in `parseSessionFile`) and `client/src/utils/session.js` (drop the `projectName` reference in `projectLabel`, add a stable fallback). Adjust any existing tests that asserted on `projectName`.

- **t2 — Remove `sessionError`/`sessionComplete` from sound config.**
  Touch `client/src/hooks/useSound.js`, `client/src/audio/tts.js`, `client/src/components/settings/SoundsVoiceTab.jsx`. Adjust any existing tests that assert on those keys.

- **t3 — Normalize `routes/conductor.js` error shape.**
  Single-line edit to `server/routes/conductor.js:15`, plus update the matching test in `server/tests/routes/conductor.test.js` if it asserts on `detail`.

The three tasks are independent and can run in parallel, but per-task `validator` runs are sequential per the conductor protocol.

## Touched-files inventory

- **Modify:**
  - `server/parsers/sessions.js`
  - `client/src/utils/session.js`
  - `client/src/hooks/useSound.js`
  - `client/src/audio/tts.js`
  - `client/src/components/settings/SoundsVoiceTab.jsx`
  - `server/routes/conductor.js`
  - any test file that asserts on the removed identifiers (likely: `server/tests/parsers/sessions.test.js`, `client/src/tests/hooks/useSound.test.js`, `client/src/tests/audio/tts.test.js`, `client/src/tests/components/SoundsVoiceTab.test.jsx`, `server/tests/routes/conductor.test.js`)
- **Create:** none expected.
- **Delete:** none expected (no whole files removed).

## Risk flags

None of the linked ADRs (0001, 0002) are in a high-risk domain (auth, money, idempotency, audit-log integrity, identity, privacy/data-deletion). The slice is `risk: low`. No premortem auto-trigger.

## Out of scope

Deliberately not in this slice:

- Wiring up `sessionError`/`sessionComplete` to real SSE events (option B in the ADR — defer until a real driver exists).
- Fixing `decodeProjectDir` instead of removing it (option C in the ADR — the function provides no value when it works).
- Broader audits: dead exports, comment cleanup, error-shape normalization in routes other than `conductor.js` (the polish inventory found no other anomalies).
- The `.conductor/` test fixture in this project's working tree (gitignored, intentional).

## Open questions

(None — the three changes are well-bounded and the worker has full latitude on the placeholder string in t1.)
