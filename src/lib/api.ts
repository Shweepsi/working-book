// Thin fetch wrapper for the Cloudflare Worker API. The base URL is injected at
// build time via VITE_API_URL; when it's empty (no backend configured) the
// helpers turn into no-ops and the app falls back to localStorage-only mode.

const RAW = (import.meta.env.VITE_API_URL ?? '').trim();
export const API_BASE = RAW.replace(/\/+$/, '');
export const SYNC_ENABLED = API_BASE.length > 0;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

interface GetEnvelope<T> {
  data: T | null;
  updated_at: number | null;
}

export async function apiGet<T>(path: string): Promise<GetEnvelope<T> | null> {
  if (!SYNC_ENABLED) return null;
  const res = await fetch(API_BASE + path, { method: 'GET' });
  if (res.status === 404) return { data: null, updated_at: null };
  if (!res.ok) throw new ApiError(res.status, `GET ${path} failed (${res.status})`);
  return (await res.json()) as GetEnvelope<T>;
}

export async function apiPut(path: string, body: unknown): Promise<void> {
  if (!SYNC_ENABLED) return;
  const res = await fetch(API_BASE + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, `PUT ${path} failed (${res.status})`);
}
