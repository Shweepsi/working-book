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

// Resolves with the `updated_at` the Worker stamped on the row, when it says.
// The live poller uses it to recognise its own write coming back and skip the
// pointless re-fetch that would otherwise follow every save.
export async function apiPut(path: string, body: unknown): Promise<number | null> {
  if (!SYNC_ENABLED) return null;
  const res = await fetch(API_BASE + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, `PUT ${path} failed (${res.status})`);
  try {
    const ack = (await res.json()) as { updated_at?: unknown };
    return typeof ack?.updated_at === 'number' ? ack.updated_at : null;
  } catch {
    // A body we can't read doesn't make the write any less successful.
    return null;
  }
}

export async function apiDelete(path: string): Promise<void> {
  if (!SYNC_ENABLED) return;
  const res = await fetch(API_BASE + path, { method: 'DELETE' });
  if (!res.ok) throw new ApiError(res.status, `DELETE ${path} failed (${res.status})`);
}

// Sends a file as the raw request body. XHR rather than fetch: fetch says
// nothing until the last byte is out, and a logbook of several megabytes on
// the plant's network needs a bar that moves. The error carries the Worker's
// own code (`payload_too_large`, `storage_full`…), or `network_error` with
// status 0 when the request never got an answer at all.
export function apiUpload<T>(
  path: string,
  body: Blob,
  onProgress?: (loaded: number, total: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', API_BASE + path);
    xhr.setRequestHeader('Content-Type', body.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total);
    };
    xhr.onload = () => {
      let parsed: { error?: unknown } | null = null;
      try {
        parsed = JSON.parse(xhr.responseText) as { error?: unknown };
      } catch {
        // Not JSON — something between us and the Worker answered instead.
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(parsed as T);
      else {
        const code = typeof parsed?.error === 'string' ? parsed.error : `http_${xhr.status}`;
        reject(new ApiError(xhr.status, code));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'network_error'));
    xhr.send(body);
  });
}
