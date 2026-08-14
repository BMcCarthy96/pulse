import http from "k6/http";
import { check } from "k6";
import { Rate, Trend } from "k6/metrics";
import crypto from "k6/crypto";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3010";
const VUS = Number(__ENV.VUS || 5);
const GUIDED_QUESTION = "What changed first, and which evidence proves it?";
const flowErrors = new Rate("recruiter_flow_errors");
const tenantProvisioning = new Trend("tenant_provisioning_ms");

export const options = {
  scenarios: {
    recruiter_flow: {
      executor: "per-vu-iterations",
      vus: VUS,
      iterations: 1,
      maxDuration: "2m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{flow:api_read}": ["p(95)<750"],
    recruiter_flow_errors: ["rate<0.01"],
    tenant_provisioning_ms: ["p(95)<3000"],
  },
};

function json(response) {
  try {
    return response.json();
  } catch {
    return {};
  }
}

function mark(response, checks) {
  const ok = check(response, checks);
  flowErrors.add(!ok);
  return ok;
}

function authSession() {
  const jar = http.cookieJar();
  const startedAt = Date.now();
  const csrfResponse = http.get(BASE_URL + "/api/auth/csrf", { jar });
  const csrf = json(csrfResponse).csrfToken;
  const callbackBody =
    "csrfToken=" +
    encodeURIComponent(csrf || "") +
    "&demo=1&redirect=false&json=true&callbackUrl=%2F";
  const callback = http.post(BASE_URL + "/api/auth/callback/demo", callbackBody, {
    jar,
    redirects: false,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const ok = mark(callback, {
    "demo tenant provisioned": (response) => response.status === 200 || response.status === 302,
  });
  tenantProvisioning.add(Date.now() - startedAt);
  return { jar, ok };
}

function signedWebhook(jar) {
  const url = __ENV.K6_WEBHOOK_URL;
  if (!url) return;
  const body =
    __ENV.K6_WEBHOOK_BODY ||
    JSON.stringify({ eventType: "lab.result.ready", resultCount: 1, synthetic: true });
  const delivery = "k6-" + __VU + "-" + __ITER;
  const headers = {
    "Content-Type": "application/json",
    "x-pulse-delivery": delivery,
    "x-pulse-event": "lab.result.ready",
    "x-pulse-source": "k6",
  };
  const secret = __ENV.K6_WEBHOOK_SECRET;
  if (secret) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    headers["x-pulse-timestamp"] = timestamp;
    headers["x-pulse-signature-v2"] = crypto.hmac("sha256", secret, timestamp + "." + body, "hex");
  } else if (__ENV.K6_WEBHOOK_SIGNATURE) {
    headers["x-pulse-signature"] = __ENV.K6_WEBHOOK_SIGNATURE;
  }

  const response = http.post(url, body, { jar, headers });
  mark(response, {
    "signed webhook accepted": (item) => [200, 202].includes(item.status),
  });
}

export default function () {
  const session = authSession();
  if (!session.ok) return;

  const overview = http.get(BASE_URL + "/api/v1/overview", {
    jar: session.jar,
    tags: { flow: "api_read" },
  });
  mark(overview, { "overview read": (response) => response.status === 200 });

  const incidentsResponse = http.get(BASE_URL + "/api/v1/incidents?limit=10", {
    jar: session.jar,
    tags: { flow: "api_read" },
  });
  if (!mark(incidentsResponse, { "incident list read": (response) => response.status === 200 }))
    return;

  const incidentId = json(incidentsResponse).data?.[0]?.id;
  if (!incidentId) {
    flowErrors.add(true);
    return;
  }

  const workspaceResponse = http.post(
    BASE_URL + "/api/v1/incidents/" + incidentId + "/investigations",
    null,
    { jar: session.jar },
  );
  if (
    !mark(workspaceResponse, {
      "investigation workspace created": (response) =>
        response.status === 200 || response.status === 201,
    })
  )
    return;

  const investigationId = json(workspaceResponse).investigation?.id;
  if (!investigationId) {
    flowErrors.add(true);
    return;
  }

  const stream = http.post(
    BASE_URL + "/api/v1/investigations/" + investigationId + "/ask",
    JSON.stringify({ question: GUIDED_QUESTION }),
    {
      jar: session.jar,
      timeout: "60s",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
    },
  );
  mark(stream, {
    "fixture SSE completed": (response) =>
      response.status === 200 && String(response.body || "").includes("run.completed"),
  });

  const detail = http.get(BASE_URL + "/api/v1/investigations/" + investigationId, {
    jar: session.jar,
    tags: { flow: "api_read" },
  });
  mark(detail, { "investigation telemetry read": (response) => response.status === 200 });

  signedWebhook(session.jar);

  // The optional approval call is useful against a disposable deployment when a recruiter wants
  // the complete proposal -> approval -> audit path in the load profile.
  if (__ENV.K6_APPROVE_ACTION === "true") {
    const proposed = json(detail).investigation?.actions?.find(
      (action) => action.status === "PROPOSED",
    );
    if (proposed) {
      const approval = http.post(
        BASE_URL +
          "/api/v1/investigations/" +
          investigationId +
          "/actions/" +
          proposed.id +
          "/approve",
        null,
        { jar: session.jar },
      );
      mark(approval, {
        "action approval completed": (response) => response.status === 200,
      });
    }
  }

  const reset = http.post(BASE_URL + "/api/demo/reset", null, { jar: session.jar });
  mark(reset, { "tenant cleanup reset accepted": (response) => response.status === 200 });
}
