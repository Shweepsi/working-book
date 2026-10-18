// Keeps a shift's line records (lib/line.ts: colours, jumbos, racks, scraps)
// in step across devices, the way the shared workbooks' cells are
// (lib/sharedGrid.ts), with a record for a cell and no frame:
//   - every edit is a record written whole; the Worker numbers each write
//     (`seq`) and keeps the last one per record;
//   - a device asks for what came after the last `seq` it saw — every 2 s
//     while a tab shows the shift, 6 s once nobody typed for a minute, 30 s
//     when only the header's bilan button looks;
//   - its own writes wait in a queue kept on the device (sent on reconnect,
//     even for another shift), and a peer's write to a record of ours still
//     on its way waits for our acknowledgement, which says who was last;
//   - the last state of the shifts opened here is kept too, so they open
//     without network.
// One controller for the page (`lineSync`), following one shift: the header's.

import { useEffect, useSyncExternalStore } from 'react';
import { API_BASE, SYNC_ENABLED } from './api';
import { fieldsOf, toLineData, toRecord, type LineData, type LineKind, type LineRecord } from './line';
import type { Partition } from './sharedGrid';

export interface RecordWrite {
  id: string;
  kind: LineKind;
  /** The record's fields; null deletes it. */
  v: Record<string, unknown> | null;
}

interface StoredRecord extends RecordWrite {
  seq: number;
  client: string;
}

interface Page {
  seq: number;
  records: StoredRecord[];
  more?: boolean;
}

const POLL_MS = 2_000;
const POLL_IDLE_MS = 6_000;
const IDLE_AFTER_MS = 60_000;
const POLL_PASSIVE_MS = 30_000;
const POLL_ERROR_MS = 10_000;
const RETRY_MS = [2_000, 5_000, 15_000, 30_000];
// Under the Worker's 1 000 records a batch.
const CHUNK = 500;
// Shifts whose last state stays on the device for opening offline.
const MAX_SNAPSHOTS = 6;

const partKey = (p: Partition) => `${p.date}.${p.poste}`;
const OUTBOX = 'wb.line.outbox.';
const SNAPSHOT = 'wb.line.snap.';
const SNAPSHOTS = 'wb.line.snaps';
const query = (key: string, extra = '') => {
  const [date, poste] = key.split('.');
  return `date=${date}&poste=${poste}${extra}`;
};

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

// A refusal that sending again won't change (unlike a timeout or a rate limit).
const refused = (e: unknown) => e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or blocked storage only costs the offline safety net.
  }
}

