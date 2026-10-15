// Keeps one shift's GridCraft workbook in step across devices.
//
// GridCraft (the `shared-cells` build, see scripts/fetch-gridcraft.sh) runs in
// an iframe and talks over postMessage: it reports every edit as the cells it
// changed (`gridcraft:changes`) and applies other devices' cells
// (`gridcraft:apply`). This controller is the other half: it opens the shift's
// template in the frame, replays the cells stored for the shift on top, sends
// local edits to the Worker and polls it for everyone else's.
//
// Conflicts are per cell, last write wins in the Worker's order (`seq`). Two
// tablets editing different cells never collide. For the same cell, a device
// skips a peer's write while its own write to that cell is still on the way or
// was stamped later, and adopts it otherwise — so every device ends on the
// value the Worker kept.
//
// One controller for the page (`sharedGrid`): leaving the tab unmounts the
// frame but not the edits still on their way.

import { API_BASE, SYNC_ENABLED } from './api';

export interface Partition {
  date: string;
  poste: string;
}

export interface CellChange {
  sheet: string;
  cell: string;
  c: unknown;
}

interface StoredChange extends CellChange {
  seq: number;
  client: string;
}

interface DocPage {
  template_id: number | null;
  seq: number;
  changes: StoredChange[];
  more?: boolean;
}

export type GridTheme = 'light' | 'dark' | 'system';

export type GridStatus = 'loading' | 'no-template' | 'ready' | 'syncing' | 'offline' | 'error' | 'disabled';

export interface GridSnapshot {
  status: GridStatus;
  pending: number;
  templateId: number | null;
  error: string | null;
}

const POLL_MS = 2_000;
// Nobody has edited for a while: look less often. A peer's edit then shows
// within this, and the first edit on either side brings the pace back.
const POLL_IDLE_MS = 6_000;
const IDLE_AFTER_MS = 60_000;
const POLL_ERROR_MS = 10_000;
const RETRY_MS = [2_000, 5_000, 15_000, 30_000];
// The Worker refuses bigger batches (5 000 changes, 4 Mo); a sort or a fill
// is split.
const CHUNK = 4_000;
const CHUNK_BYTES = 1_000_000;

const keyOf = (c: CellChange) => `${c.sheet}!${c.cell}`;
const partKey = (p: Partition) => `${p.date}.${p.poste}`;
const outboxKey = (p: Partition) => `wb.grid.outbox.${partKey(p)}`;
const qs = (p: Partition, extra = '') => `date=${p.date}&poste=${p.poste}${extra}`;
const sameEdit = (a: CellChange, b: CellChange) => keyOf(a) === keyOf(b) && JSON.stringify(a.c) === JSON.stringify(b.c);

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

// A refusal that sending again won't change (unlike a timeout or a rate limit).
const refused = (e: unknown) => e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;

function loadOutbox(p: Partition): CellChange[] {
  try {
    const raw = localStorage.getItem(outboxKey(p));
    return raw ? (JSON.parse(raw) as CellChange[]) : [];
  } catch {
    return [];
  }
}

function saveOutbox(p: Partition, changes: CellChange[]): void {
  try {
    if (changes.length) localStorage.setItem(outboxKey(p), JSON.stringify(changes));
    else localStorage.removeItem(outboxKey(p));
  } catch {
    // A full or blocked storage only costs the offline safety net.
  }
}

/** Drops `sent` from a shift's stored queue, edit by edit: a newer edit of
 * the same cell queued after them stays. */
function forgetSent(p: Partition, sent: CellChange[]): void {
  const left = [...sent];
  saveOutbox(
    p,
    loadOutbox(p).filter((ch) => {
      const i = left.findIndex((s) => sameEdit(s, ch));
      if (i < 0) return true;
      left.splice(i, 1);
      return false;
    }),
  );
}

