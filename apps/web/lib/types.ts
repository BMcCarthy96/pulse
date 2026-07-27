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

export interface IncidentTimelineRow {
  id: string;
  kind: string;
  message: string;
  actor: string;
  createdAt: string;
}

export interface AiSummary {
  summary: string;
  probableCause: string;
  impact: string;
  suggestedSteps: string[];
  confidence?: string;
  model?: string;
  promptVersion?: string;
  generatedAt?: string;
  editedBy?: string;
  editedAt?: string;
  /** Present once edited: the machine-generated version, kept per doc 03 §6.6. */
  original?: Omit<AiSummary, "original">;
  /** Only set on the `failed` status. */
  error?: string;
}

export interface IncidentRow {
  id: string;
  status: string;
  severity: string;
  title: string;
  openedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  detectionSource: string;
  aiSummary: AiSummary | null;
  aiSummaryStatus: string;
  connector: { key: string; displayName: string; status: string };
}

export interface IncidentDetailResponse {
  incident: IncidentRow & {
    connector: { key: string; displayName: string; kind: string; status: string; chaosMode: string };
    timeline: IncidentTimelineRow[];
  };
  context: { failedJobs: number; errorLogs: number; windowEnd: string };
}

export interface UserRow {
  id: string;
  name: string | null;
  email: string;
  role: string;
  createdAt: string;
}

export interface AuditRow {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: unknown;
  createdAt: string;
  user: { name: string | null; email: string; role: string } | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  nextCursor: string | null;
  /** Only present when the request asked for it (`?withTotal=1`). */
  total?: number;
}
