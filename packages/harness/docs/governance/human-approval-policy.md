# Human Approval Policy

AI agents may not independently approve:

- production deployments
- destructive database migrations
- production data changes
- billing or payment behavior changes
- auth/permission model changes
- secret rotation
- infrastructure changes
- major dependency upgrades
- bulk deletes
- external customer communications

Approval must record:

- approver
- date
- scope
- risk accepted
- rollback plan