// The shift last opened here as the Worker had it, so that it still opens
// without network. One shift per device: the one in use.
const SNAPSHOT_KEY = 'wb.grid.snapshot';

interface Snapshot {
  part: string;
  templateId: number;
  seq: number;
  cells: CellChange[];
}

function loadSnapshot(p: Partition): Snapshot | null {
  try {
    const s = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? 'null') as Snapshot | null;
    return s && s.part === partKey(p) ? s : null;
  } catch {
    return null;
  }
}

function saveSnapshot(s: Snapshot): void {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(s));
  } catch {
    // Same as the outbox: only the offline opening is lost.
  }
}

// One id per page load: pending writes live in this page's memory.
const CLIENT = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

class SharedGrid {
  private frame: HTMLIFrameElement | null = null;
  private frameReady = false;
  private connected = false;
  // The shift asked for, and the one the frame is showing (they differ while
  // a switch is under way: edits still arriving belong to the old one).
  private wanted: Partition | null = null;
  private shown: Partition | null = null;
  // Bumped by every load: replies to requests made before it are stale.
  private loadToken = 0;
  private initial: CellChange[] = [];
  private cursor = 0;
  // The shown shift's cells as the Worker has them up to `cursor`.
  private server = new Map<string, CellChange>();
  private openedOffline = false;
  private pollFailed = false;
  // Per cell: Infinity while our write is unsent or in flight, then its seq.
  private own = new Map<string, number>();
  // Peer writes skipped because ours was in flight, kept until our ack says
  // which one the Worker ordered last.
  private deferred = new Map<string, StoredChange>();
  // Unsent edits by cell, oldest first.
  private outbox = new Map<string, CellChange>();
  private inflight: CellChange[] = [];
  private flushing = false;
  private attempts = 0;
  private loadAttempts = 0;
  private lastActivity = 0;
  private pollDelay = POLL_MS;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private loadTimer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  private snap: GridSnapshot = { status: SYNC_ENABLED ? 'loading' : 'disabled', pending: 0, templateId: null, error: null };
  private fileName = 'classeur.xlsx';
  private theme: GridTheme = 'system';

  /** Starts listening; paired with `dispose` (both safe to repeat, as React's
   * StrictMode runs effects twice in development). */
  connect(): void {
    if (this.connected) return;
    this.connected = true;
    window.addEventListener('message', this.onMessage);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('online', this.onOnline);
    // Back on the tab after a shift failed to open: try it again.
    if (this.wanted && !this.pendingOpen && this.snap.status !== 'loading' && (!this.shown || partKey(this.shown) !== partKey(this.wanted))) {
      void this.load(this.wanted);
    } else if (this.shown && !this.pendingOpen) this.schedulePoll(0);
  }

  /** Stops polling and listening. Edits already queued keep going to the
   * Worker: they are this device's, whichever tab is showing. */
  dispose(): void {
    if (!this.connected) return;
    this.connected = false;
    window.removeEventListener('message', this.onMessage);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('online', this.onOnline);
    clearTimeout(this.pollTimer);
    clearTimeout(this.loadTimer);
    if (this.shown) saveOutbox(this.shown, this.pendingEdits());
  }

  // --- React glue ------------------------------------------------------------

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = (): GridSnapshot => this.snap;

  private set(patch: Partial<GridSnapshot>): void {
    this.snap = { ...this.snap, ...patch, pending: this.outbox.size + this.inflight.length };
    this.listeners.forEach((l) => l());
  }

  attach(frame: HTMLIFrameElement | null): void {
    if (frame === this.frame) return;
    this.frame = frame;
    this.frameReady = false;
  }

  private pendingEdits(): CellChange[] {
    return [...this.inflight, ...this.outbox.values()];
  }

  // --- Opening a shift -------------------------------------------------------

  open(p: Partition | null, fileName: string): void {
    this.fileName = fileName;
    if (p && this.wanted && partKey(p) === partKey(this.wanted)) return;
    this.wanted = p;
    this.loadAttempts = 0;
    if (p) void this.load(p);
  }

