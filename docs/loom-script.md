# Recruiter video script — 90 seconds

Record against the public deployment at 1440×900, 100% zoom. Start on `/recruiter` in a signed-out
browser and leave live AI disabled: the recorded path is deterministic, labelled honestly, and is
the same path CI verifies. A clean demo session is provisioned during the take.

## 0:00–0:15 — State the product problem

Show the public hero and the synthetic/recorded badges.

> “Pulse is an investigation workspace for integration failures. It combines job attempts,
> connector health, and incident evidence so an operator can find what changed and recover safely
> before a clinician discovers missing data.”

Choose **Try the live demo**.

## 0:15–0:35 — Establish the system and the boundary

Let the walkthrough open. Point to the isolated-demo label, dead job, and active incident on the
overview.

> “This click created an isolated synthetic tenant that expires in an hour. The worker uses
> BullMQ, Postgres, and Redis to turn repeated upstream failures into connector health and an
> incident—not just another log stream.”

Choose **Next: Open the EHR incident**.

## 0:35–1:05 — Investigate from bounded evidence

In the investigation workspace, choose **Find the first signal**. Let the activity stream finish,
then point to **Recorded fixture**, evidence citations, confidence, uncertainty, and the proposed
retry.

> “The investigation can run live, but this public path uses a versioned recording, so it is
> repeatable and spends no model budget. The same schema and safety boundary apply: evidence is
> redacted before model access, every claim cites the bounded evidence set, and the model may only
> propose allow-listed actions.”

## 1:05–1:22 — Show human approval and auditability

Approve the retry, then show **SUCCEEDED** and the audit entries.

> “AI never executes the operation. An OPS user approves after Pulse revalidates the target, and
> both the approval and retry are persisted in the audit trail.”

## 1:22–1:30 — Close on engineering proof

Return to `/recruiter` or cut to the proof cards.

> “The repository verifies its own test and eval counts, enforces coverage and Lighthouse budgets,
> boots the production worker image in CI, and smoke-tests this deployed journey every day.”

End on the repository URL and public demo URL.

## Recording checklist

- Say “synthetic data” and “recorded AI” aloud.
- Show the generated demo—not the shared seeded personas—as the primary recruiter path.
- Do not imply a discovered root cause when the evidence only supports a hypothesis.
- Do not expose environment values, provider keys, Railway/Vercel dashboards, or real user data.
- Reset the demo after the take.
- Add captions and put the final video link in both the README and `/recruiter` page.
