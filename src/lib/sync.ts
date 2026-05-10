import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { apiGet, apiPut, SYNC_ENABLED } from './api';
import { save } from './storage';

// Sync layer: localStorage stays the source of truth for the rendered UI; the
// Worker is hydrated in the background and mutations are queued for replay.
// Conflict policy is last-write-wins per partition (whichever PUT lands last).

export type SyncDomain = 'logbook' | 'prodtest' | 'suivi' | 'policy' | 'schedules';

export interface SyncRemote {
  domain: SyncDomain;
  params: Record<string, string>;
  // Bypass the user's "local-only" preference. Default for shared data
  // (logbook, suivi, prodtest, policy). The PMS230 schedule report is the
  // only domain that still respects the toggle.
  alwaysSync?: boolean;
}

export type SyncMode = 'auto' | 'local';
const MODE_KEY = 'wb.sync.mode';

let syncMode: SyncMode = (() => {
  if (typeof window === 'undefined') return 'auto';
  const raw = window.localStorage.getItem(MODE_KEY);
  return raw === 'local' ? 'local' : 'auto';
})();

export function getSyncMode(): SyncMode {
  return syncMode;
}

export function setSyncMode(mode: SyncMode): void {
  if (mode === syncMode) return;
  syncMode = mode;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(MODE_KEY, mode);
  }
  emit();
  // Flush whatever queued during local-only the moment the user turns sync on
  // again — alwaysSync entries may have accumulated.
  if (mode === 'auto') scheduleFlush();
}

function isRemoteAllowed(remote: SyncRemote): boolean {
  if (!SYNC_ENABLED) return false;
  if (remote.alwaysSync) return true;
  return syncMode === 'auto';
}

interface Mutation {
  id: string;
  path: string;
  payload: unknown;
  attempts: number;
  alwaysSync?: boolean;
}

export type SyncStatus =
  | 'idle'
  | 'syncing'
  | 'queued'
  | 'offline'
  | 'error'
  // No backend configured at build time — chip is hidden.
  | 'disabled'
  // Backend is reachable but the user opted into local-only mode. Distinct
  // from 'disabled' so the chip can show "Local" to confirm the choice.
  | 'local';

export interface SyncSnapshot {
  status: SyncStatus;
  pending: number;
  online: boolean;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
}

const QUEUE_KEY = 'wb.sync.queue.v1';
const FLUSH_DEBOUNCE_MS = 400;
const RETRY_BACKOFF_MS = [2_000, 5_000, 15_000, 60_000];

let queue: Mutation[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let isFlushing = false;
let initialized = false;
let lastSuccessAt: number | null = null;
let lastErrorAt: number | null = null;
let onlineState: boolean = typeof navigator === 'undefined' ? true : navigator.onLine !== false;

const listeners = new Set<() => void>();
let cachedSnapshot: SyncSnapshot = computeSnapshot();

function computeSnapshot(): SyncSnapshot {
  // Active activity (syncing / queued / error / offline-with-pending) wins
  // over the static "Local" chip so the user always notices when alwaysSync
  // mutations are still in flight.
  let status: SyncStatus;
  if (!SYNC_ENABLED) status = 'disabled';
  else if (isFlushing) status = 'syncing';
  else if (queue.length > 0 && !onlineState) status = 'offline';
  else if (queue.length > 0) {
    status = queue.some((m) => m.attempts > 0) ? 'error' : 'queued';
  } else if (syncMode === 'local') status = 'local';
  else if (!onlineState) status = 'offline';
  else status = 'idle';
  return {
    status,
    pending: queue.length,
    online: onlineState,
    lastSuccessAt,
    lastErrorAt,
  };
}

function emit(): void {
  cachedSnapshot = computeSnapshot();
  listeners.forEach((l) => l());
}

function persistQueue(): void {
  save(QUEUE_KEY, queue);
  emit();
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
  emit();
  try {
    while (queue.length > 0) {
      const m = queue[0];
      try {
        await apiPut(m.path, m.payload);
        queue.shift();
        lastSuccessAt = Date.now();
        persistQueue();
      } catch {
        m.attempts++;
        lastErrorAt = Date.now();
        persistQueue();
        scheduleRetry(m.attempts);
        return;
      }
    }
  } finally {
    isFlushing = false;
    emit();
  }
}

export function enqueueMutation(remote: SyncRemote, payload: unknown): void {
  if (!isRemoteAllowed(remote)) return;
  const path = buildPath(remote);
  // Coalesce: a newer payload for the same partition supersedes any pending
  // mutation. Last-write-wins means we never need to replay intermediate states.
  const idx = queue.findIndex((m) => m.path === path);
  if (idx >= 0) {
    queue[idx] = { ...queue[idx], payload, attempts: 0, alwaysSync: !!remote.alwaysSync };
  } else {
    queue.push({ id: makeId(), path, payload, attempts: 0, alwaysSync: !!remote.alwaysSync });
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
  onlineState = navigator.onLine !== false;
  emit();
  if (!SYNC_ENABLED) return;
  const refreshOnline = () => {
    onlineState = navigator.onLine !== false;
    emit();
    scheduleFlush();
  };
  window.addEventListener('online', refreshOnline);
  window.addEventListener('offline', refreshOnline);
  window.addEventListener('focus', scheduleFlush);
  if (queue.length > 0) scheduleFlush();
}

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSyncSnapshot(): SyncSnapshot {
  return cachedSnapshot;
}

export function useSyncStatus(): SyncSnapshot {
  return useSyncExternalStore(subscribeSync, getSyncSnapshot, getSyncSnapshot);
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
    if (!r || !isRemoteAllowed(r)) return;
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
