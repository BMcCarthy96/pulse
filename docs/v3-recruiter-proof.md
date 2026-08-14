# Pulse v3 recruiter proof

This is the short evidence trail for the v3 portfolio review. It is intentionally reproducible
without an Anthropic key.

## 90-second walkthrough

1. Open `/recruiter` and choose **Try the live demo**.
2. Show the persistent walkthrough, isolated OPS badge, and **Reset demo** control.
3. Follow the walkthrough to the seeded EHR incident and choose **Find the first signal**.
4. Point to the streamed `Recorded fixture` label, redacted evidence board, cited hypotheses, and
   proposed `RETRY_JOB` action.
5. Approve the retry, refresh the workspace, and show the action status plus audit entry.
6. Reset the demo to return the workspace to a known state.

With `ANTHROPIC_API_KEY` and `INVESTIGATION_LIVE_ENABLED=true`, the same guided UI emits live
structured output and persists model, prompt version, token, cost, latency, and trace metadata.
Without the key, arbitrary text is rejected with a clear “choose a recorded question” response;
only the three exact guided questions use fixtures.

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
  incident reads, runs the provider-free fixture SSE, reads persisted telemetry, resets the tenant,
  and enforces the 1% error / 750ms API p95 / 3s provisioning thresholds. Set K6_WEBHOOK_URL and
  K6_WEBHOOK_SECRET to include a signed tenant webhook; set K6_APPROVE_ACTION=true to include the
  proposal approval path.
