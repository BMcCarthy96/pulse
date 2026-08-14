-- Add durable latency telemetry to logical AI runs.
ALTER TABLE "AiRun" ADD COLUMN "latencyMs" INTEGER;
