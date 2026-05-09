# SOP conventions

SOPs and runbooks describe repeatable operational procedures that support ADRs and specs.

Use runbookdev-style fields:

- Purpose
- Owner
- Triggers
- Prerequisites
- Steps
- Verification
- Rollback
- Escalation

`/architect` may identify missing SOPs and draft structural outlines, but it must not invent owners, credentials, production access, or paid-service decisions. Link SOPs from related ADRs and specs when they are needed before `/conductor` implementation.
