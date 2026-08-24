import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { assertWebRuntimeEnv } from "./lib/runtime-env";

let registered = false;

export function register() {
  if (process.env.NEXT_RUNTIME !== "edge") assertWebRuntimeEnv();
  // Next invokes register in the server runtime. Keep the exporter opt-in so local development
  // remains quiet, and never initialize a tracer provider in an Edge/browser bundle.
  if (
    registered ||
    process.env.NEXT_RUNTIME === "edge" ||
    !process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  ) {
    return;
  }
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const url = endpoint.endsWith("/v1/traces")
    ? endpoint
    : `${endpoint.replace(/\/$/, "")}/v1/traces`;
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": process.env.OTEL_SERVICE_NAME ?? "pulse-web",
    }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url }))],
  });
  provider.register();
  registered = true;
}
