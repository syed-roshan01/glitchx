// ============================================================
// Typed fetch helpers for admin API route handlers
// ============================================================

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
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
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
