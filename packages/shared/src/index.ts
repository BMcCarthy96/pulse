export const APP_NAME = "Pulse";

export * from "./connectors.js";
export * from "./queue-config.js";
export * from "./health-rules.js";
export * from "./incidents.js";
export * from "./chaos.js";
export * from "./roles.js";
export * from "./api-errors.js";
export * from "./schemas.js";
export * from "./prompts.js";
export * from "./personas.js";
export * from "./payloads.js";
export * from "./redis.js";
export * from "./tracked-jobs.js";

// NOTE: `./webhook-signature` is deliberately NOT re-exported here. It imports `node:crypto`,
// and this barrel is reachable from client components (the login page pulls in APP_NAME), so
// re-exporting it drags a Node builtin into the browser bundle and webpack fails the build with
// `UnhandledSchemeError: Reading from "node:crypto"`. Import it from its own subpath instead:
//   import { signWebhookBody } from "@pulse/shared/webhook-signature";
