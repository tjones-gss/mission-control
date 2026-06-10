# Runbook — operating Mission Control

Operate / deploy / roll back the Mission Control cockpit on its
[ADR-0004](docs/adr/0004-deployment-topology.md) **localhost-first** topology.

## Honest scope note (read first)

This is **not** a production / multi-tenant deployment runbook. Per ADR-0004 the
system is a deliberate **single-operator localhost singleton**:

- the cockpit server binds **loopback only** and has **no auth middleware** (only
  helmet + rate-limit + a DNS-rebinding host guard);
- Fleet lifecycle state is in-memory plus one JSON-per-run on local disk (the
  server is the single spawner/writer);
- all oversight reads are local `~/.claude` files.

Do **not** expose the cockpit on a public interface. There is no authentication,
RBAC, or secrets management — those are explicitly out of scope until ADR-0004 is
superseded. The "rails" (the harness) are best-effort accident-prevention, **not**
an adversary-proof security boundary; the real control for destructive operations
is OS-level sandboxing.

## Operate

Launch the cockpit (server + client together) from the repo root:

```
npm install                                  # root: cockpit + contracts workspaces
npm --prefix apps/cockpit/server install      # server deps
npm --prefix apps/cockpit/client install      # client deps
npm run up                                    # canonical launch (cockpit dev)
```

`npm run up` runs the cockpit `dev` script, which starts the Express server and the
Vite/React client. The server listens on loopback.

### Health & observability

- **Health:** `GET /api/health` (see the served OpenAPI at `GET /api/docs`).
- **OpenAPI spec:** `GET /api/docs.json` (machine-readable) / `GET /api/docs` (UI).
- **Audit log:** append-only JSONL at `apps/cockpit/server/data/audit/audit.jsonl`
  — every spawn / approval / merge the cockpit orchestrates (cockpit is the **sole**
  writer; harness-CLI-direct actions outside the dashboard are a documented gap).
  The log is never mutated or truncated; a monotonic `seq` makes that observable.
- **Tracing:** OpenTelemetry is **OFF by default**, env-gated by `OTEL_ENABLED`.
  The localhost path pays nothing unless you opt in. An OTLP exporter is a later
  opt-in; provability today is an in-process in-memory span exporter (tests only).

### Run state on disk (ADR-0004 local-JSON)

- Fleet runs: `apps/cockpit/server/data/fleet/` (one JSON per run; gitignored).
- Fleet templates: `data/fleet-templates/` (gitignored).
- Audit log: `apps/cockpit/server/data/audit/audit.jsonl` (gitignored runtime log).

A boot reconciler cross-checks pid liveness on startup and marks unrecoverable
non-terminal runs `orphaned`, so a server restart never leaves a run wedged at
`running`.

### The SQLite read-cache (ADR-0008)

- `apps/cockpit/server/data/cockpit.db` (+ `-wal`/`-shm` companions; gitignored)
  is a **pure derived cache** of `~/.claude`: the session index, the FTS search
  corpus, daily usage rollups, and persisted intelligence analyses.
- **Recovery for ANY cache weirdness is one step: delete `cockpit.db` and
  restart.** The server rebuilds it in the background from `~/.claude`; while
  the db is unavailable, reads fall back to direct parser scans (slower, never
  wrong). A schema-version bump or detected corruption triggers the same
  delete-and-rebuild automatically.
- The cache is NOT the system of record for anything: fleet runs stay
  JSON-per-run, the audit log stays append-only JSONL, and `~/.claude` remains
  the only source of truth for session content.
- Requires Node **22.13+** (built-in `node:sqlite`; the server `package.json`
  `engines` field and the installer preflight both enforce this).

## Deploy

There is no hosted deploy target. "Deploy" means: pull the desired revision, install
deps, and (re)launch on the operator's machine.

```
git fetch --tags
git checkout v0.4.0           # or a branch / main
npm install
npm --prefix apps/cockpit/server install
npm --prefix apps/cockpit/client install
npm run up
```

A containerized localhost run is also available (still loopback-only, same scope
caveat):

```
npm run up:docker             # docker compose up --build (docker/docker-compose.yml)
npm run down:docker
```

## Roll back

Because state is local JSON files and there is no shared database or migration
chain, **rollback is a git checkout** of the previous good revision plus a relaunch:

```
git fetch --tags
git checkout v<previous-version>     # e.g. the prior tag, or a known-good SHA
npm install
npm --prefix apps/cockpit/server install
npm --prefix apps/cockpit/client install
npm run up
```

Notes:

- **No destructive data migration to undo.** On-disk run/audit JSON is
  append-or-replace per file; an older server reads older files fine, and the
  audit log is append-only (never rewritten), so rolling the binary back does not
  corrupt history.
- If a Fleet run is mid-flight when you roll back, the boot reconciler on the
  older revision reaps non-terminal runs to `orphaned` rather than resuming them.
- The contract surface is versioned (`SCHEMA_VERSION`); if a rollback crosses a
  schema bump, the older cockpit emits/consumes the older surface — that is the
  point of versioning the contract (see `packages/contracts/CHANGELOG.md`).

## Cutting a release

Releasing (version axes, tag → GitHub release + SBOM) is a separate procedure —
see [`RELEASING.md`](RELEASING.md).