// One id per page load: pending writes live in this page's memory.
const CLIENT = `l_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export type LineStatus = 'loading' | 'ready' | 'syncing' | 'offline' | 'error' | 'disabled';

export interface LineSnapshot {
  status: LineStatus;
  /** Writes not on the Worker yet, every shift together. */
  pending: number;
  error: string | null;
  /** The shift followed ("date.poste"), and whether its records are known. */
  part: string | null;
  loaded: boolean;
  /** Bumped whenever the followed shift's records change. */
  rev: number;
}

interface Follower {
  part: Partition;
  /** A tab shows it (as opposed to the header's button alone). */
  active: boolean;
}

class LineSync {
  private started = false;
  private followers = new Map<number, Follower>();
  private nextFollower = 1;
  // The shift followed and what it shows: the Worker's records up to
  // `cursor`, this device's unsent writes on top.
  private key: string | null = null;
  private loadToken = 0;
  private loaded = false;
  private records = new Map<string, RecordWrite>();
  private server = new Map<string, StoredRecord>();
  // Per record: Infinity while our write is unsent or in flight, then its seq.
  private own = new Map<string, number>();
  // Peer writes skipped because ours was in flight, until our ack says which one is last.
  private deferred = new Map<string, StoredRecord>();
  private cursor = 0;
  // Unsent writes by shift, oldest first.
  private outboxes = new Map<string, Map<string, RecordWrite>>();
  private inflight: { key: string; batch: RecordWrite[] } | null = null;
  private attempts = 0;
  private pollError: string | null = null;
  private sendError: string | null = null;
  private lastActivity = 0;
  private polling = false;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  private snap: LineSnapshot = { status: SYNC_ENABLED ? 'loading' : 'disabled', pending: 0, error: null, part: null, loaded: false, rev: 0 };
  private dataCache: { key: string; rev: number; data: LineData } | null = null;
  private focus: { part: string; id: string } | null = null;

  // --- React glue ------------------------------------------------------------

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = (): LineSnapshot => this.snap;

  private notify(changedRecords = false): void {
    const pending = [...this.outboxes.values()].reduce((n, o) => n + o.size, 0) + (this.inflight?.batch.length ?? 0);
    const status: LineStatus = !SYNC_ENABLED
      ? 'disabled'
      : this.inflight
        ? 'syncing'
        : !navigator.onLine
          ? 'offline'
          : this.sendError || this.pollError
            ? 'error'
            : !this.loaded
              ? 'loading'
              : pending
                ? 'syncing'
                : 'ready';
    this.snap = {
      status,
      pending,
      error: this.sendError ?? this.pollError,
      part: this.key,
      loaded: this.loaded,
      rev: this.snap.rev + (changedRecords ? 1 : 0),
    };
    this.listeners.forEach((l) => l());
  }

  /** The followed shift's records as lists; null when `p` isn't it or before they're known. */
  data(p: Partition): LineData | null {
    const key = partKey(p);
    if (key !== this.key || !this.loaded) return null;
    if (this.dataCache?.key === key && this.dataCache.rev === this.snap.rev) return this.dataCache.data;
    const records: LineRecord[] = [];
    for (const w of this.records.values()) {
      const r = w.v && toRecord(w.id, w.kind, w.v);
      if (r) records.push(r);
    }
    const data = toLineData(records);
    this.dataCache = { key, rev: this.snap.rev, data };
    return data;
  }

  // --- Following a shift -----------------------------------------------------

  private start(): void {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.schedulePoll(0);
      else clearTimeout(this.pollTimer);
    });
    window.addEventListener('online', () => {
      void this.flush();
      this.schedulePoll(0);
    });
    window.addEventListener('offline', () => this.notify());
    // Writes left from an earlier visit, whichever shift they're for.
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith(OUTBOX)) continue;
        const list = readStore<RecordWrite[]>(k, []);
        if (list.length) this.outboxes.set(k.slice(OUTBOX.length), new Map(list.map((w) => [w.id, w])));
      }
    } catch {
      // No storage: nothing was left.
    }
    void this.flush();
  }

  /** Follows `p` until the returned function is called; the last one asked for is the one followed. */
  follow(p: Partition, active: boolean): () => void {
    this.start();
    const id = this.nextFollower++;
    this.followers.set(id, { part: p, active });
    this.retarget();
    return () => {
      this.followers.delete(id);
      this.retarget();
    };
  }

  private wantedKey(): string | null {
    let last: Follower | undefined;
    for (const f of this.followers.values()) last = f;
    return last ? partKey(last.part) : null;
  }

  private isActive(): boolean {
    for (const f of this.followers.values()) if (f.active && partKey(f.part) === this.key) return true;
    return false;
  }

  private retarget(): void {
    const key = this.wantedKey();
    if (!key) {
      clearTimeout(this.pollTimer);
      return;
    }
    if (key !== this.key) this.open(key);
    else this.schedulePoll(this.isActive() ? 0 : POLL_PASSIVE_MS);
  }

  private open(key: string): void {
    this.key = key;
    this.loadToken++;
    clearTimeout(this.pollTimer);
    this.records = new Map();
    this.server = new Map();
    this.own = new Map();
    this.deferred = new Map();
    this.cursor = 0;
    this.pollError = null;
    // What this device last saw of it, to open without network.
    const saved = readStore<{ seq: number; records: StoredRecord[] } | null>(SNAPSHOT + key, null);
    if (saved) {
      for (const r of saved.records) {
        this.server.set(r.id, r);
        if (r.v) this.records.set(r.id, r);
      }
      this.cursor = saved.seq;
    }
    this.loaded = !!saved;
    // This device's writes still on their way go on top.
    const pending = [...(this.inflight?.key === key ? this.inflight.batch : []), ...(this.outboxes.get(key)?.values() ?? [])];
    for (const w of pending) {
      this.own.set(w.id, Infinity);
      this.show(w);
    }
    this.notify(true);
    void this.poll();
  }

  private show(w: RecordWrite): void {
    if (w.v) this.records.set(w.id, w);
    else this.records.delete(w.id);
  }

  // --- Receiving -------------------------------------------------------------

  private schedulePoll(ms: number): void {
    clearTimeout(this.pollTimer);
    if (!this.key || !this.wantedKey() || document.visibilityState === 'hidden') return;
    this.pollTimer = setTimeout(() => void this.poll(), ms);
  }

  private nextDelay(): number {
    if (this.pollError) return POLL_ERROR_MS;
    if (!this.isActive()) return POLL_PASSIVE_MS;
    return Date.now() - this.lastActivity > IDLE_AFTER_MS ? POLL_IDLE_MS : POLL_MS;
  }

  private async poll(): Promise<void> {
    const key = this.key;
    if (!key || this.polling || !SYNC_ENABLED) return;
    const token = this.loadToken;
    const current = () => token === this.loadToken;
    this.polling = true;
    let changed = false;
    try {
      for (;;) {
        const r = await fetch(`${API_BASE}/api/line/doc?${query(key, `&since=${this.cursor}`)}`);
        if (!r.ok) throw new HttpError(r.status);
        const page = (await r.json()) as Page;
        // Another shift was opened meanwhile: this reply is about the old one.
        if (!current()) break;
        for (const rec of page.records) {
          this.server.set(rec.id, rec);
          const mine = this.own.get(rec.id);
          if (mine === Infinity) {
            this.deferred.set(rec.id, rec);
            continue;
          }
          // Our own write coming back, or a peer's older than ours.
          if (mine !== undefined && mine >= rec.seq) continue;
          this.show(rec);
          changed = true;
        }
        this.cursor = Math.max(this.cursor, page.seq);
        if (!page.more) break;
      }
      if (current()) {
        if (changed) this.lastActivity = Date.now();
        if (changed || !this.loaded) this.saveSnapshot(key);
        this.loaded = true;
        this.pollError = null;
        this.notify(changed);
      }
    } catch (e) {
      if (current()) {
        this.pollError = navigator.onLine ? `lecture impossible (${String(e instanceof Error ? e.message : e)})` : null;
        this.notify();
      }
    }
    this.polling = false;
    // A shift opened meanwhile is read at once.
    this.schedulePoll(current() ? this.nextDelay() : 0);
  }

  private saveSnapshot(key: string): void {
    writeStore(SNAPSHOT + key, { seq: this.cursor, records: [...this.server.values()].filter((r) => r.v) });
    const keys = [key, ...readStore<string[]>(SNAPSHOTS, []).filter((k) => k !== key)];
    for (const old of keys.slice(MAX_SNAPSHOTS)) writeStore(SNAPSHOT + old, null);
    writeStore(SNAPSHOTS, keys.slice(0, MAX_SNAPSHOTS));
  }

  // --- Sending ---------------------------------------------------------------

  /** Writes records of `p` (shown at once here, then sent). */
  write(p: Partition, writes: RecordWrite[]): void {
    if (!writes.length) return;
    this.start();
    const key = partKey(p);
    const out = this.outboxes.get(key) ?? new Map<string, RecordWrite>();
    this.outboxes.set(key, out);
    for (const w of writes) {
      // A newer write of a record already queued replaces it, at the back.
      out.delete(w.id);
      out.set(w.id, w);
    }
    writeStore(OUTBOX + key, [...out.values()]);
    const shown = key === this.key;
    if (shown) {
      for (const w of writes) {
        this.own.set(w.id, Infinity);
        this.show(w);
      }
      // Someone is at work here: peers' writes matter again.
      if (Date.now() - this.lastActivity > IDLE_AFTER_MS) this.schedulePoll(POLL_MS);
      this.lastActivity = Date.now();
    }
    this.notify(shown);
    void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.inflight || !SYNC_ENABLED) return;
    if (!navigator.onLine) {
      this.notify();
      return;
    }
    // The shift on screen first.
    const key = this.key && this.outboxes.get(this.key)?.size ? this.key : [...this.outboxes].find(([, o]) => o.size)?.[0];
    if (!key) return;
    const out = this.outboxes.get(key) as Map<string, RecordWrite>;
    const batch: RecordWrite[] = [];
    for (const [id, w] of out) {
      batch.push(w);
      out.delete(id);
      if (batch.length >= CHUNK) break;
    }
    this.inflight = { key, batch };
    this.notify();
    let retry = false;
    let changed = false;
    try {
      const r = await fetch(`${API_BASE}/api/line/doc?${query(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client: CLIENT, records: batch }),
      });
      if (!r.ok) throw new HttpError(r.status);
      const { seqs } = (await r.json()) as { seqs: (number | null)[] };
      this.inflight = null;
      let skipped = 0;
      batch.forEach((w, i) => {
        const seq = seqs[i] ?? null;
        if (seq === null) skipped++;
        // Not on screen, or written again since (that newer write is still ours to send).
        if (key !== this.key || out.has(w.id)) return;
        if (seq === null) {
          changed = this.revert(w.id) || changed;
          return;
        }
        this.own.set(w.id, seq);
        const peer = this.deferred.get(w.id);
        if (peer) {
          this.deferred.delete(w.id);
          if (peer.seq > seq) {
            this.show(peer);
            changed = true;
          }
        }
      });
      this.sendError = skipped ? `${skipped} saisie${skipped > 1 ? 's' : ''} refusée${skipped > 1 ? 's' : ''} par le serveur` : null;
      this.attempts = 0;
    } catch (e) {
      this.inflight = null;
      if (refused(e)) {
        // Sending it again would be refused again and hold every later write
        // behind it: dropped, and this device shows the Worker's copy again.
        if (key === this.key) for (const w of batch) if (!out.has(w.id)) changed = this.revert(w.id) || changed;
        this.sendError = `${batch.length} saisie${batch.length > 1 ? 's' : ''} refusée${batch.length > 1 ? 's' : ''} par le serveur (${String(e)})`;
      } else {
        // Back to the front, unless written again meanwhile.
        const front = new Map<string, RecordWrite>();
        for (const w of batch) if (!out.has(w.id)) front.set(w.id, w);
        this.outboxes.set(key, new Map([...front, ...out]));
        this.attempts++;
        retry = true;
        this.sendError = navigator.onLine ? `envoi impossible (${String(e instanceof Error ? e.message : e)})` : null;
      }
    }
    const left = this.outboxes.get(key);
    writeStore(OUTBOX + key, left?.size ? [...left.values()] : null);
    if (!left?.size) this.outboxes.delete(key);
    this.notify(changed);
    if (retry) {
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => void this.flush(), RETRY_MS[Math.min(this.attempts - 1, RETRY_MS.length - 1)]);
    } else if ([...this.outboxes.values()].some((o) => o.size)) {
      void this.flush();
    }
  }

  /** A write of ours that won't be stored: the record shows as the Worker has it. */
  private revert(id: string): boolean {
    this.own.delete(id);
    this.deferred.delete(id);
    const stored = this.server.get(id);
    if (stored?.v) this.records.set(id, stored);
    else this.records.delete(id);
    return true;
  }

  // --- Pointing at a record --------------------------------------------------

  /** Asks the tab showing `id` to bring it into view (from the bilan). */
  requestFocus(p: Partition, id: string): void {
    this.focus = { part: partKey(p), id };
    this.notify();
  }

  /** The record asked for with `requestFocus` for `p`, once. */
  takeFocus(p: Partition): string | null {
    if (this.focus?.part !== partKey(p) || !this.data(p)) return null;
    const { id } = this.focus;
    this.focus = null;
    return id;
  }
}

