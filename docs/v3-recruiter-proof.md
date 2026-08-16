# Pulse v3 demo proof

This is the short evidence trail for the v3 portfolio review. It is intentionally reproducible
without an Anthropic key.

## 90-second walkthrough

1. Open `/demo` and choose **Launch interactive demo**.
2. Use the highlighted **Open incident** button.
3. Run **Find the first signal** and wait for the deterministic report.
4. Open the highlighted citation, then choose **Actions**.
5. Open the retry and choose **Revalidate and approve**.
6. Show the successful action and audit entry.
7. Open **Demo controls** and reset the workspace.

With `AI_ENABLED=true`, `ANTHROPIC_API_KEY`, and `INVESTIGATION_LIVE_ENABLED=true`, the same guided
UI emits live provider output and persists model, prompt version, token, cost, latency, and trace
metadata. Without those flags, arbitrary text is rejected with a clear “choose a guided question”
response; the three guided questions use deterministic synthesis.

## Proof points

| Concern          | Evidence in the repo                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Tenant isolation | `DemoSession`, org-scoped Prisma filters, tenant-aware webhook path, org-aware simulator headers                            |
| Safe AI          | `INVESTIGATION_PROMPT_V3`, Zod report schema, redacted evidence excerpts, action allow-list, deterministic v3 eval fixtures |
| Human approval   | `approve`/`dismiss` routes, atomic proposal claim, stale-target `409`, audit writes                                         |
| Reliability      | BullMQ queues, five-minute cleanup, repeatable sync keys include `orgId`, integration tests                                 |
| Cost control     | 2/session, 10/user/hour, 30/org/day, 30/deployment/day, $0.20/live run, $5/deployment/day                                   |
| Delivery quality | CI lint/typecheck/coverage/evals/build/docker/e2e, OpenAPI drift test, security workflows                                   |

## Release gates

The canonical commands and expected evidence are maintained in
[`docs/recruiter-testing.md`](recruiter-testing.md). In short:

- `pnpm verify:fast`
- `pnpm run doctor`
- `TEST_DATABASE_URL=... TEST_REDIS_URL=... pnpm test:integration`
- `pnpm build`
- `E2E_DATABASE_URL=... E2E_REDIS_URL=... pnpm test:e2e`
- `DEMO_BASE_URL=https://<deployment> pnpm verify:release`
- `k6 run scripts/k6/v3-demo.js` against a disposable deployment
  The k6 profile provisions one isolated demo tenant per VU, exercises authenticated overview and
  incident reads, runs the provider-free deterministic SSE path, reads persisted telemetry, resets the tenant,
  and enforces the 1% error / 750ms API p95 / 3s provisioning thresholds. Set K6_WEBHOOK_URL and
  K6_WEBHOOK_SECRET to include a signed tenant webhook; set K6_APPROVE_ACTION=true to include the
  proposal approval path.
