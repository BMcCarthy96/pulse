export interface OverviewConnector {
  key: string;
  displayName: string;
  kind: string;
  status: string;
  paused: boolean;
  errorRate: number;
  lastActivity: string | null;
  openIncidentId: string | null;
}

export interface OverviewIncident {
  id: string;
  title: string;
  severity: string;
  status: string;
  connectorKey: string;
  connectorDisplayName: string;
  openedAt: string;
  resolvedAt: string | null;
}

export interface OverviewResponse {
  connectors: OverviewConnector[];
  totals: { deadJobs: number; openIncidents: number; eventsLastHour: number; jobsLastHour: number };
  recentIncidents: OverviewIncident[];
}

export interface ConnectorRow {
  id: string;
  key: string;
  displayName: string;
  description: string;
  kind: string;
  status: string;
  paused: boolean;
  chaosMode: string;
  chaosConfig: { failureRate?: number; latencyMs?: number };
  syncIntervalSec: number | null;
  sparkline: { errorRate: number; status: string; createdAt: string }[];
}

export interface SyncRunRow {
  id: string;
  status: string;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  recordsFetched: number;
  recordsFailed: number;
  error: string | null;
}

export interface HealthSnapshotRow {
  id: string;
  status: string;
  errorRate: number;
  p95LatencyMs: number | null;
  totalCalls: number;
  failedCalls: number;
  windowStart: string;
  windowEnd: string;
}

export interface ConnectorDetailResponse {
  connector: ConnectorRow;
  recentRuns: SyncRunRow[];
  snapshots: HealthSnapshotRow[];
  openIncident: { id: string; status: string; severity: string } | null;
}

export interface JobRow {
  id: string;
  queue: string;
  type: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  payload: unknown;
  lastError: string | null;
  errorHistory: { attempt: number; at: string; message: string; durationMs?: number }[];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  connector: { key: string; displayName: string };
}

export interface EventRow {
  id: string;
  direction: string;
  eventType: string;
  dedupeKey: string | null;
  status: string;
  payload: unknown;
  headers: unknown;
  error: string | null;
  receivedAt: string;
  processedAt: string | null;
  connector: { key: string; displayName: string };
}

export interface LogRow {
  id: string;
  level: string;
  source: string;
  message: string;
  context: unknown;
  createdAt: string;
  connector: { key: string; displayName: string } | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  nextCursor: string | null;
  /** Only present when the request asked for it (`?withTotal=1`). */
  total?: number;
}
