/**
 * Bucketing for the connector health timeline.
 *
 * Split out from `components/health-strip.tsx` for the same reason `health/rules.ts` is split
 * from `health/engine.ts` in the worker: it is the part with logic worth pinning, and keeping it
 * free of JSX means the unit suite can import it without a React environment.
 */

/**
 * Worst-wins ordering. A bucket containing a single DOWN snapshot renders red even if the other
 * fifty-nine in it were healthy — an outage that averages away is worse than useless on a strip
 * whose whole job is making outages findable.
 */
const STATUS_RANK: Record<string, number> = { HEALTHY: 0, PAUSED: 1, DEGRADED: 2, DOWN: 3 };

/**
 * The strip renders a fixed number of buckets, not one segment per snapshot.
 *
 * Snapshot count is a function of `HEALTH_TICK_SEC`, so one segment each made the component's
 * width depend on the worker's tick rate: `gap-px` adds 1px of min-content width per segment,
 * and a flex container's automatic minimum size is its min-content width, so `w-full` could not
 * shrink it back. At the documented 60s tick that is 1,440 segments and 1,440px of gaps; at the
 * 15s tick used for local demos it was 5,756, which stretched every ancestor and pushed the
 * connector page to ~6,000px wide — a horizontal scrollbar across the dashboard, with the chaos
 * panel's radios 3,161px off-screen and unreachable.
 *
 * 96 buckets is 15-minute resolution across the 24h the API returns, and about 10px per segment
 * at the width this renders at.
 */
export const HEALTH_STRIP_MAX_SEGMENTS = 96;

export function bucketed(snapshots: { status: string }[], count: number): string[] {
  if (snapshots.length <= count) return snapshots.map((s) => s.status);

  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    // Proportional slicing rather than a fixed bucket size, so the final bucket cannot come up
    // short and no snapshot is dropped when the length does not divide evenly.
    const start = Math.floor((i * snapshots.length) / count);
    const end = Math.floor(((i + 1) * snapshots.length) / count);
    let worst = snapshots[start].status;
    for (let j = start + 1; j < end; j++) {
      const candidate = snapshots[j].status;
      if ((STATUS_RANK[candidate] ?? -1) > (STATUS_RANK[worst] ?? -1)) worst = candidate;
    }
    out.push(worst);
  }
  return out;
}
