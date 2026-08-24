type RuntimeEnv = {
  PORT?: string;
  SIMULATOR_PORT?: string;
  SIMULATOR_BASE_URL?: string;
};

function stripWrappingQuotes(value: string) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function isLoopbackUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * The worker hosts the simulator in the same process. Railway supplies PORT for
 * the public health check, while local compose uses SIMULATOR_PORT. A stale or
 * quoted localhost URL must not win over Railway's assigned port.
 */
export function resolveSimulatorBaseUrl(env: RuntimeEnv = process.env) {
  const railwayPort = env.PORT?.trim();
  const port = railwayPort || env.SIMULATOR_PORT?.trim() || "4001";
  const configured = env.SIMULATOR_BASE_URL ? stripWrappingQuotes(env.SIMULATOR_BASE_URL) : "";

  if (railwayPort && (!configured || isLoopbackUrl(configured))) {
    return `http://127.0.0.1:${port}`;
  }

  return configured || `http://127.0.0.1:${port}`;
}
