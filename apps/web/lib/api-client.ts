export class ApiClientError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      const isDemoSession = document.querySelector('[data-demo-session="true"]');
      const returnPath = `${window.location.pathname}${window.location.search}`;
      const destination = isDemoSession
        ? "/demo?expired=1"
        : `/login?expired=1&callbackUrl=${encodeURIComponent(returnPath)}`;
      if (window.location.pathname !== "/login" && window.location.pathname !== "/demo") {
        window.location.replace(destination);
      }
    }
    const body = await res.json().catch(() => null);
    throw new ApiClientError(
      body?.error?.message ?? res.statusText,
      body?.error?.code ?? "INTERNAL",
      res.status,
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined });
}
