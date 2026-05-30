# System Overview

## Purpose

Unset

## High-Level Architecture

```text
Client
  → API
  → Services
  → Database
  → External Providers
```

## Boundaries

- UI does not access database directly.
- Server enforces auth and authorization.
- Services contain business logic.
- Data access is isolated.
- External integrations are wrapped.

## Stack

Frontend:
Backend:
Database:
Auth:
Hosting:
Testing:
