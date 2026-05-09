# 0002 — REST handlers whitelist project paths against discovered roots

- **Status:** Proposed
- **Date:** 2026-05-09
- **Mode:** brownfield
- **Decision seed:** REST routes that decode user-supplied paths must validate the decoded path against an allow-list of discovered project roots before any filesystem read, instead of relying on path normalization or sandbox checks.
- **Drivers:** ADR-0001 introduces user-controlled paths into a REST surface; defense in depth against path-traversal and decoding tricks; cheap to implement, expensive to add later.

## Context

ADR-0001 commits Oversight to reading from `<projectRoot>/.conductor/<NNNN>/` for any `projectRoot` discovered via session cwds. The new REST surface is:

```
GET /api/conductor                          → list all runs
GET /api/conductor/:projectKey/:adr         → one run
GET /api/conductor/:projectKey/:adr/:kind   → run-scoped file
```

`projectKey` is `encodeURIComponent`-encoded by the client. After `decodeURIComponent`, the server holds an absolute filesystem path supplied by the requester. Naively joining this with a relative file name would let any local request read arbitrary files.

Even though Oversight is a localhost-only single-user tool today, the threat model includes:

- Browser tabs from other origins issuing requests via the user's browser (CSRF surface, partially mitigated by SameSite cookies but Oversight has no auth at all).
- Future integrations (Slack bot, mobile app, remote tunnel) that might widen the request origin.
- Subtle decoding bugs (over-decoding, double-encoded sequences, `..` segments that survive normalization on Windows).

## Decision

In every handler that touches a user-supplied path:

1. Validate `:adr` against `^\d{4}$` (a 4-digit ADR identifier — anything else is an error).
2. `decodeURIComponent` the `projectKey`, returning HTTP 400 if decoding throws.
3. Build the same set the parser uses: `new Set(getKnownConductorRoots())`.
4. Reject with HTTP 404 (not 403, to avoid leaking enumeration info) if the decoded path is not in that set.
5. Only then construct file paths beneath the validated root.

The whitelist is recomputed on every request rather than cached. `getKnownConductorRoots()` is cheap relative to the value of having a fresh check, and stale cache entries are a known foot-gun for whitelist defenses.

The same rule binds the file-content endpoint: `readRunFile(projectPath, adr, kind)` calls `getConductorRunById(...)` first, which performs the whitelist check; without it the function returns `null` and the handler responds 404.

## Consequences

**Positive:**

- A path that doesn't correspond to a discovered conductor root cannot reach the filesystem, regardless of what bytes the requester smuggled through URL encoding, double-encoding, normalization, or symlink tricks.
- The boundary is the same one ADR-0001 already requires for auto-discovery, so there's no separate trust list to maintain.
- The parser and routes share a single source of truth (`getKnownConductorRoots()`); changes to the discovery rule automatically propagate to the security boundary.

**Negative:**

- Requests for projects that haven't been touched since the last `new_session` may briefly 404 until the next discovery refresh. Acceptable: the user just created the run, so a session must already exist; the next sessions-list refresh will surface it.
- Recomputing the whitelist on every request means `O(sessions × jsonls)` work per `/api/conductor/:projectKey/:adr` call. Fine at single-user scale; would need rethinking if multi-user.

## Considered options

### Option 1 — Whitelist against discovered roots (chosen)

- **Pros:** binary decision, no path-arithmetic to get wrong; matches the data flow of ADR-0001 exactly.
- **Cons:** 404s on unwatched projects; recomputation cost.

### Option 2 — Path normalization + prefix check against a fixed allow root

- **Pros:** classic defense; familiar to reviewers.
- **Cons:** there is no fixed allow root — Conductor runs live in arbitrary user project paths. Building one would require either a config or matching every known root against a normalized prefix, which collapses into option 1 with extra steps.

### Option 3 — No whitelist, rely on `path.resolve` + `..` check

- **Pros:** cheapest.
- **Cons:** does nothing about a request for `C:\Windows\System32` or `/etc/passwd` — both are absolute and don't contain `..`. Rejected outright.

## DECIDER notes

- **Drivers:** prevent path-traversal/arbitrary-read in the REST surface introduced by ADR-0001; defense in depth.
- **Evidence:** parser unit test `getConductorRunById() rejects projectPaths not in the known-roots whitelist (path traversal guard)` exercises the check; route test `404 when parser returns null (whitelist miss)` confirms the handler honors it.
- **Constraints:** must work on Windows paths (backslashes survive `encodeURIComponent`); must not depend on canonicalization that differs per OS.
- **Impact:** affects only the new conductor routes; no behavior change elsewhere.
- **Decision:** option 1.
- **Execution:** shipped with the integration in commit `ff1b500`.
- **Review:** revisit if Oversight gains any non-localhost surface (remote access, multi-user, web tunnel) — at that point the threat model widens and this rule may need a stricter outer layer (origin checking, auth, etc.) on top.

## Links

- ADR-0001 — Auto-discovery introduces the path flow this ADR defends.
- Implementation: `server/parsers/conductor.js` (`getConductorRunById`, `readRunFile`), `server/routes/conductor.js`.
- Tests: `server/tests/parsers/conductor.test.js`, `server/tests/routes/conductor.test.js`.

## Open questions

- Should the whitelist also bound the response body (`projectPath` field is echoed back in the JSON response)? Currently the parser returns the path as-is. Acceptable since the whitelist already proves the path is one we authored, but worth confirming if responses are ever consumed by tools that interpret them as locations to write.
- Should we add a unified `validateProjectPath()` helper if a second route family ever needs the same guard? Defer until that second route exists; premature abstraction otherwise.
