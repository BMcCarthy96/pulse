import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";

let sdk: NodeSDK | null = null;

export function startTelemetry() {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;
  const url = endpoint.endsWith("/v1/traces")
    ? endpoint
    : `${endpoint.replace(/\/$/, "")}/v1/traces`;
  sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? "pulse-worker",
    traceExporter: new OTLPTraceExporter({ url }),
  });
  sdk.start();
}

export async function stopTelemetry() {
  await sdk?.shutdown();
}
