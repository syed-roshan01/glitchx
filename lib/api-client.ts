// ============================================================
// Typed fetch helpers for admin API route handlers
// ============================================================

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
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
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
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
