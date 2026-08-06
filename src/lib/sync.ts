import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { apiGet, apiPut, SYNC_ENABLED } from './api';
import { save } from './storage';

// Sync layer: localStorage stays the source of truth for the rendered UI; the
// Worker is hydrated in the background and mutations are queued for replay.
// Conflict policy is last-write-wins per partition (whichever PUT lands last).
// Partitions marked `live` also follow the Worker while the page is open — see
// the live-updates section further down.

export type SyncDomain = 'logbook' | 'prodtest' | 'suivi' | 'policy' | 'schedules' | 'speeds' | 'archives';

export interface SyncRemote {
  domain: SyncDomain;
  params: Record<string, string>;
}

// Every domain syncs. The PMS230 report was the last holdout behind a
// per-operator "local-only" toggle; that option is gone, so the only thing
// that can switch sync off is building without VITE_API_URL.
function isRemoteAllowed(): boolean {
  return SYNC_ENABLED;
}

// Keys written by features that no longer exist. Cleared on init so nothing
// lingers in localStorage with no UI left to clear it — the ingest token
// especially, which was a credential before the endpoint stopped asking for one.
const LEGACY_KEYS = [
  'wb.sync.mode', // the removed local-only sync toggle
  'wb.schedules.ingest.token',
  'wb.schedules.ingest.mode',
  // The coater speed used to be one local number shared by every schedule.
  // It now lives per schedule in the synced `speeds` partition.
  'wb.schedules.vitesse',
];

interface Mutation {
  id: string;
  path: string;
  payload: unknown;
  attempts: number;
}

export type SyncStatus =
  | 'idle'
  | 'syncing'
  | 'queued'
  | 'offline'
  | 'error'
  // No backend configured at build time — chip is hidden.
  | 'disabled';

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
  let status: SyncStatus;
  if (!SYNC_ENABLED) status = 'disabled';
  else if (isFlushing) status = 'syncing';
  else if (queue.length > 0 && !onlineState) status = 'offline';
  else if (queue.length > 0) {
    status = queue.some((m) => m.attempts > 0) ? 'error' : 'queued';
  } else if (!onlineState) status = 'offline';
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
        const stamp = await apiPut(m.path, m.payload);
        if (stamp !== null) selfWrites.set(m.path, stamp);
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

// `updated_at` the Worker returned for our own last write of a partition. One
// entry per path, so it stays as small as the number of partitions.
const selfWrites = new Map<string, number>();

// True while a write for this partition is still waiting to reach the Worker.
// A background refresh has to stand down in that window: our own value is the
// newer one, and adopting the remote would roll the operator's change back.
export function hasPendingMutation(remote: SyncRemote): boolean {
  const path = buildPath(remote);
  return queue.some((m) => m.path === path);
}

