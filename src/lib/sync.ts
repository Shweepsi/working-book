import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPut, SYNC_ENABLED } from './api';
import { save } from './storage';

// Sync layer: localStorage stays the source of truth for the rendered UI; the
// Worker is hydrated in the background and mutations are queued for replay.
// Conflict policy is last-write-wins per partition (whichever PUT lands last).

export type SyncDomain = 'logbook' | 'prodtest' | 'suivi';

export interface SyncRemote {
  domain: SyncDomain;
  params: Record<string, string>;
}

interface Mutation {
  id: string;
  path: string;
  payload: unknown;
  attempts: number;
}

const QUEUE_KEY = 'wb.sync.queue.v1';
const FLUSH_DEBOUNCE_MS = 400;
const RETRY_BACKOFF_MS = [2_000, 5_000, 15_000, 60_000];

let queue: Mutation[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let isFlushing = false;
let initialized = false;

function persistQueue(): void {
  save(QUEUE_KEY, queue);
}

function buildPath(remote: SyncRemote): string {
  const qs = new URLSearchParams(remote.params).toString();
  return `/api/${remote.domain}${qs ? `?${qs}` : ''}`;
}

function makeId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function scheduleFlush(): void {
  if (flushTimer || !SYNC_ENABLED) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    void flush();
  }, FLUSH_DEBOUNCE_MS);
}

function scheduleRetry(attempts: number): void {
  if (retryTimer) clearTimeout(retryTimer);
  const delay = RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)];
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    scheduleFlush();
  }, delay);
}

async function flush(): Promise<void> {
  if (!SYNC_ENABLED || isFlushing || queue.length === 0 || !isOnline()) return;
  isFlushing = true;
  try {
    while (queue.length > 0) {
      const m = queue[0];
      try {
        await apiPut(m.path, m.payload);
        queue.shift();
        persistQueue();
      } catch {
        m.attempts++;
        persistQueue();
        scheduleRetry(m.attempts);
        return;
      }
    }
  } finally {
    isFlushing = false;
  }
}

export function enqueueMutation(remote: SyncRemote, payload: unknown): void {
  if (!SYNC_ENABLED) return;
  const path = buildPath(remote);
  // Coalesce: a newer payload for the same partition supersedes any pending
  // mutation. Last-write-wins means we never need to replay intermediate states.
  const idx = queue.findIndex((m) => m.path === path);
  if (idx >= 0) {
    queue[idx] = { ...queue[idx], payload, attempts: 0 };
  } else {
    queue.push({ id: makeId(), path, payload, attempts: 0 });
  }
  persistQueue();
  scheduleFlush();
}

export function initSync(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  // Use the raw call so we keep the same import surface as `apiGet`/`apiPut`
  // and avoid a circular import with the storage helper.
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    queue = raw ? (JSON.parse(raw) as Mutation[]) : [];
  } catch {
    queue = [];
  }
  if (!SYNC_ENABLED) return;
  window.addEventListener('online', scheduleFlush);
  window.addEventListener('focus', scheduleFlush);
  if (queue.length > 0) scheduleFlush();
}

type Updater<T> = T | ((prev: T) => T);

// Drop-in replacement for the `useState(initFn) + useEffect(save)` pattern. The
// component owns the initial load (so it can do its own validation / legacy
// migration); this hook layers cache write-back and remote sync on top.
export function useSyncedState<T>(
  cacheKey: string,
  remote: SyncRemote | null,
  init: () => T,
): [T, (next: Updater<T>) => void] {
  const [value, setValueState] = useState<T>(init);
  const dirtyRef = useRef(false);
  const initRef = useRef(init);
  initRef.current = init;
  const remoteRef = useRef(remote);
  remoteRef.current = remote;

  useEffect(() => {
    setValueState(initRef.current());
    dirtyRef.current = false;
    const r = remoteRef.current;
    if (!r || !SYNC_ENABLED) return;
    let cancelled = false;
    apiGet<T>(buildPath(r))
      .then((envelope) => {
        if (cancelled || !envelope || envelope.data == null || dirtyRef.current) return;
        save(cacheKey, envelope.data);
        setValueState(envelope.data);
      })
      .catch(() => {
        // Offline or 5xx — local cache stays authoritative until next mount.
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey]);

  const setValue = useCallback(
    (next: Updater<T>) => {
      setValueState((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        dirtyRef.current = true;
        save(cacheKey, v);
        const r = remoteRef.current;
        if (r) enqueueMutation(r, v);
        return v;
      });
    },
    [cacheKey],
  );

  return [value, setValue];
}
