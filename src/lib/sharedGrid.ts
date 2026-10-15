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

export type GridStatus = 'loading' | 'no-template' | 'ready' | 'syncing' | 'offline' | 'error' | 'disabled';

export interface GridSnapshot {
  status: GridStatus;
  pending: number;
  templateId: number | null;
  error: string | null;
}

const POLL_MS = 2_000;
const POLL_ERROR_MS = 10_000;
const RETRY_MS = [2_000, 5_000, 15_000, 30_000];
// The Worker refuses bigger batches; a sort or a fill is split.
const CHUNK = 4_000;

const keyOf = (c: CellChange) => `${c.sheet}!${c.cell}`;
const partKey = (p: Partition) => `${p.date}.${p.poste}`;
const outboxKey = (p: Partition) => `wb.grid.outbox.${partKey(p)}`;
const qs = (p: Partition, extra = '') => `date=${p.date}&poste=${p.poste}${extra}`;

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

// One id per page load: pending writes live in this page's memory.
const CLIENT = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export class SharedGrid {
  private frame: HTMLIFrameElement | null = null;
  private frameReady = false;
  // The shift asked for, and the one the frame is showing (they differ while
  // a switch is under way: edits still arriving belong to the old one).
  private wanted: Partition | null = null;
  private shown: Partition | null = null;
  private loadToken = 0;
  private initial: CellChange[] = [];
  private cursor = 0;
  // Per cell: Infinity while our write is unsent or in flight, then its seq.
  private own = new Map<string, number>();
  // Peer writes skipped because ours was in flight, kept until our ack says
  // which one the Worker ordered last.
  private deferred = new Map<string, StoredChange>();
  private outbox: CellChange[] = [];
  private inflight: CellChange[] = [];
  private flushing = false;
  private attempts = 0;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  private snap: GridSnapshot = { status: SYNC_ENABLED ? 'loading' : 'disabled', pending: 0, templateId: null, error: null };
  private fileName = 'classeur.xlsx';

  /** Starts listening; paired with `dispose` (both safe to repeat, as React's
   * StrictMode runs effects twice in development). */
  connect(): void {
    window.addEventListener('message', this.onMessage);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('online', this.onOnline);
    if (this.shown && !this.pendingOpen) this.schedulePoll(0);
  }

  dispose(): void {
    window.removeEventListener('message', this.onMessage);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('online', this.onOnline);
    clearTimeout(this.pollTimer);
    clearTimeout(this.retryTimer);
    if (this.shown) saveOutbox(this.shown, [...this.inflight, ...this.outbox]);
  }

  // --- React glue ------------------------------------------------------------

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = (): GridSnapshot => this.snap;

  private set(patch: Partial<GridSnapshot>): void {
    this.snap = { ...this.snap, ...patch, pending: this.outbox.length + this.inflight.length };
    this.listeners.forEach((l) => l());
  }

  attach(frame: HTMLIFrameElement | null): void {
    if (frame === this.frame) return;
    this.frame = frame;
    this.frameReady = false;
  }

  // --- Opening a shift -------------------------------------------------------

  open(p: Partition | null, fileName: string): void {
    this.fileName = fileName;
    if (p && this.wanted && partKey(p) === partKey(this.wanted)) return;
    this.wanted = p;
    if (p) void this.load(p);
  }

  /** Re-reads the shift, e.g. after it was moved to another template. */
  reload(): void {
    if (this.wanted) void this.load(this.wanted);
  }

  private async load(p: Partition): Promise<void> {
    if (!SYNC_ENABLED) return;
    const token = ++this.loadToken;
    clearTimeout(this.pollTimer);
    this.set({ status: 'loading', error: null });
    try {
      // Everything stored for the shift, page by page.
      let since = 0;
      let templateId: number | null = null;
      const cells = new Map<string, CellChange>();
      for (;;) {
        const r = await fetch(`${API_BASE}/api/grid/doc?${qs(p, `&since=${since}`)}`);
        if (!r.ok) throw new Error(`doc ${r.status}`);
        const page = (await r.json()) as { template_id: number | null; seq: number; changes: StoredChange[]; more?: boolean };
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
      const t = await fetch(`${API_BASE}/api/grid/template?id=${templateId}`);
      if (!t.ok) throw new Error(`template ${t.status}`);
      const bytes = await t.arrayBuffer();
      if (token !== this.loadToken) return;
      this.cursor = since;
      this.initial = [...cells.values()];
      this.set({ templateId });
      this.pendingOpen = { p, bytes };
      this.sendOpen();
    } catch (e) {
      if (token === this.loadToken) this.set({ status: navigator.onLine ? 'error' : 'offline', error: String(e) });
    }
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
    // Whatever the previous shift still had to send stays on this device.
    if (this.shown && partKey(this.shown) !== partKey(next)) {
      saveOutbox(this.shown, [...this.inflight, ...this.outbox]);
    }
    this.shown = next;
    this.own.clear();
    this.deferred.clear();
    this.inflight = [];
    // Edits made here while offline (or before a reload) go on top of what
    // the Worker has, and then on their way.
    this.outbox = loadOutbox(next);
    for (const ch of this.outbox) this.own.set(keyOf(ch), Infinity);
    const pendingKeys = new Set(this.outbox.map(keyOf));
    const base = this.initial.filter((ch) => !pendingKeys.has(keyOf(ch)));
    this.initial = [];
    this.apply([...base, ...this.outbox]);
    this.set({ status: 'ready' });
    // Without focus, the first tap in the frame only focuses it and the edit
    // the operator meant is lost.
    // eframe listens on its canvas, so that's what takes focus (same origin).
    this.frame?.focus();
    this.frame?.contentWindow?.focus();
    this.frame?.contentDocument?.querySelector('canvas')?.focus();
    this.flush();
    this.schedulePoll(POLL_MS);
  }

  // --- Frame messages --------------------------------------------------------

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
        if (this.pendingOpen) this.sendOpen();
        else if (this.shown) {
          // The frame reloaded under an open shift: show it again.
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
      // A newer edit of a cell already queued replaces it.
      const i = this.outbox.findIndex((o) => keyOf(o) === k);
      if (i >= 0) this.outbox.splice(i, 1);
      this.outbox.push(ch);
    }
    if (this.shown) saveOutbox(this.shown, [...this.inflight, ...this.outbox]);
    this.set({});
    this.flush();
  }

  private async flush(): Promise<void> {
    const p = this.shown;
    if (!p || this.flushing || this.outbox.length === 0 || !navigator.onLine) {
      if (!navigator.onLine && this.outbox.length) this.set({ status: 'offline' });
      return;
    }
    this.flushing = true;
    const batch = this.outbox.splice(0, CHUNK);
    this.inflight = batch;
    this.set({ status: 'syncing' });
    const stillShown = () => !!this.shown && partKey(this.shown) === partKey(p);
    try {
      const r = await fetch(`${API_BASE}/api/grid/doc?${qs(p)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client: CLIENT, changes: batch }),
      });
      if (!r.ok) throw new Error(`POST ${r.status}`);
      const { seqs } = (await r.json()) as { seqs: (number | null)[] };
      if (stillShown()) {
        this.inflight = [];
        const adopt: CellChange[] = [];
        batch.forEach((ch, i) => {
          const k = keyOf(ch);
          const seq = seqs[i] ?? 0;
          // Edited again since: that newer write is still ours to send.
          if (this.outbox.some((o) => keyOf(o) === k)) return;
          this.own.set(k, seq);
          const peer = this.deferred.get(k);
          if (peer) {
            this.deferred.delete(k);
            if (peer.seq > seq) adopt.push(peer);
          }
        });
        this.apply(adopt);
        saveOutbox(p, this.outbox);
      } else {
        // The frame moved to another shift meanwhile; that shift's stored
        // queue still lists these cells, which are now on the Worker.
        const sent = new Set(batch.map(keyOf));
        saveOutbox(p, loadOutbox(p).filter((ch) => !sent.has(keyOf(ch))));
      }
      this.attempts = 0;
      this.set({ status: 'ready', error: null });
    } catch (e) {
      if (stillShown()) {
        this.inflight = [];
        // Back to the front, unless the cell was edited again meanwhile.
        const queued = new Set(this.outbox.map(keyOf));
        this.outbox.unshift(...batch.filter((ch) => !queued.has(keyOf(ch))));
      }
      this.attempts++;
      this.set({ status: navigator.onLine ? 'error' : 'offline', error: String(e) });
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => this.flush(), RETRY_MS[Math.min(this.attempts - 1, RETRY_MS.length - 1)]);
    } finally {
      this.flushing = false;
    }
    if (this.outbox.length && this.attempts === 0) this.flush();
  }

  // --- Receiving -------------------------------------------------------------

  private schedulePoll(ms: number): void {
    clearTimeout(this.pollTimer);
    if (document.visibilityState === 'hidden') return;
    this.pollTimer = setTimeout(() => void this.poll(), ms);
  }

  private async poll(): Promise<void> {
    const p = this.shown;
    if (!p || this.pendingOpen) return;
    try {
      const r = await fetch(`${API_BASE}/api/grid/doc?${qs(p, `&since=${this.cursor}`)}`);
      if (!r.ok) throw new Error(`poll ${r.status}`);
      const page = (await r.json()) as { template_id: number | null; seq: number; changes: StoredChange[]; more?: boolean };
      if (!this.shown || partKey(this.shown) !== partKey(p)) return;
      // Someone moved the shift to another template: start over on it.
      if (page.template_id !== null && page.template_id !== this.snap.templateId) {
        this.wanted = null;
        this.open(p, this.fileName);
        return;
      }
      const adopt: CellChange[] = [];
      for (const ch of page.changes) {
        if (ch.client === CLIENT) continue;
        const k = keyOf(ch);
        const mine = this.own.get(k);
        if (mine === Infinity) {
          this.deferred.set(k, ch);
          continue;
        }
        if (mine !== undefined && mine > ch.seq) continue;
        adopt.push({ sheet: ch.sheet, cell: ch.cell, c: ch.c });
      }
      this.cursor = Math.max(this.cursor, page.seq);
      this.apply(adopt);
      if (this.snap.status === 'offline' || this.snap.status === 'error') this.set({ status: 'ready', error: null });
      this.schedulePoll(page.more ? 0 : POLL_MS);
    } catch {
      this.set({ status: navigator.onLine ? 'error' : 'offline' });
      this.schedulePoll(POLL_ERROR_MS);
    }
  }

  private onVisibility = (): void => {
    if (document.visibilityState === 'visible') this.schedulePoll(0);
    else clearTimeout(this.pollTimer);
  };

  private onOnline = (): void => {
    this.flush();
    this.schedulePoll(0);
  };
}

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

export async function uploadTemplate(file: File): Promise<number> {
  const r = await fetch(`${API_BASE}/api/grid/templates?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
  const body = (await r.json()) as { id?: number; error?: string };
  if (!r.ok || !body.id) {
    throw new Error(
      body.error === 'not_xlsx' ? 'Ce fichier n’est pas un classeur .xlsx.' : body.error === 'template_too_large' ? 'Modèle trop lourd (1,9 Mo maximum).' : `Envoi refusé (${r.status}).`,
    );
  }
  return body.id;
}

export async function moveToTemplate(p: Partition, templateId: number): Promise<void> {
  const r = await fetch(`${API_BASE}/api/grid/doc/template?${qs(p)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template_id: templateId }),
  });
  if (!r.ok) throw new Error(`PUT ${r.status}`);
}