export function enqueueMutation(remote: SyncRemote, payload: unknown): void {
  if (!isRemoteAllowed()) return;
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
    for (const key of LEGACY_KEYS) window.localStorage.removeItem(key);
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

// ---------------------------------------------------------------------------
// Live updates
//
// Two devices are the normal case here — the planning room and the line — so a
// change made on one has to reach the other without anybody reloading. No
// socket: a socket on Cloudflare means a Durable Object, and this is one small
// request away from working. What the poller must not do is re-download the
// partitions themselves; the PMS230 report alone runs past a hundred kilobytes
// and changes a handful of times a shift. So it asks `/api/updates` for the
// `updated_at` of everything on screen — a couple of hundred bytes — and only
// fetches a partition whose stamp has actually moved.
// ---------------------------------------------------------------------------

const LIVE_POLL_MS = 15_000;
// A failing probe is the Worker being redeployed or the tablet losing wifi.
// Backing off keeps a dead endpoint from costing four requests a minute for
// the rest of the shift.
const LIVE_POLL_ERROR_MS = 60_000;

interface LiveProbe {
  remote: SyncRemote;
  // Called with the Worker's `updated_at` for this partition each round.
  onProbe: (updatedAt: number | null) => void;
}

const liveProbes = new Set<LiveProbe>();
let livePollTimer: ReturnType<typeof setTimeout> | undefined;
let livePollInFlight = false;
let liveListenersBound = false;

// A hidden tab polls nothing at all. A tablet left on the Schedule tab in a
// drawer shouldn't spend the shift talking to the Worker, and whatever it
// missed arrives in one round when it comes back out.
function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

function stopLivePoll(): void {
  if (livePollTimer) {
    clearTimeout(livePollTimer);
    livePollTimer = undefined;
  }
}

function scheduleLivePoll(delay = LIVE_POLL_MS): void {
  if (livePollTimer || !SYNC_ENABLED) return;
  if (liveProbes.size === 0 || !isVisible()) return;
  livePollTimer = setTimeout(() => {
    livePollTimer = undefined;
    void pollUpdates();
  }, delay);
}

// One request covers every live partition: their params are merged into a
// single query and the reply is keyed by domain. A domain whose probes
// disagree on params is left out rather than answered with someone else's
// timestamp — belt and braces, since the app mounts one page at a time.
function buildUpdatesPath(): { path: string; skip: Set<SyncDomain> } {
  const params = new URLSearchParams();
  const claimed = new Map<SyncDomain, string>();
  const skip = new Set<SyncDomain>();
  for (const probe of liveProbes) {
    const { domain, params: own } = probe.remote;
    const signature = JSON.stringify(own);
    const previous = claimed.get(domain);
    if (previous !== undefined) {
      if (previous !== signature) skip.add(domain);
      continue;
    }
    claimed.set(domain, signature);
    for (const [k, v] of Object.entries(own)) params.set(k, v);
  }
  const qs = params.toString();
  return { path: `/api/updates${qs ? `?${qs}` : ''}`, skip };
}

async function pollUpdates(): Promise<void> {
  if (livePollInFlight || liveProbes.size === 0 || !isVisible() || !isOnline()) {
    scheduleLivePoll();
    return;
  }
  livePollInFlight = true;
  const { path, skip } = buildUpdatesPath();
  try {
    const envelope = await apiGet<Record<string, number | null>>(path);
    const stamps = envelope?.data;
    if (!stamps) {
      // 404 from a Worker that predates this endpoint, or an empty body. Not
      // worth retrying at the fast cadence.
      scheduleLivePoll(LIVE_POLL_ERROR_MS);
      return;
    }
    for (const probe of liveProbes) {
      const { domain } = probe.remote;
      if (skip.has(domain)) continue;
      const stamp = stamps[domain];
      // `undefined` means the reply carries no news about this domain — the
      // params were missing or rejected. Only an explicit value counts.
      if (stamp === undefined) continue;
      probe.onProbe(stamp);
    }
    scheduleLivePoll();
  } catch {
    scheduleLivePoll(LIVE_POLL_ERROR_MS);
  } finally {
    livePollInFlight = false;
  }
}

function bindLiveListeners(): void {
  if (liveListenersBound || typeof window === 'undefined') return;
  liveListenersBound = true;
  document.addEventListener('visibilitychange', () => {
    stopLivePoll();
    // Back in the foreground: probe straight away instead of waiting out the
    // interval. This is the moment the operator actually looks at the screen.
    if (isVisible()) scheduleLivePoll(0);
  });
  // Same idea for a tablet that just found the network again.
  window.addEventListener('online', () => {
    stopLivePoll();
    scheduleLivePoll(0);
  });
}

function registerLiveProbe(probe: LiveProbe): () => void {
  liveProbes.add(probe);
  bindLiveListeners();
  scheduleLivePoll();
  return () => {
    liveProbes.delete(probe);
    if (liveProbes.size === 0) stopLivePoll();
  };
}

type Updater<T> = T | ((prev: T) => T);

export interface SyncedStateOptions {
  // Follow the partition while the page is open: poll the cheap `/api/updates`
  // probe and re-read this one when another device has written to it. Off by
  // default — a partition nothing else writes is served fine by the mount
  // fetch, and every live partition adds a key to the probe's reply.
  live?: boolean;
}

// Drop-in replacement for the `useState(initFn) + useEffect(save)` pattern. The
// component owns the initial load (so it can do its own validation / legacy
// migration); this hook layers cache write-back and remote sync on top.
export function useSyncedState<T>(
  cacheKey: string,
  remote: SyncRemote | null,
  init: () => T,
  options: SyncedStateOptions = {},
): [T, (next: Updater<T>) => void] {
  const [value, setValueState] = useState<T>(init);
  // Mirrors the rendered value so `setValue` can resolve a functional update
  // without running it inside the state updater — React invokes those during
  // the render phase, and ours has side effects (cache write, sync enqueue)
  // that reach the sync indicator's store. Kept in step both here, for the
  // fetch paths that assign directly, and eagerly in `setValue`, so two writes
  // in one event still chain off each other.
  const valueRef = useRef(value);
  valueRef.current = value;
  const dirtyRef = useRef(false);
  const initRef = useRef(init);
  initRef.current = init;
  const remoteRef = useRef(remote);
  remoteRef.current = remote;
  // `updated_at` of the version we are holding. The probe compares the Worker's
  // stamp against this one, and only a difference costs a full fetch.
  const lastSeenRef = useRef<number | null>(null);
  // Bumped whenever the partition changes or the component unmounts, so a
  // response that lands late can tell it is answering a question nobody asked
  // any more.
  const genRef = useRef(0);
  const { live = false } = options;

  // Read the partition and adopt it. `guardDirty` is for the mount fetch only:
  // an edit made while it was in flight has to win. Later reads don't need it —
  // `hasPendingMutation` is what tracks "our write hasn't landed yet", and
  // refusing the remote past that point would just pin a stale tab.
  const pull = useCallback(
    (guardDirty: boolean) => {
      const r = remoteRef.current;
      if (!r || !isRemoteAllowed()) return;
      const gen = genRef.current;
      apiGet<T>(buildPath(r))
        .then((envelope) => {
          if (gen !== genRef.current || !envelope) return;
          lastSeenRef.current = envelope.updated_at;
          if (envelope.data == null || (guardDirty && dirtyRef.current)) return;
          save(cacheKey, envelope.data);
          setValueState(envelope.data);
        })
        .catch(() => {
          // Offline or 5xx — the local cache stays authoritative, and the next
          // probe will pick the partition up again.
        });
    },
    [cacheKey],
  );

  useEffect(() => {
    setValueState(initRef.current());
    dirtyRef.current = false;
    lastSeenRef.current = null;
    pull(true);
    return () => {
      genRef.current++;
    };
  }, [cacheKey, pull]);

  useEffect(() => {
    if (!live) return;
    const r = remoteRef.current;
    if (!r || !isRemoteAllowed()) return;
    return registerLiveProbe({
      remote: r,
      onProbe: (updatedAt) => {
        // Nothing stored yet, or the version we already hold.
        if (updatedAt === null || updatedAt === lastSeenRef.current) return;
        // Our own write coming back. Adopting it would be correct but pointless
        // — we are the ones who wrote it — so just take note of the stamp.
        if (selfWrites.get(buildPath(r)) === updatedAt) {
          lastSeenRef.current = updatedAt;
          return;
        }
        // A write of ours is still queued: it is newer than whatever the
        // Worker holds, and adopting the remote would roll it back.
        if (hasPendingMutation(r)) return;
        pull(false);
      },
    });
  }, [cacheKey, live, pull]);

  const setValue = useCallback(
    (next: Updater<T>) => {
      const v = typeof next === 'function' ? (next as (p: T) => T)(valueRef.current) : next;
      valueRef.current = v;
      dirtyRef.current = true;
      save(cacheKey, v);
      const r = remoteRef.current;
      if (r) enqueueMutation(r, v);
      setValueState(v);
    },
    [cacheKey],
  );

  return [value, setValue];
}
