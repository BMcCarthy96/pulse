const PLACEHOLDER_VALUES = new Set([
  "change-me-local-dev-secret",
  "change-me-local-dev-webhook-secret",
]);

function missingProductionValue(value: string | undefined) {
  const trimmed = value?.trim();
  return !trimmed || PLACEHOLDER_VALUES.has(trimmed);
}

function unsafeProductionSecret(value: string | undefined) {
  return missingProductionValue(value) || value!.trim().length < 32;
}

function localHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "0.0.0.0" ||
    normalized === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

function unsafeProductionUrl(
  value: string | undefined,
  options: { allowLocal: boolean; httpsOnly?: boolean } = { allowLocal: false },
) {
  if (missingProductionValue(value)) return true;
  try {
    const parsed = new URL(value!);
    if (!options.allowLocal && localHostname(parsed.hostname)) return true;
    if (!options.allowLocal && options.httpsOnly && parsed.protocol !== "https:") return true;
    return false;
  } catch {
    return true;
  }
}

/** Fail before queue workers start when a production process has unsafe connection settings. */
export function assertWorkerRuntimeEnv(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== "production") return;

  const allowLocal = env.PULSE_E2E === "true";
  const missing = ["WEBHOOK_SIGNING_SECRET"].filter((name) => unsafeProductionSecret(env[name]));
  for (const name of ["DATABASE_URL", "REDIS_URL"]) {
    if (unsafeProductionUrl(env[name], { allowLocal })) missing.push(name);
  }
  if (unsafeProductionUrl(env.WEBHOOK_TARGET_URL, { allowLocal, httpsOnly: true })) {
    missing.push("WEBHOOK_TARGET_URL");
  }
  if (missing.length > 0) {
    throw new Error(`Missing safe production environment values: ${missing.join(", ")}`);
  }
}
