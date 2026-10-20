// ============================================================
// Typed fetch helpers for admin API route handlers
// ============================================================

// ---- server clock anchor --------------------------------
// Every response's `Date` header updates this offset so timers show
// SERVER time: a wrong PC clock can never freeze or inflate the live
// session timer (and the end-session bill matches the invoice).
let clockOffsetMs = 0;

/** Current time anchored to the server clock. */
export function serverNow(): Date {
  return new Date(Date.now() + clockOffsetMs);
}

export class ApiError extends Error {
  status: number;
  /** extra fields from the error response (e.g. `blockedBy`) */
  body: Record<string, unknown> | null;
  constructor(message: string, status: number, body?: Record<string, unknown> | null) {
    super(message);
    this.status = status;
    this.body = body ?? null;
  }
}

async function request<T>(url: string, method: string, body?: unknown): Promise<T> {
  const t0 = Date.now();
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const dateHeader = res.headers.get('date');
  if (dateHeader) {
    const serverMs = new Date(dateHeader).getTime();
    if (Number.isFinite(serverMs)) {
      // NTP-style midpoint correction for the round trip
      const half = (Date.now() - t0) / 2;
      clockOffsetMs = serverMs + half - (t0 + half);
    }
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new ApiError(data?.error || `Request failed (${res.status})`, res.status, data);
    // expose top-level extra fields (blockedBy, …) directly on the error
    if (data && typeof data === 'object') {
      for (const [k, v] of Object.entries(data)) {
        if (k !== 'error' && !(k in err)) {
          try {
            (err as any)[k] = v;
          } catch {
            /* read-only field — ignore */
          }
        }
      }
    }
    throw err;
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>(url, 'GET'),
  post: <T>(url: string, body?: unknown) => request<T>(url, 'POST', body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>(url, 'PATCH', body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>(url, 'PUT', body ?? {}),
  delete: <T>(url: string) => request<T>(url, 'DELETE'),
};
