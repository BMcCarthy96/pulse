# Loom script — 2:30

**Setup before recording.** Fresh seed (`pnpm db:seed`), `HEALTH_TICK_SEC=15` and
`INCIDENT_STABILITY_MIN=1` in `apps/worker/.env` so the walkthrough does not stall on production
timings, `ANTHROPIC_API_KEY` set so the summary actually generates. Browser at 1440×900, zoom
100%, one tab. Sign in as **Dana Alvarez** (ADMIN) before you start recording.

Have a second connector already in `DEGRADED` if you want the overview to look alive on the
opening shot — otherwise the fresh seed's history carries it.

---

### 0:00 — The problem (talking head or overview on screen)

> "When a hospital's integrations break, nobody finds out from a dashboard. They find out when a
> clinician can't see yesterday's labs, or when a month of claims turns out to have been
> rejected. This is Pulse — a monitoring console for exactly that layer."

Keep it to two sentences. Do not explain the tech yet.

---

### 0:20 — Overview tour

On `/`:

- Four connector tiles — an EHR poll sync, an inbound lab feed, an outbound claims pipeline, a
  rate-limited eligibility service. **Name the integration patterns**, not the UI.
- Point at the dead-job count and the 24-hour error-rate chart.

> "Four connectors, four different integration patterns. Everything upstream is simulated, which
> is the point — it means I can break any of them on demand."

---

### 0:45 — Break it, and watch the retries

Open the EHR connector → chaos panel → **OUTAGE** → Apply. Let the confirm dialog show for a
beat — it quotes the audit entry that is about to be written.

> "The chaos panel isn't a test hook, it's a feature. Reproducible failure demos."

Click **Run sync now**, then switch to the Jobs tab.

> "Five attempts, exponential backoff, two to thirty-two seconds. Every attempt is recorded —
> not just the last one — because that history is what tells an operator whether retrying is even
> worth it."

Let the attempts counter tick up. Land on the job reaching **DEAD**.

---

### 1:20 — Detection and the AI summary

Wait for the connector to flip to **DOWN**, and the incident bubble to appear in the sidebar.
Open the incident.

> "The health engine scores a rolling fifteen-minute window every tick. One thing worth calling
> out: a job row is not a call. A sync that burned five retries hit that upstream five times, and
> counting it once was a real bug — a total outage took twenty-five minutes to detect instead of
> two."

Point at the AI summary card as it goes queued → generating → **ready**.

> "The summary is drafted by Claude from redacted context. Two design decisions matter here."

Point at the footer.

> "First — everything outbound goes through a redaction layer: patient refs, member IDs, dates of
> birth, names. And it isn't trusted on its own; the payload is re-scanned for raw identifiers
> before it's sent, and the job fails rather than shipping PHI. That file is at a hundred percent
> branch coverage."
>
> "Second — the model is deliberately _not_ told the chaos mode. That's the ground truth. If I
> fed it in, the summary would just restate the fault I injected and prove nothing. It has to
> reason from the symptoms."

If the generated text says the cause is unconfirmed, read that line aloud — it is the proof.

Also point at "prompt v1" in the footer.

> "The prompt is versioned and snapshot-tested. Editing it without bumping the version fails CI,
> because every stored summary claims a version."

---

### 1:50 — Recovery

Chaos back to **HEALTHY**. Go to `/jobs`, click **Retry all matching** — pause on the confirm
dialog.

> "That count comes from its own query, not the loaded page. It used to say 25 while the bulk
> retry re-queued 63."

Watch the jobs succeed, the connector return to **HEALTHY**, and the incident move
**MONITORING → RESOLVED**. Open the incident timeline.

> "Auto-resolve after a stability window, and if it flaps it rolls back to whatever it was
> before — acknowledged or open."

Then Settings → audit log.

> "Every mutation writes an audit entry. Chaos change, retries, acknowledgement — all attributed."

---

### 2:15 — Architecture and tests

Cut to the README architecture diagram.

> "Next.js on Vercel for the dashboard and API; a Node worker on Railway for the queues, health
> engine and simulator, because BullMQ needs a process that stays alive. Postgres and Redis
> shared between them."

Then the CI badge / test summary.

> "A hundred and seventy-one unit tests, fifty-one integration tests against real Postgres and
> Redis, and a Playwright run of exactly the flow you just watched — with no API key, so the
> graceful-degradation path is tested on every commit."

Close:

> "Code and a full write-up are in the README. Thanks for watching."

---

## Notes

- **Total: 2:30.** The retry cycle in the 0:45 segment is the part that runs long — if the tick
  interval is not shrunk it will eat thirty seconds of dead air. Shrink it, or cut.
- Do not narrate clicking. Narrate _why_.
- If the AI summary fails to generate on the take, keep going — the "AI not configured" state is
  a legitimate thing to show, and recovering from it on camera is better than a reshoot.
- Say "synthetic data" out loud at least once. Anyone from healthcare will be listening for it.
