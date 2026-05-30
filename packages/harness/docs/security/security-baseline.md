# Security Baseline

## Never

- commit secrets
- log passwords, tokens, API keys, cookies, PII, or payment data
- bypass server-side auth
- trust client-side authorization
- disable security controls without approval
- perform production destructive operations without approval

## Always

- validate external input
- enforce authorization server-side
- use least privilege
- fail closed
- document env vars
- review risky dependencies

## Review Questions

- Can one user access another user's data?
- Could this expose secrets?
- Could logs leak sensitive data?
- Does this fail open?
- Is rollback possible?
