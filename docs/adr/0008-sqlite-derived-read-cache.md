# ADR-0008: SQLite derived read-cache for session index and Fleet state

Status: Accepted (2026-06-10, with two amendments — see Amendments)
Date: 2026-06-09
Owner: program

## Amendments (at acceptance, 2026-06-10)

The ADR is accepted with two amendments that override the corresponding points in the Decision
section below:

**Amendment 1 — split cache from state.** `server/data/cockpit.db` is a PURE derived cache
(session index; later: messages+FTS, intelligence results, usage rollups) — deletable at any time
and rebuilt from `~/.claude`. Fleet runs are **cockpit-authoritative state**, not derived data:
they CANNOT be rebuilt from `~/.claude`, so they do **not** move into `cockpit.db`. They stay
JSON-per-run in `server/data/fleet/` (with the atomic-write discipline and boot reconciler) for
now; migrating them to a separate `state.db` is a late, optional phase. This resolves the ADR's
internal contradiction with its own Reversibility section: "deleting `cockpit.db` is always a
valid degraded mode" can only be true if nothing authoritative lives in it.

**Amendment 2 — engine is `node:sqlite`, confined to one file.** The native `node:sqlite`
(verified working with FTS5 on local Node 22.19 and CI Node 22; no native build chain) is the
engine, not `better-sqlite3`. The import is confined to ONE file —
`apps/cockpit/server/lib/db/connection.js` — so a swap to `better-sqlite3` is a one-file change.
`apps/cockpit/server/package.json` declares `"engines": { "node": ">=22.13" }` (the first LTS
line where `node:sqlite` is available without a flag).

## Context

ADR-0004 chose "localhost-first, no DB" and deferred any shared-store work explicitly. That was the
right call at the time. The codebase has since grown to the point where several specific pain points
are now visible in the code — not speculation, but observable band-aids over missing indexed state:

**1. Session scan is O(n files) on every request.**
`apps/cockpit/server/routes/sessions.js` added a hard-coded 3-second TTL cache
(`sessionsCache`) because scanning 60+ JSONL files on every render was hammering the event loop
hard enough to cause e2e timeouts under 2 parallel workers. The watcher already knows exactly which
file changed — it could invalidate only that session — but without an indexed store there is nowhere
to put a per-session record. The TTL is a band-aid.

**2. The atomic-write retry loop exists because the filesystem isn't a DB.**
`apps/cockpit/server/lib/atomic-write.js` implements write-to-tmp + rename with a
`[0, 8, 24, 60]ms` retry on `EPERM/EBUSY/EEXIST`. This was introduced specifically because
concurrent writers were corrupting JSON files (runs \#20 and \#21 race probes are cited in the
source). A DB transaction gives you this for free.

**3. The Fleet boot reconciler exists because in-memory state is unrecoverable across crashes.**
`apps/cockpit/server/fleet/fleet-runner.js` calls `reconcileFleetRuns()` on every server start
to reap runs left non-terminal by a prior crash. The reconciler exists because the in-flight
`inFlight` Set and `cancels` Map are in-memory and lost on restart. Transactional state would make
this unnecessary — "reap orphaned runs" becomes a query, not a startup pass.

**4. The intelligence analysis cache is in-memory only.**
`apps/cockpit/server/intelligence/` debounces and caches LLM session-analysis results in a
module-scope Map. Results are lost on every restart, triggering redundant re-analysis of sessions
the server has already seen.

### The constraint from ADR-0004

ADR-0004 requires that "new state is written through the existing atomic-persist discipline so a
future shared store is a swap behind one seam, not a rewrite." A local SQLite file **is** that
swap — it replaces the atomic-JSON pattern behind the same seam without introducing a server
process, network dependency, or migration ceremony at install time.

## Decision

**Add SQLite as a derived read-cache, treating `~/.claude` as the authoritative source of truth.**
The cockpit never writes to `~/.claude`; that invariant is unchanged. SQLite holds only derived /
computed data that the cockpit itself produces or indexes:

- A session index — populated from JSONL scans, invalidated on specific watcher events (not a
  3-second TTL). Enables O(1) lookups, project filtering, date-range queries, and search without
  full file scans.
- ~~Fleet run state — replaces the one-JSON-per-run files in `server/data/fleet/`. Eliminates the
  boot reconciler; orphaned runs are a query.~~ **Overridden by Amendment 1:** Fleet runs are
  authoritative state, not cache — they stay JSON-per-run (separate `state.db` is a late,
  optional phase).
