# Knowledge base

Topic-keyed lessons. Future agents (workers, premortem, ratifier) read the slice for their topic before starting work.

## Topic files

Each topic lives in its own file: `docs/kb/<topic>.md`. Examples that other projects use:
- `auth.md` — authorization, session handling, RLS
- `payments.md` — money, idempotency, settlement
- `data-retention.md` — privacy, deletion, audit
- `migrations.md` — schema changes, rollout, rollback

This project starts empty. Topics are added by the conductor's `journalist` role as runs accumulate KB-worthy lessons (gotchas, surprises, "next time avoid X" findings).

## Entry format

Append-only, dated bullets:

```markdown
- **YYYY-MM-DD** — short lesson. _Context:_ what we were doing. _Why it matters:_ why future-you cares.
```

## Index

(none yet — populated as topics are created)