  private async load(p: Partition): Promise<void> {
    if (!SYNC_ENABLED) return;
    const token = ++this.loadToken;
    clearTimeout(this.pollTimer);
    clearTimeout(this.loadTimer);
    this.set({ status: 'loading', error: null });
    let templateId: number | null = null;
    let since = 0;
    const cells = new Map<string, CellChange>();
    try {
      // Everything stored for the shift, page by page.
      for (;;) {
        const r = await fetch(`${API_BASE}/api/grid/doc?${qs(p, `&since=${since}`)}`);
        if (!r.ok) throw new HttpError(r.status);
        const page = (await r.json()) as DocPage;
        templateId = page.template_id;
        for (const ch of page.changes) cells.set(keyOf(ch), { sheet: ch.sheet, cell: ch.cell, c: ch.c });
        since = page.seq;
        if (!page.more) break;
      }
      if (token !== this.loadToken) return;
      if (templateId === null) {
        this.set({ status: 'no-template', templateId: null });
        return;
      }
      this.openedOffline = false;
    } catch (e) {
      if (token !== this.loadToken) return;
      // No Worker: open what this device last saw of the shift, if anything.
      const saved = loadSnapshot(p);
      if (!saved) {
        this.loadFailed(p, e);
        return;
      }
      templateId = saved.templateId;
      since = saved.seq;
      for (const ch of saved.cells) cells.set(keyOf(ch), ch);
      this.openedOffline = true;
    }
    try {
      // Immutable per id: the service worker and the HTTP cache keep it.
      const t = await fetch(`${API_BASE}/api/grid/template?id=${templateId}`);
      if (!t.ok) throw new HttpError(t.status);
      const bytes = await t.arrayBuffer();
      if (token !== this.loadToken) return;
      this.loadAttempts = 0;
      this.cursor = since;
      this.server = cells;
      if (!this.openedOffline) saveSnapshot({ part: partKey(p), templateId, seq: since, cells: [...cells.values()] });
      this.initial = [...cells.values()];
      this.set({ templateId });
      this.pendingOpen = { p, bytes };
      this.sendOpen();
    } catch (e) {
      if (token === this.loadToken) this.loadFailed(p, e);
    }
  }

  /** Says why the shift didn't open, and tries again: by itself after a
   * while, and as soon as the network is back. */
  private loadFailed(p: Partition, e: unknown): void {
    this.set({ status: navigator.onLine ? 'error' : 'offline', error: String(e) });
    clearTimeout(this.loadTimer);
    if (!this.connected) return;
    const delay = RETRY_MS[Math.min(this.loadAttempts++, RETRY_MS.length - 1)];
    this.loadTimer = setTimeout(() => {
      if (this.wanted && partKey(this.wanted) === partKey(p)) void this.load(p);
    }, delay);
  }

  private pendingOpen: { p: Partition; bytes: ArrayBuffer } | null = null;

  private sendOpen(): void {
    if (!this.frameReady || !this.pendingOpen) return;
    // A copy goes to the frame: if GridCraft restarts before it opened, the
    // template is sent again.
    const bytes = this.pendingOpen.bytes.slice(0);
    this.post({ type: 'gridcraft:open', name: this.fileName, bytes, shared: true }, [bytes]);
  }

