# 0001 — Auto-discover Conductor runs via session cwds

- **Status:** Proposed
- **Date:** 2026-05-09
- **Mode:** brownfield
- **Decision seed:** Auto-discover `.conductor/` directories from known session `cwd`s rather than requiring explicit project registration.
- **Drivers:** zero-config UX, low surprise for an existing user with sessions in many projects, kept the v1 scope tractable.

## Context

The Conductor harness writes per-run state into `<projectRoot>/.conductor/<NNNN>/` — outside `~/.claude/`, which is the only path Oversight watched before this change. To surface those runs in the dashboard, Oversight needs to know which `.conductor/` directories exist and watch them for changes.

Three watch strategies were available:

1. **Auto-discover via session cwds** — walk every Claude session JSONL the watcher already knows about, read `cwd` from the first records, and treat any `cwd` that contains a `.conductor/` directory as a watch target.
2. **Manual project registration** — surface a settings UI where the user adds project roots explicitly. Oversight watches only registered roots.
3. **Hybrid** — auto-discover plus a "watch this project" affordance for projects with no Claude session yet.

Constraints in scope:

- Oversight is a single-user local tool; no multi-tenancy or auth boundaries to defend.
- The watcher must be cheap; sessions JSONL files can be hundreds of MBs in aggregate.
- Conductor's on-disk state is per-project, so the dashboard needs to reach outside `~/.claude/`.
- Path-traversal exposure: any time we let user-controlled paths flow into FS APIs, we need a whitelist guard. See ADR-0002.

## Decision

Adopt strategy **(1) auto-discover via session cwds** for v1.

- `server/parsers/conductor.js` exports `getKnownConductorRoots()`, which walks `~/.claude/projects/*/*.jsonl`, reads the first ~8 KB of each file to extract `cwd` (skipping metadata stub records like `last-prompt`/`ai-title` that don't carry `cwd`), dedupes the list, and filters to the cwds that contain a `.conductor/` directory.
- `server/watcher.js` calls `getKnownConductorRoots()` on startup and on every `new_session` event, then `chokidar.add()`s any newly discovered roots. `chokidar.add()` is idempotent so no separate dedup logic is needed.
- The dashboard exposes no UI for watch-list management. The user simply runs `/conductor NNNN` in any project where they have at least one Claude session, and Oversight picks the run up automatically.

## Consequences

**Positive:**

- Zero configuration. Any conductor run in any tracked project shows up immediately.
- New projects join the watch list naturally on the next `new_session` event.
- The map from cwd → `.conductor/` is derived from on-disk truth at every refresh, so removing a `.conductor/` dir in a project also removes it from the dashboard the next time the parser runs.

**Negative:**

- Projects with no Claude session ever created in them are invisible to Oversight even if they have `.conductor/` runs. Mitigation: the user creates a session in that project, which is already part of the normal Conductor workflow (the harness needs a session to drive the run).
- Reading the first 8 KB of every JSONL on every parser call is not free. With ~30 projects and ~hundreds of JSONLs total on the user's machine today, the cost is bounded; if it becomes hot, switch to a startup scan + cache invalidated by the watcher's `new_session` event.
- Auto-discovery means the server reaches outside `~/.claude/` with paths derived from JSONL content. ADR-0002 addresses the path-traversal exposure that follows.

## Considered options

### Option 1 — Auto-discover via session cwds (chosen)

- **Pros:** zero-config; covers the realistic happy path (you're using Conductor in a project you already drive with Claude); minimal new UI surface.
- **Cons:** projects without any Claude session are invisible; cost of cwd extraction grows linearly with session count.

### Option 2 — Manual registration

- **Pros:** predictable; explicit consent for the server to read outside `~/.claude/`; easier to reason about path-traversal boundaries (the registration UI itself is the boundary).
- **Cons:** every project requires a setup step before runs appear; settings persistence and migration become real concerns.

### Option 3 — Hybrid

- **Pros:** auto-discover covers the common case and manual add covers brand-new projects.
- **Cons:** strictly more code than option 1 for benefit only realized in edge cases the user can fix by creating a session. Defer until needed.

## DECIDER notes

- **Drivers:** zero-config, fast time-to-value, scope tractability for v1.
- **Evidence:** in the smoke test the parser correctly auto-discovered a real run in `members-only-poker-club` that wasn't in scope of the integration work — proving the strategy delivers value without explicit user action.
- **Constraints:** read-only contract (the server never writes to `.conductor/`), Windows path semantics in cwd handling, chokidar watch budget.
- **Impact:** scoped to the new Conductor tab; no behavior change for any other tab. Reversible: switching to manual registration later is additive (auto-discover can stay as a default seed).
- **Decision:** option 1 for v1.
- **Execution:** shipped in commit `ff1b500` (`feat(conductor): integrate Conductor harness state into Oversight dashboard`).
- **Review:** revisit if (a) the parser cost shows up in profiling, (b) users start asking to track projects with no Claude session, or (c) the path-traversal whitelist proves insufficient.

## Links

- ADR-0002 — REST handlers whitelist `projectPath` against discovered roots.
- Implementation: `server/parsers/conductor.js`, `server/watcher.js`.
- Commit: `ff1b500` (2026-05-09).

## Open questions

- Should retrospective/archived runs (`.conductor/_archive/<N>/`) be surfaced separately from active runs? Currently filtered out by the 4-digit ADR regex.
- Should the parser cache the cwd list across requests, invalidated by the watcher's `new_session`/`unlink` events? Defer until profiling shows the read cost matters.
