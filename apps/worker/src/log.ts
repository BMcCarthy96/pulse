import pino from "pino";

// DB sink (LogEntry table) is wired in once the Prisma schema exists (phase 1+).
// Never use console.log in worker code — import this facade instead.
export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } },
});
