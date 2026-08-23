import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";

let sdk: NodeSDK | null = null;

export function startTelemetry() {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  // Empty quoted values are common when optional env files are copied into a deployment. They
  // should disable tracing, not make the worker die before it can expose /readyz.
  if (!endpoint || endpoint === '""' || endpoint === "''") return;

  try {
    const url = endpoint.endsWith("/v1/traces")
      ? endpoint
      : `${endpoint.replace(/\/$/, "")}/v1/traces`;
    sdk = new NodeSDK({
      serviceName: process.env.OTEL_SERVICE_NAME ?? "pulse-worker",
      traceExporter: new OTLPTraceExporter({ url }),
    });
    sdk.start();
  } catch (error) {
    console.warn("[telemetry] disabled because OTLP endpoint is invalid:", error);
    sdk = null;
  }
}

export async function stopTelemetry() {
  await sdk?.shutdown();
}
