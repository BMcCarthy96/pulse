# Security policy

Pulse is a synthetic healthcare integration workbench. It is not approved for real PHI, production
credentials, or unreviewed provider traffic.

## Reporting

Please report suspected vulnerabilities privately to the repository owner rather than opening a
public issue. Include the affected route or package, a minimal reproduction, and whether a tenant
boundary or secret could be crossed. We will acknowledge reports within five business days.

## Design controls

- Every authenticated read and mutation is scoped to the session `orgId`; demo sessions receive a
  disposable tenant and a one-hour JWT.
- Evidence sent to an AI provider is bounded and redacted at the assembled-context boundary.
  Logs/events are treated as untrusted prompt data, and structured reports must cite persisted
  evidence IDs.
- AI can propose only four allow-listed actions. Approval revalidates tenant scope and current
  target state, atomically claims the proposal, calls the existing domain operation, and writes an
  audit entry. Chaos and bulk operations are never model-executable.
- Demo capacity, per-session/user/deployment investigation quotas, Redis-backed rate limits, and
  cleanup are enabled before a public demo is exposed.
- Secrets are server-side only. Do not put `ANTHROPIC_API_KEY`, database URLs, Redis URLs, or
  `AUTH_SECRET` in client bundles or screenshots.

## Production checklist

Before enabling a public deployment, turn on GitHub secret scanning and push protection, Dependabot
security updates, CodeQL, dependency review, private OTLP export, and a managed database backup
policy. Configure Vercel/Railway environment variables from the deployment runbook and run the
release smoke plus the k6 profile in `scripts/k6/v3-demo.js`.