/** The page's one controller for the line's records. */
export const lineSync = new LineSync();

export function useLineSnapshot(): LineSnapshot {
  return useSyncExternalStore(lineSync.subscribe, lineSync.getSnapshot);
}

/**
 * `part`'s records, followed: polled every 2 s while `active` (a tab or the
 * bilan shows them), every 30 s otherwise. Null before they're known.
 */
export function useLine(part: Partition | null, active: boolean): LineData | null {
  useSyncExternalStore(lineSync.subscribe, lineSync.getSnapshot);
  const date = part?.date;
  const poste = part?.poste;
  useEffect(() => {
    if (!date || !poste) return;
    return lineSync.follow({ date, poste }, active);
  }, [date, poste, active]);
  return part ? lineSync.data(part) : null;
}

/** Writes a record of `p` as it now stands. */
export const putRecord = (p: Partition, r: LineRecord) => lineSync.write(p, [{ id: r.id, kind: r.kind, v: fieldsOf(r) }]);

/** Writes several records of `p` at once. */
export const putRecords = (p: Partition, rs: LineRecord[]) => lineSync.write(p, rs.map((r) => ({ id: r.id, kind: r.kind, v: fieldsOf(r) })));

/** Deletes records of `p`. */
export const deleteRecords = (p: Partition, rs: LineRecord[]) => lineSync.write(p, rs.map((r) => ({ id: r.id, kind: r.kind, v: null })));

/** A shift's records as stored, read once (the day's other shifts); empty for a shift nothing was typed in. */
export async function readLine(date: string, poste: string): Promise<LineData> {
  const records: LineRecord[] = [];
  const byId = new Map<string, StoredRecord>();
  let since = 0;
  for (;;) {
    const r = await fetch(`${API_BASE}/api/line/doc?date=${date}&poste=${poste}&since=${since}`);
    if (!r.ok) throw new Error(`le serveur a répondu ${r.status}`);
    const page = (await r.json()) as Page;
    for (const rec of page.records) byId.set(rec.id, rec);
    since = page.seq;
    if (!page.more) break;
  }
  for (const rec of byId.values()) {
    const r = rec.v && toRecord(rec.id, rec.kind, rec.v);
    if (r) records.push(r);
  }
  return toLineData(records);
}