  private onOpened(): void {
    const next = this.pendingOpen?.p;
    this.pendingOpen = null;
    if (!next) return;
    const sameShift = !!this.shown && partKey(this.shown) === partKey(next);
    // Whatever the previous shift still had to send stays on this device; a
    // batch of it still in flight is settled by `flush`.
    if (this.shown && !sameShift) {
      saveOutbox(this.shown, this.pendingEdits());
      this.inflight = [];
    }
    this.shown = next;
    this.own.clear();
    this.deferred.clear();
    // Edits made here while offline (or before a reload) go on top of what
    // the Worker has, and then on their way. Reopening the same shift with a
    // batch in flight: that batch is already on its way.
    const stored = loadOutbox(next);
    const inflight = sameShift ? [...this.inflight] : [];
    this.outbox = new Map();
    for (const ch of stored) {
      const i = inflight.findIndex((s) => sameEdit(s, ch));
      if (i >= 0) inflight.splice(i, 1);
      else this.outbox.set(keyOf(ch), ch);
    }
    for (const k of [...this.outbox.keys(), ...this.inflight.map(keyOf)]) this.own.set(k, Infinity);
    const pending = this.pendingEdits();
    const pendingKeys = new Set(pending.map(keyOf));
    const base = this.initial.filter((ch) => !pendingKeys.has(keyOf(ch)));
    this.initial = [];
    this.apply([...base, ...pending]);
    this.lastActivity = Date.now();
    this.set({ status: this.openedOffline ? 'offline' : 'ready', error: null });
    // Without focus, the first tap in the frame only focuses it and the edit
    // the operator meant is lost.
    // eframe listens on its canvas, so that's what takes focus (same origin).
    this.frame?.focus();
    this.frame?.contentWindow?.focus();
    this.frame?.contentDocument?.querySelector('canvas')?.focus();
    void this.flush();
    this.schedulePoll(this.openedOffline ? 0 : POLL_MS);
  }

  // --- Frame messages --------------------------------------------------------

  /** The page's theme for GridCraft to follow (`light`, `dark` or `system`). */
  setTheme(mode: GridTheme): void {
    if (mode === this.theme) return;
    this.theme = mode;
    if (this.frameReady) this.post({ type: 'gridcraft:theme', mode });
  }

  private post(msg: unknown, transfer: Transferable[] = []): void {
    this.frame?.contentWindow?.postMessage(msg, window.location.origin, transfer);
  }

  private apply(changes: CellChange[]): void {
    if (changes.length) this.post({ type: 'gridcraft:apply', changes });
  }

  private onMessage = (e: MessageEvent): void => {
    if (e.origin !== window.location.origin || !this.frame || e.source !== this.frame.contentWindow) return;
    const data = e.data as { type?: string; changes?: CellChange[]; name?: string; bytes?: ArrayBuffer; error?: string };
    switch (data?.type) {
      case 'gridcraft:ready':
        this.frameReady = true;
        // The frame took its theme from its URL, which may have changed since.
        this.post({ type: 'gridcraft:theme', mode: this.theme });
        if (this.pendingOpen) this.sendOpen();
        else if (this.shown) {
          // The frame (re)started under an open shift: show it again.
          const p = this.shown;
          this.wanted = null;
          this.open(p, this.fileName);
        }
        break;
      case 'gridcraft:opened':
        this.onOpened();
        break;
      case 'gridcraft:changes':
        if (this.shown && Array.isArray(data.changes)) this.queue(data.changes);
        break;
      case 'gridcraft:save':
        if (data.bytes) download(data.name ?? this.fileName, data.bytes);
        break;
      case 'gridcraft:failed':
        this.set({ status: 'error', error: data.error ?? 'GridCraft n’a pas démarré' });
        break;
    }
  };

  // --- Sending ---------------------------------------------------------------

  private queue(changes: CellChange[]): void {
    for (const ch of changes) {
      const k = keyOf(ch);
      this.own.set(k, Infinity);
      // A newer edit of a cell already queued replaces it, at the back.
      this.outbox.delete(k);
      this.outbox.set(k, ch);
    }
    if (this.shown) saveOutbox(this.shown, this.pendingEdits());
    this.lastActivity = Date.now();
    // Someone is at work here: peers' edits matter again.
    if (this.pollDelay > POLL_MS) this.schedulePoll(POLL_MS);
    this.set({});
    void this.flush();
  }

