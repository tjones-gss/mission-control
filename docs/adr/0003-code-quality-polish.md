# 0003 — Code-quality polish: remove dead surface and normalize error shape

- **Status:** Proposed
- **Date:** 2026-05-09
- **Mode:** brownfield
- **Decision seed:** Do a single bounded polish slice that removes three pieces of latent dead/buggy surface accumulated in the codebase.
- **Drivers:** prevent drift accumulation; small surface is easier to reason about; recently-shipped features (Conductor integration) introduced a small inconsistency worth normalizing while it's fresh in tree.

## Context

Three small issues exist in the codebase today, none individually critical, all worth cleaning up before they accumulate further:

1. **`decodeProjectDir()` is latently buggy** — `server/parsers/sessions.js:349-351` decodes encoded project dir names back to filesystem paths, but mishandles project names containing hyphens (it converts every `-` after the drive letter into `\`). Today the buggy output is hidden behind a `cwd || projectName` fallback in `client/src/utils/session.js`, so the bug only fires if a session record has no `cwd` field — which doesn't happen in normal Claude usage. The CLAUDE.md memory already flags this as cosmetic.

2. **`sessionError` and `sessionComplete` sound prefs are dead** — declared in `client/src/hooks/useSound.js` (`DEFAULT_PREFS.events`) and `client/src/audio/tts.js` (`TTS_TEMPLATES`), but no SSE event maps to them. The settings UI auto-renders both, so users see two sound options that never fire. Polish-inventory grep confirmed no caller anywhere in `client/src/`.

3. **Error response shape inconsistency** — `server/routes/conductor.js:15` returns `{ error: 'invalid_adr', detail: 'ADR must be 4 digits' }`, while every other route in the codebase returns a single `error` key. Introduced by the recent Conductor integration commit (`ff1b500`); cheap to fix while still in working memory.

None of these visibly fail today. Together they're the kind of drift that becomes harder to fix the longer it sits.

## Decision

Do a single bounded polish slice with three independent changes:

1. **Remove `decodeProjectDir()`** from `server/parsers/sessions.js` and remove the `projectName` field from the session object it returns. Update `projectLabel()` in `client/src/utils/session.js` to use `cwd` only; fall back to a stable placeholder (e.g., a session-id-prefix string) when `cwd` is missing. There are no other consumers of `projectName`.

2. **Remove `sessionError` and `sessionComplete`** entries from `DEFAULT_PREFS.events` (`client/src/hooks/useSound.js`), from `TTS_TEMPLATES` (`client/src/audio/tts.js`), and from `EVENT_LABELS` (`client/src/components/settings/SoundsVoiceTab.jsx`). Existing localStorage prefs that reference them will be silently ignored on the next load — the merge in `getSoundPrefs()` only surfaces keys present in `DEFAULT_PREFS.events`.

3. **Normalize `server/routes/conductor.js:15`** to drop the `detail` key — return only `{ error: 'invalid_adr' }`. The `error` key already names the condition; `detail` was redundant.

## Consequences

**Positive:**
- Smaller surface; fewer dead code paths to mentally model.
- Settings UI no longer offers two sound preferences that never fire — eliminates a small UX confusion.
- REST error shape is uniform across the entire `/api/*` surface.
- The CLAUDE.md memory note flagging `decodeProjectDir()` becomes obsolete (removable).

**Negative:**
- A user whose JSONL session somehow lacks `cwd` will see a generic placeholder instead of a (wrongly) guessed project name. Acceptable: the guess was wrong anyway.
- A user who customized the `sessionError`/`sessionComplete` prefs will have those choices silently dropped. No upgrade path needed since the prefs never did anything.
- Loss of slightly more explicit error messaging at the one route. The conductor route's tests already assert on `error` only, so client behavior is unchanged.

## Considered options

### Option A — Remove (chosen)

Smallest surface. Simplest to reason about. Reversible: if a real driver appears later (e.g., we add a server-side `sdk_error` → sound mapping), wiring `sessionError` back in is one PR.

### Option B — Wire up the dead sounds

Tempting because the prefs already exist. Rejected: there is no clean SSE source for "session errored" or "session completed" today. Inferring those from `sdk_error`/`sdk_result` would expand scope and fold a UX decision into a polish slice. Defer until a real driving need appears.

### Option C — Fix `decodeProjectDir()` instead of removing

The reverse mapping is computable if you know which separator was used (`-` for path separator, `--` as escape). Rejected: `cwd` is always present and correct, so the function provides no value when it works. Removing is strictly cleaner. Fixing also doesn't address the broader cosmetic-fallback question.

## DECIDER notes

- **Drivers:** prevent drift accumulation; tight scope works well with /conductor's loop bounds (max 5 iters per task before split).
- **Evidence:** polish inventory by Explore agent on 2026-05-09 confirmed all three findings; no other obvious dead surface in parsers, components, or routes.
- **Constraints:** must not break the existing 1,136 tests; UI must still render correctly when cwd is null; existing localStorage prefs must not throw on the next load.
- **Impact:** small, contained, reversible by `git revert` if any unforeseen consumer breaks.
- **Decision:** option A across all three items.
- **Execution:** /conductor 0003 drives the slice end-to-end through phases 0–5.
- **Review:** retrospective writes `skill-diff-proposal.md` if the run surfaces anything worth fixing in the conductor skill itself.

## Links

- Related: ADR-0001 (auto-discovery — established the path that introduced item 3 above).
- Related: ADR-0002 (REST whitelist — established the route that introduced item 3 above).
- Implementation spec: [`docs/specs/0003-code-quality-polish-implementation.md`](../specs/0003-code-quality-polish-implementation.md).

## Open questions

(None — the three changes are independent and well-bounded.)