- Intelligence analysis results — persist across restarts.
- (Optionally) workflow / task state — same atomic-write pain exists there.

**What changes:**
- `sessionsCache` TTL hack in `routes/sessions.js` is replaced by event-driven invalidation.
- ~~`lib/atomic-write.js` retry loop is no longer needed for the above paths.~~ *(Amendment 1:
  still needed — Fleet runs and other cockpit-authoritative state keep the atomic-JSON path.)*
- ~~`reconcileFleetRuns()` boot pass becomes a `UPDATE fleet_runs SET status='orphaned' WHERE status='running'` on startup.~~
  *(Amendment 1: the reconciler stays until the optional `state.db` phase.)*
- ~~`server/data/fleet/<id>.json` files are replaced by rows.~~ *(Amendment 1: they are not.)*

**What does NOT change:**
- `~/.claude` is still the only source of truth for session content, config, hooks, tasks, teams, history, memory, MCP, skills, and workflows. SQLite is a cache of what the cockpit reads from it, not a replacement.
- Localhost-first topology (ADR-0004) is unchanged. SQLite is a local file at `server/data/cockpit.db`.
- No migration ceremony at install time. SQLite ships inside Node itself (`node:sqlite`, Node
  22.13+ — Amendment 2). Schema is created on first run; no installer step.

## Options Considered

### A. SQLite derived read-cache (chosen)
Pros: eliminates the three observable band-aids; stays within the localhost-first seam; zero
additional infrastructure; single-file DB is easy to inspect, back up, and delete; reversible.
Cons: adds `better-sqlite3` (or Node 22 native sqlite) as a dependency; introduces a schema that
can drift from `~/.claude`'s on-disk format if the cache is not invalidated correctly.

### B. Status quo (no DB)
Pros: zero new dependency. Cons: the TTL cache hack, retry loop, and boot reconciler accumulate
as the session count grows; no path to history search or cost analytics.

### C. In-memory indexed store (Map/Set, no persistence)
Pros: no dependency; faster than disk. Cons: doesn't survive restarts (intelligence cache problem
remains); no ability to query across runs; same boot-reconciler problem for Fleet.

### D. Full hosted DB (PostgreSQL / hosted SQLite)
Pros: enables multi-user. Cons: explicitly out of scope until ADR-0004 is superseded; introduces
infrastructure that contradicts the localhost-first mandate.

## Consequences

**Positive:**
- Session list loads without a TTL cache; the watcher invalidates exactly the changed session.
- Fleet state is crash-safe without a boot reconciler.
- Intelligence results survive restarts; redundant LLM re-analysis is eliminated.
- History search, per-project filtering, cost analytics become possible.
- `atomic-write.js` retry logic is no longer needed for server-managed state.

**Negative:**
- Node >= 22.13 becomes a hard requirement (Amendment 2: `node:sqlite`, declared in the server's
  `engines` field). No npm dependency or native build chain is added.
- A cache-invalidation bug can produce stale reads — the cache must be invalidated via the same
  watcher events that currently trigger SSE. This is new failure mode that didn't exist with
  direct file reads.
- Schema migration story needs to exist, even if minimal (e.g. delete-and-rebuild on version bump
  is acceptable for a cache).

**Neutral:**
- The `server/data/` directory already exists; `cockpit.db` lives there alongside the audit log.
- The audit log remains JSONL (append-only, sole-writer, contract-validated) — it is not a
  candidate for SQLite because it is an evidence artifact, not a cache.

## Links

- ADR-0004 `docs/adr/0004-deployment-topology.md` — the "localhost-first, no DB" parent decision
- `apps/cockpit/server/routes/sessions.js` — `sessionsCache` TTL hack (lines ~264–270)
- `apps/cockpit/server/lib/atomic-write.js` — retry loop this would replace
- `apps/cockpit/server/fleet/fleet-runner.js` — `reconcileFleetRuns`, `inFlight`, `cancels`
- `apps/cockpit/server/intelligence/` — in-memory cache this would persist

## Reversibility

**Reversible-by-addition.** The DB is a derived cache — deleting `cockpit.db` and falling back to
direct file reads must always be a valid (if slower) degraded mode. The migration path to a shared
store (if ADR-0004 is ever superseded) is the same swap the parent ADR anticipated: replace the
local SQLite file with a remote connection behind the same persistence seam.
