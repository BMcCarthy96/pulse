export class RetryAfterError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "RetryAfterError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class AiRetryableError extends Error {
  readonly retryAfterMs?: number;
  readonly status?: number;
  readonly requestId?: string | null;

  constructor(
    message: string,
    opts: { retryAfterMs?: number; status?: number; requestId?: string | null } = {},
  ) {
    super(message);
    this.name = "AiRetryableError";
    this.retryAfterMs = opts.retryAfterMs;
    this.status = opts.status;
    this.requestId = opts.requestId;
  }
}