  /** The next batch: whole cells, under the Worker's count and size limits. */
  private takeBatch(): CellChange[] {
    const batch: CellChange[] = [];
    let bytes = 0;
    for (const [k, ch] of this.outbox) {
      const size = JSON.stringify(ch).length;
      if (batch.length && (batch.length >= CHUNK || bytes + size > CHUNK_BYTES)) break;
      batch.push(ch);
      bytes += size;
      this.outbox.delete(k);
    }
    return batch;
  }

  private async flush(): Promise<void> {
    const p = this.shown;
    if (!p || this.flushing || this.outbox.size === 0 || !navigator.onLine) {
      if (!navigator.onLine && this.outbox.size) this.set({ status: 'offline' });
      return;
    }
    this.flushing = true;
    const batch = this.takeBatch();
    this.inflight = batch;
    this.set({ status: 'syncing' });
    const stillShown = () => !!this.shown && partKey(this.shown) === partKey(p);
    let retry = false;
    try {
      const r = await fetch(`${API_BASE}/api/grid/doc?${qs(p)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client: CLIENT, changes: batch }),
      });
      if (!r.ok) throw new HttpError(r.status);
      const { seqs } = (await r.json()) as { seqs: (number | null)[] };
      if (stillShown()) {
        this.inflight = [];
        const adopt: CellChange[] = [];
        let skipped = 0;
        batch.forEach((ch, i) => {
          const k = keyOf(ch);
          const seq = seqs[i];
          if (seq === null || seq === undefined) skipped++;
          // Edited again since: that newer write is still ours to send.
          if (this.outbox.has(k)) return;
          // A cell the Worker refused is no longer ours: the next peer write wins.
          this.own.set(k, seq ?? 0);
          const peer = this.deferred.get(k);
          if (peer) {
            this.deferred.delete(k);
            if (peer.seq > (seq ?? 0)) adopt.push(peer);
          }
        });
        this.apply(adopt);
        saveOutbox(p, this.pendingEdits());
        this.set(skipped ? { status: 'error', error: `${skipped} cellule(s) refusée(s) par le serveur` } : { status: 'ready', error: null });
      } else {
        // The frame moved to another shift meanwhile; that shift's stored
        // queue still lists these edits, which are now on the Worker.
        forgetSent(p, batch);
        this.set({ status: 'ready', error: null });
      }
      this.attempts = 0;
    } catch (e) {
      const dropped = refused(e);
      if (stillShown()) {
        this.inflight = [];
        if (dropped) {
          // Sending this batch again would be refused again, and hold every
          // later edit behind it: it stays on this device only.
          for (const ch of batch) {
            const k = keyOf(ch);
            if (this.outbox.has(k)) continue;
            this.own.delete(k);
            const peer = this.deferred.get(k);
            if (peer) {
              this.deferred.delete(k);
              this.apply([peer]);
            }
          }
          saveOutbox(p, this.pendingEdits());
        } else {
          // Back to the front, unless the cell was edited again meanwhile.
          const front = new Map<string, CellChange>();
          for (const ch of batch) if (!this.outbox.has(keyOf(ch))) front.set(keyOf(ch), ch);
          this.outbox = new Map([...front, ...this.outbox]);
        }
      } else if (dropped) {
        forgetSent(p, batch);
      }
      if (dropped) {
        this.attempts = 0;
        this.set({ status: 'error', error: `${batch.length} cellule(s) refusée(s) par le serveur (${String(e)})` });
      } else {
        this.attempts++;
        retry = true;
        this.set({ status: navigator.onLine ? 'error' : 'offline', error: String(e) });
      }
    } finally {
      this.flushing = false;
    }
    if (retry) {
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => void this.flush(), RETRY_MS[Math.min(this.attempts - 1, RETRY_MS.length - 1)]);
    } else if (this.outbox.size) {
      void this.flush();
    }
  }

  // --- Receiving -------------------------------------------------------------

  private schedulePoll(ms: number): void {
    clearTimeout(this.pollTimer);
    if (!this.connected || document.visibilityState === 'hidden') return;
    this.pollDelay = ms;
    this.pollTimer = setTimeout(() => void this.poll(), ms);
  }

  private async poll(): Promise<void> {
    const p = this.shown;
    const token = this.loadToken;
    // A frame not ready yet is about to reopen the shift, and that load polls.
    if (!p || this.pendingOpen || !this.frameReady) return;
    try {
      const r = await fetch(`${API_BASE}/api/grid/doc?${qs(p, `&since=${this.cursor}`)}`);
      if (!r.ok) throw new HttpError(r.status);
      const page = (await r.json()) as DocPage;
      // A load started meanwhile (another shift, or this one again): this
      // reply describes what the frame no longer shows, and the load polls anew.
      if (token !== this.loadToken || this.pendingOpen || !this.shown || partKey(this.shown) !== partKey(p)) return;
      // Someone moved the shift to another template: start over on it.
      if (page.template_id !== null && page.template_id !== this.snap.templateId) {
        this.wanted = null;
        this.open(p, this.fileName);
        return;
      }
      const adopt: CellChange[] = [];
      for (const ch of page.changes) {
        const k = keyOf(ch);
        this.server.set(k, { sheet: ch.sheet, cell: ch.cell, c: ch.c });
        const mine = this.own.get(k);
        if (mine === Infinity) {
          this.deferred.set(k, ch);
          continue;
        }
        // Our own write already shown here, or a peer's older than ours. One of
        // ours this frame hasn't seen (sent before the shift was reopened) is
        // adopted like a peer's.
        if (mine !== undefined && mine >= ch.seq) continue;
        adopt.push({ sheet: ch.sheet, cell: ch.cell, c: ch.c });
      }
      this.cursor = Math.max(this.cursor, page.seq);
      if (page.changes.length) {
        saveSnapshot({ part: partKey(p), templateId: this.snap.templateId ?? 0, seq: this.cursor, cells: [...this.server.values()] });
      }
      if (adopt.length) this.lastActivity = Date.now();
      this.apply(adopt);
      // Reachable again. A sending error stays until the next send settles it.
      if ((this.pollFailed || this.openedOffline) && !this.flushing && this.outbox.size === 0) {
        this.set({ status: 'ready', error: null });
      }
      this.pollFailed = false;
      this.openedOffline = false;
      const idle = Date.now() - this.lastActivity > IDLE_AFTER_MS;
      this.schedulePoll(page.more ? 0 : idle ? POLL_IDLE_MS : POLL_MS);
    } catch {
      if (token !== this.loadToken) return;
      this.pollFailed = true;
      this.set({ status: navigator.onLine ? 'error' : 'offline' });
      this.schedulePoll(POLL_ERROR_MS);
    }
  }

  private onVisibility = (): void => {
    if (document.visibilityState === 'visible') this.schedulePoll(0);
    else clearTimeout(this.pollTimer);
  };

  private onOnline = (): void => {
    // A shift that couldn't open (no snapshot of it here) gets another go.
    if (this.wanted && !this.pendingOpen && (!this.shown || partKey(this.shown) !== partKey(this.wanted))) {
      void this.load(this.wanted);
      return;
    }
    void this.flush();
    this.schedulePoll(0);
  };
}

/** The page's one shared-workbook controller. */
export const sharedGrid = new SharedGrid();

function download(name: string, bytes: ArrayBuffer): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// --- Templates -----------------------------------------------------------------

export interface TemplateInfo {
  id: number;
  name: string;
  size: number;
  created_at: number;
}

export async function listTemplates(): Promise<TemplateInfo[]> {
  const r = await fetch(`${API_BASE}/api/grid/templates`);
  if (!r.ok) throw new Error(`templates ${r.status}`);
  return ((await r.json()) as { data: TemplateInfo[] }).data;
}
