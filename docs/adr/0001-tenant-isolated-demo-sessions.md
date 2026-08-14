# ADR 0001: Tenant-isolated recruiter demo sessions

## Decision

Provision a disposable organization and OPS user for every guarded demo login. Store a one-hour
`DemoSession` row with an expiry, cap active sessions at 25, and delete expired organizations via a
five-minute worker janitor. Canonical URLs remain compatible; tenant-aware webhooks use
`/api/webhooks/tenant/{orgSlug}/{connectorKey}`.

## Why

Shared demo data makes concurrent recruiter sessions interfere with each other and makes cleanup
ambiguous. A tenant boundary demonstrates production judgment while keeping the fixture compact.
