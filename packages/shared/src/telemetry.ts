import {
  context,
  propagation,
  SpanStatusCode,
  trace,
  type Span,
  type Attributes,
  type Context,
} from "@opentelemetry/api";

export interface TraceCarrier {
  traceparent?: string;
  tracestate?: string;
  [key: string]: unknown;
}

const tracer = trace.getTracer("pulse");

export function currentTraceId() {
  const spanContext = trace.getSpan(context.active())?.spanContext();
  return spanContext?.traceId && spanContext.traceId !== "00000000000000000000000000000000"
    ? spanContext.traceId
    : undefined;
}

export function injectTrace(carrier: TraceCarrier = {}) {
  propagation.inject(context.active(), carrier);
  return carrier;
}

export function extractTrace(carrier: TraceCarrier): Context {
  return propagation.extract(context.active(), carrier);
}

export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T> | T,
  parentContext = context.active(),
): Promise<T> {
  const span = tracer.startSpan(name, { attributes }, parentContext);
  return context.with(trace.setSpan(parentContext, span), async () => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
