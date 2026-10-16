// One MCP session (one Claude conversation): a device of its own on the shared
// Suivi workbooks, like a tablet. It opens a shift's workbook in GridCraft's
// engine, catches up with the other devices' writes before every tool call,
// and stores what a tool changed the way a tablet does (worker/src/grid.ts:
// last write wins per cell, in `seq` order), so the tablets show Claude's
// edits within seconds.
//
// An edit is kept only if the other devices can have it: cells only (a sheet
// added, a width or a merge would never reach them), none of the cells the app
// fills itself (Date, Poste), and none a tablet changed since Claude last
// looked. Otherwise the engine takes it back and the tool says why.

import { DurableObject } from 'cloudflare:workers';
import {
  changesSince,
  docTemplateId,
  latestTemplateId,
  listDocs,
  MAX_CHANGES,
  pinDoc,
  storeChanges,
  templateFile,
  type GridEnv,
  type Partition,
  type StoredChange,
} from '../grid';
import type { AssistFeedback, AssistReply, AssistRequest } from '../assistTypes';
import { activeRules, proposeRule } from '../lexicon';
import { assist, AssistError, MAX_TEXT, type AssistEnv, type Exchange } from './assist';
import { shiftContext } from './context';
import { engineTools, isTrap, Workbook, type CellChange } from './engine';

export interface McpEnv extends GridEnv, AssistEnv {
  SESSIONS: DurableObjectNamespace<McpSession>;
  /** "on": Claude's edits are stored. Anything else: read only. */
  MCP_WRITE?: string;
}

interface JsonRpc {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
// Sessions nobody used for this long are forgotten.
const IDLE_MS = 7 * 24 * 3600_000;
// Past this many cells, an edit waits for shift_allow_large: a sort or a fill
// of the whole sheet is thousands of D1 writes.
const LARGE = 2_000;
const CHUNK = 4_000;
// The assistant's questions per shift and per hour: each one is paid for.
const ASSIST_PER_HOUR = 40;
// The shift's exchanges the assistant remembers, and for how long after the last one.
const ASSIST_HISTORY = 8;
const ASSIST_FORGET_MS = 3 * 24 * 3600_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const POSTE_RE = /^[ABCD]$/;
// Tools that would leave the shared workbook: files are the app's business.
const HIDDEN_TOOLS = new Set(['open_workbook', 'save_workbook', 'new_workbook', 'screenshot']);

const INSTRUCTIONS = `Ce serveur donne accès aux classeurs « Suivi » partagés de Working Book : un classeur Excel par poste (date + poste A, B, C ou D), rempli en même temps sur plusieurs tablettes.
1. shift_list liste les postes ouverts ; shift_open {date, poste} ouvre celui sur lequel travailler.
2. Ensuite, tous les outils GridCraft (inspect_workbook, read_range, get_cell, evaluate_formula, set_cell, write_range, sort_range, execute_command…) travaillent sur ce classeur, avec les vrais résultats des formules.
3. Chaque modification est enregistrée aussitôt et apparaît sur les tablettes en quelques secondes. Avant chaque outil, le classeur reprend les saisies des tablettes.
Règles : seules les cellules sont partagées. Ajouter ou renommer une feuille, changer une largeur, fusionner, modifier une mise en forme conditionnelle… est refusé. Une modification qui touche une cellule qu'une tablette vient de changer est refusée : relis la cellule puis recommence si c'est toujours voulu. Plus de ${LARGE} cellules modifiées d'un coup demandent shift_allow_large.
Le classeur : Suivi est la saisie (à gauche Début de Ligne, colonnes B à L ; à droite Fin de Ligne, colonnes N à AA ; une ligne dont le N° TAG est un texte, comme une couleur, ouvre un bloc de cette couleur). Rapport, protégée, calcule tout : la couleur étudiée se saisit en Rapport!C2 (une couleur de Suivi), le défaut compté par dimension en Rapport!F2, et la colonne DEFAUT (B3:B24) est la liste des défauts des listes déroulantes. Les défauts et couleurs s'écrivent en entier, tels que dans les listes (« A6 - Flaking »). Les dates (colonne I de Suivi) se saisissent jour d'abord : « 16/10/26 ».`;

const SHIFT_TOOLS = [
  {
    name: 'shift_list',
    title: 'Postes',
    description: 'Les postes (date + poste) dont le classeur Suivi a été ouvert, du plus récent au plus ancien : modèle, nombre de cellules saisies, dernière saisie.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Premier jour, YYYY-MM-DD (défaut : il y a 14 jours)' },
        to: { type: 'string', description: 'Dernier jour, YYYY-MM-DD (défaut : demain)' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'shift_open',
    title: 'Ouvrir un poste',
    description:
      "Ouvre le classeur Suivi d'un poste. Les outils GridCraft travaillent ensuite dessus. Un poste jamais ouvert part du modèle le plus récent.",
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Jour du poste, YYYY-MM-DD' },
        poste: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
      },
      required: ['date', 'poste'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'shift_status',
    title: 'État',
    description: 'Le poste ouvert, son modèle, si les modifications sont enregistrées, et ce qui attend.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'shift_allow_large',
    title: 'Autoriser une grosse modification',
    description: `Autorise la prochaine modification à toucher jusqu'à \`cells\` cellules (au-delà de ${LARGE}, une modification est refusée sans cela). Chaque cellule est une écriture en base : préférer des plages ciblées.`,
    inputSchema: {
      type: 'object',
      properties: { cells: { type: 'integer', minimum: 1, maximum: 50_000 } },
      required: ['cells'],
    },
  },
];

const keyOf = (c: { sheet: string; cell: string }) => `${c.sheet}!${c.cell}`;
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError } : {}) });

/** How a stored content reads for Claude. */
function show(c: unknown): string {
  if (!c || typeof c !== 'object') return '(vide)';
  const { f, v } = c as { f?: string; v?: { t?: string; v?: unknown } };
  if (f) return `=${f}`;
  if (v && 'v' in v) return JSON.stringify(v.v);
  return '(vide, mise en forme seule)';
}

class UserError extends Error {}

export class McpSession extends DurableObject<McpEnv> {
  private book: Workbook | null = null;
  private part: Partition | null = null;
  private templateId = 0;
  private templateName = '';
  /** Whether the shift's workbook is pinned to its template in D1 yet. */
  private pinned = false;
  /** Every write up to this seq is in the workbook. */
  private cursor = 0;
  /** This session's writes: cell → seq. A peer's older write to it is skipped. */
  private own = new Map<string, number>();
  /** The cells the app fills (Date, Poste). */
  private context = new Set<string>();
  /** Edits kept here but not stored yet (a failed write), sent before anything else. */
  private outbox: CellChange[] = [];
  private allowLarge = 0;
  private queue: Promise<unknown> = Promise.resolve();
  /** When the assistant was asked about this shift in the last hour. */
  private asked: number[] = [];

  /**
   * Counts one more question to the assistant today, all shifts together:
   * false past `limit`. Only on the one object named for it.
   */
  async spend(limit: number): Promise<boolean> {
    const day = new Date().toISOString().slice(0, 10);
    const seen = await this.ctx.storage.get<{ day: string; n: number }>('assist-day');
    const n = seen?.day === day ? seen.n : 0;
    if (n >= limit) return false;
    await this.ctx.storage.put('assist-day', { day, n: n + 1 });
    return true;
  }

  /** What became of one of the assistant's proposals, for its memory of the shift. */
  async assistFeedback(f: AssistFeedback): Promise<{ ok: boolean }> {
    const run = async () => {
      const history = (await this.ctx.storage.get<Exchange[]>('assist-history')) ?? [];
      const x = history.find((e) => e.id === f.id);
      if (!x) return { ok: false };
      x.outcome = f.outcome;
      if (f.outcome === 'valide' && f.cells && f.cells.length < x.cells.length) x.kept = f.cells.filter((c) => x.cells.some((k) => k.cell === c));
      await this.ctx.storage.put('assist-history', history);
      return { ok: true };
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /**
   * One question to the Suivi assistant (assist.ts). Its sessions are one per
   * shift, named after it: the workbook stays open between questions, caught
   * up with the tablets before each, and the shift's last exchanges are kept
   * here (storage, forgotten 3 days after the last one). No cell is stored
   * from here — the app writes the cells the operator accepts, and says so
   * (assistFeedback).
   */
  async assist(req: AssistRequest): Promise<AssistReply> {
    const run = async (): Promise<AssistReply> => {
      const now = Date.now();
      this.asked = this.asked.filter((t) => now - t < 3_600_000);
      if (this.asked.length >= ASSIST_PER_HOUR) return { ok: false, error: `L’assistant a déjà répondu ${ASSIST_PER_HOUR} fois pour ce poste dans l’heure : réessaie plus tard.` };
      this.asked.push(now);
      const p: Partition = { date: req.date, poste: req.poste };
      try {
        if (!this.book || !this.part || this.part.date !== p.date || this.part.poste !== p.poste) await this.load(p);
        else await this.pull(this.book, []);
        const text = (req.text ?? '').slice(0, MAX_TEXT);
        const history = (await this.ctx.storage.get<Exchange[]>('assist-history')) ?? [];
        const lexicon = await activeRules(this.env).catch(() => [] as string[]);
        const reply = await assist(this.env, this.book as Workbook, p, req.mode, text, { history, lexicon });
        if (!reply.ok || req.mode === 'bilan') return reply;
        const exchange: Exchange = {
          id: crypto.randomUUID().slice(0, 8),
          at: now,
          mode: req.mode,
          ask: req.mode === 'saisie' ? text.slice(-400) : '',
          ...(reply.question ? { question: reply.question } : {}),
          cells: (reply.items ?? []).filter((i) => i.ok).map((i) => ({ cell: i.cell, before: i.before, after: i.after ?? '' })),
          outcome: 'propose',
        };
        await this.ctx.storage.put('assist-history', [...history, exchange].slice(-ASSIST_HISTORY));
        await this.ctx.storage.setAlarm(now + ASSIST_FORGET_MS);
        reply.id = exchange.id;
        // A rule already known, refused before, or past the queue: nothing to say.
        if (reply.rule && (await proposeRule(this.env, reply.rule, text).catch(() => null)) === null) delete reply.rule;
        return reply;
      } catch (e) {
        if (e instanceof AssistError || e instanceof UserError) return { ok: false, error: e.message };
        if (isTrap(e)) {
          this.book = null;
          this.ctx.abort('GridCraft engine trapped');
        }
        return { ok: false, error: `Erreur du classeur : ${e instanceof Error ? e.message : String(e)}` };
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** One HTTP request's messages; null when the session doesn't exist (the client starts a new one). */
  async handle(messages: JsonRpc[], init: { create: boolean; userId: string }): Promise<unknown[] | null> {
    const run = async () => {
      const owner = await this.ctx.storage.get<string>('owner');
      if (init.create) await this.ctx.storage.put('owner', init.userId);
      else if (owner !== init.userId) return null;
      await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
      const replies: unknown[] = [];
      for (const m of messages) {
        const r = await this.message(m);
        if (r !== undefined) replies.push(r);
      }
      return replies;
    };
    // One message at a time: a tool call reads, edits and stores in steps.
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** The session ends (DELETE from the client). */
  async close(): Promise<void> {
    this.book?.free();
    this.book = null;
    await this.ctx.storage.deleteAll();
  }

  async alarm(): Promise<void> {
    await this.close();
  }

  private async message(m: JsonRpc): Promise<unknown> {
    if (!m || typeof m !== 'object' || typeof m.method !== 'string') {
      return { jsonrpc: '2.0', id: m?.id ?? null, error: { code: -32600, message: 'invalid request' } };
    }
    // Notifications get no reply.
    if (m.id === undefined || m.id === null) return undefined;
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id: m.id, result });
    const params = m.params ?? {};
    switch (m.method) {
      case 'initialize': {
        const asked = String(params.protocolVersion ?? '');
        return ok({
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'working-book-suivi', title: 'Working Book — Suivi', version: '1.0.0' },
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: [...SHIFT_TOOLS, ...engineTools().filter((t) => !HIDDEN_TOOLS.has(t.name))] });
      case 'tools/call':
        return ok(await this.toolCall(String(params.name ?? ''), (params.arguments ?? {}) as Record<string, unknown>));
      case 'resources/list':
        return ok({ resources: [] });
      case 'prompts/list':
        return ok({ prompts: [] });
      default:
        return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `method not found: ${m.method}` } };
    }
  }

  private async toolCall(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (name) {
        case 'shift_list':
          return await this.shiftList(args);
        case 'shift_open':
          return await this.shiftOpen(args);
        case 'shift_status':
          return await this.shiftStatus();
        case 'shift_allow_large': {
          const n = Number(args.cells);
          if (!Number.isInteger(n) || n < 1) return text('`cells` : un entier positif.', true);
          this.allowLarge = Math.min(n, 50_000);
          return text(`La prochaine modification pourra toucher jusqu'à ${this.allowLarge} cellules.`);
        }
        default:
          return await this.gridTool(name, args);
      }
    } catch (e) {
      if (e instanceof UserError) return text(e.message, true);
      if (isTrap(e)) {
        // The engine's memory can't be trusted after a trap: start this
        // object over, and the next call reloads the shift from D1.
        this.book = null;
        this.ctx.abort('GridCraft engine trapped');
      }
      return text(`Erreur : ${e instanceof Error ? e.message : String(e)}`, true);
    }
  }

  private async shiftList(args: Record<string, unknown>): Promise<ToolResult> {
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const from = typeof args.from === 'string' && DATE_RE.test(args.from) ? args.from : day(-14);
    const to = typeof args.to === 'string' && DATE_RE.test(args.to) ? args.to : day(1);
    const rows = await listDocs(this.env, from, to);
    if (!rows.length) return text(`Aucun poste ouvert entre le ${from} et le ${to}.`);
    const lines = rows.map(
      (r) =>
        `${r.date} poste ${r.poste} : modèle #${r.template_id}, ${r.cells} cellule(s) saisie(s)` +
        (r.updated_at ? `, dernière saisie ${new Date(r.updated_at).toISOString().replace('T', ' ').slice(0, 16)} UTC` : ''),
    );
    return text(lines.join('\n'));
  }

  private async shiftOpen(args: Record<string, unknown>): Promise<ToolResult> {
    const date = String(args.date ?? '');
    const poste = String(args.poste ?? '').toUpperCase();
    if (!DATE_RE.test(date) || !POSTE_RE.test(poste)) return text('`date` au format YYYY-MM-DD et `poste` parmi A, B, C, D.', true);
    await this.flushOutbox();
    const cells = await this.load({ date, poste });
    await this.ctx.storage.put('part', { date, poste });
    return text(
      `Poste ${poste} du ${date} ouvert : modèle #${this.templateId} « ${this.templateName} », ${cells} cellule(s) saisie(s).` +
        (this.pinned ? '' : ' Ce poste n’a pas encore été commencé : il part du modèle le plus récent.') +
        (this.writable ? '' : ' Lecture seule : les modifications ne sont pas enregistrées.'),
    );
  }

  private async shiftStatus(): Promise<ToolResult> {
    const part = this.part ?? (await this.ctx.storage.get<Partition>('part')) ?? null;
    if (!part) return text('Aucun poste ouvert : shift_open {date, poste}.');
    return text(
      [
        `Poste ${part.poste} du ${part.date}${this.book ? '' : ' (sera rechargé au prochain outil)'}.`,
        this.book ? `Modèle #${this.templateId} « ${this.templateName} », à jour jusqu'à l'écriture n° ${this.cursor}.` : '',
        this.writable ? 'Modifications enregistrées et partagées.' : 'Lecture seule.',
        this.outbox.length ? `${this.outbox.length} cellule(s) en attente d'enregistrement.` : '',
        `${this.own.size} cellule(s) écrite(s) par cette session.`,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  private get writable(): boolean {
    return this.env.MCP_WRITE === 'on';
  }

  /** Opens a shift's workbook from D1; returns how many cells are stored for it. */
  private async load(p: Partition): Promise<number> {
    let templateId = await docTemplateId(this.env, p);
    const pinned = templateId !== null;
    templateId ??= await latestTemplateId(this.env);
    if (templateId === null) throw new UserError('Aucun modèle publié : le Suivi n’a pas encore de modèle.');
    const file = await templateFile(this.env, templateId);
    if (!file) throw new UserError(`Modèle #${templateId} introuvable.`);
    const stored: StoredChange[] = [];
    let cursor = 0;
    for (;;) {
      const page = await changesSince(this.env, p, cursor);
      stored.push(...page.changes);
      cursor = page.seq;
      if (!page.more) break;
    }
    const name = /\.xlsx$/i.test(file.name) ? file.name : `${file.name}.xlsx`;
    const book = new Workbook(
      name,
      file.bytes,
      stored.map(({ sheet, cell, c }) => ({ sheet, cell, c })),
    );
    const context = shiftContext(book.names(), p);
    book.apply(context);
    this.book?.free();
    this.book = book;
    this.part = p;
    this.templateId = templateId;
    this.templateName = file.name;
    this.pinned = pinned;
    this.cursor = cursor;
    this.own = new Map();
    this.context = new Set(context.map(keyOf));
    this.outbox = [];
    return stored.length;
  }

  /** The open shift's workbook, reloaded if this object was evicted since. */
  private async current(): Promise<Workbook> {
    if (this.book) return this.book;
    const part = await this.ctx.storage.get<Partition>('part');
    if (!part) throw new UserError('Aucun poste ouvert : appelle d’abord shift_open {date, poste} (shift_list pour les voir).');
    await this.load(part);
    if (!this.book) throw new UserError('Le poste n’a pas pu être rouvert.');
    return this.book;
  }

  /** The other devices' writes since the last call, applied; returns them by cell. */
  private async pull(book: Workbook, notes: string[]): Promise<Map<string, StoredChange>> {
    const p = this.part as Partition;
    const adopted = new Map<string, StoredChange>();
    const templateId = await docTemplateId(this.env, p);
    if (templateId !== null && templateId !== this.templateId) {
      await this.load(p);
      notes.push(`Le poste est passé au modèle #${templateId} : classeur rechargé.`);
      return adopted;
    }
    if (templateId !== null) this.pinned = true;
    for (;;) {
      const page = await changesSince(this.env, p, this.cursor);
      for (const ch of page.changes) {
        const k = keyOf(ch);
        const mine = this.own.get(k);
        // Our own write coming back, or a peer's older than ours.
        if (mine !== undefined && mine >= ch.seq) continue;
        if (this.context.has(k)) continue;
        adopted.set(k, ch);
      }
      this.cursor = page.seq;
      if (!page.more) break;
    }
    book.apply([...adopted.values()].map(({ sheet, cell, c }) => ({ sheet, cell, c })));
    return adopted;
  }

  /** Stores `changes`; returns the cells refused and the ones not stored (left in the outbox). */
  private async store(changes: CellChange[]): Promise<{ refused: string[]; stored: number; failed: unknown }> {
    const p = this.part as Partition;
    const client = `mcp_${this.ctx.id.toString().slice(0, 12)}`;
    const refused: string[] = [];
    let stored = 0;
    for (let i = 0; i < changes.length; i += CHUNK) {
      const batch = changes.slice(i, i + Math.min(CHUNK, MAX_CHANGES));
      try {
        const seqs = await storeChanges(this.env, p, client, batch);
        batch.forEach((ch, j) => {
          const seq = seqs[j];
          if (seq === null || seq === undefined) refused.push(keyOf(ch));
          else this.own.set(keyOf(ch), seq);
        });
        stored += batch.length;
      } catch (failed) {
        this.outbox.push(...changes.slice(i));
        return { refused, stored, failed };
      }
    }
    return { refused, stored, failed: null };
  }

  /** Edits a previous call couldn't store, stored first. */
  private async flushOutbox(): Promise<string | null> {
    if (!this.outbox.length || !this.part) return null;
    const pending = this.outbox;
    this.outbox = [];
    const r = await this.store(pending);
    return r.failed ? `${this.outbox.length} cellule(s) toujours en attente d'enregistrement (${String(r.failed)}).` : null;
  }

  private async gridTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (HIDDEN_TOOLS.has(name)) return text('Les fichiers ne sont pas accessibles ici : le classeur est celui du poste ouvert (shift_open).', true);
    if (name === 'execute_command' && typeof args.command === 'string' && args.command.startsWith('file.')) {
      return text('Les commandes de fichier (file.*) ne sont pas disponibles : le classeur est celui du poste ouvert.', true);
    }
    const book = await this.current();
    const notes: string[] = [];
    const waiting = await this.flushOutbox();
    if (waiting) notes.push(waiting);
    const news = await this.pull(book, notes);
    const current = this.book as Workbook;
    const out = current.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    const reply = out.response ? (JSON.parse(out.response) as { result?: ToolResult; error?: { message?: string } }) : null;
    const result: ToolResult = reply?.result ?? text(reply?.error?.message ?? 'Pas de réponse du moteur.', true);

    const refusal = this.refusal(out.changes, out.structural, out.lost, news);
    if (refusal) {
      current.rollback();
      return text(refusal, true);
    }
    if (!out.changes.length) {
      current.commit();
      return withNotes(result, notes);
    }
    if (!this.pinned) {
      // The first edit of a shift nobody opened yet pins it to the template
      // this workbook was made from, unless a tablet just pinned another.
      const actual = await pinDoc(this.env, this.part as Partition, this.templateId);
      if (actual !== this.templateId) {
        current.rollback();
        await this.load(this.part as Partition);
        return text(`Ce poste vient d'être ouvert ailleurs sur le modèle #${actual} : classeur rechargé, rien n'a été modifié. Recommence.`, true);
      }
      this.pinned = true;
    }
    const r = await this.store(out.changes);
    if (r.stored === 0 && r.failed) {
      this.outbox = [];
      current.rollback();
      return text(`Échec de l'enregistrement, rien n'a été modifié : ${String(r.failed)}`, true);
    }
    current.commit();
    this.allowLarge = 0;
    notes.push(`${r.stored - r.refused.length} cellule(s) enregistrée(s) et partagée(s).`);
    if (r.refused.length) notes.push(`Refusée(s) par le serveur, restée(s) ici seulement : ${r.refused.slice(0, 20).join(', ')}${r.refused.length > 20 ? '…' : ''}.`);
    if (r.failed) notes.push(`${this.outbox.length} cellule(s) pas encore enregistrée(s) (${String(r.failed)}) : nouvel essai au prochain outil.`);
    return withNotes(result, notes);
  }

  /** Why an edit can't be kept, or null. */
  private refusal(changes: CellChange[], structural: boolean, lost: boolean, news: Map<string, StoredChange>): string | null {
    if (lost) return 'Le classeur du poste ne peut pas être fermé ici.';
    if (structural) {
      return 'Refusé : cette modification touche la structure du classeur (feuilles, noms, largeurs ou hauteurs fixées, fusions, mises en forme conditionnelles, validations, tableaux, commentaires, objets ou protection). Seules les cellules sont partagées entre appareils.';
    }
    if (!changes.length) return null;
    if (!this.writable) return 'Lecture seule : les modifications ne sont pas enregistrées sur ce serveur.';
    const ctx = changes.filter((c) => this.context.has(keyOf(c)));
    if (ctx.length) return `Refusé : ${ctx.map(keyOf).join(', ')} ${ctx.length > 1 ? 'sont remplies' : 'est remplie'} par l'application (date et poste du classeur).`;
    const clash = changes.filter((c) => news.has(keyOf(c)));
    if (clash.length) {
      const list = clash.slice(0, 20).map((c) => `${keyOf(c)} = ${show(news.get(keyOf(c))?.c)}`);
      return `Refusé : une tablette vient de modifier ${clash.length > 1 ? 'ces cellules' : 'cette cellule'} (${list.join(' ; ')}${clash.length > 20 ? '…' : ''}). Relis puis recommence si c'est toujours voulu.`;
    }
    if (changes.length > LARGE && changes.length > this.allowLarge) {
      return `Refusé : ${changes.length} cellules modifiées d'un coup (plus de ${LARGE}). Cible une plage plus petite, ou appelle shift_allow_large {cells: ${changes.length}} puis recommence.`;
    }
    return null;
  }
}

function withNotes(result: ToolResult, notes: string[]): ToolResult {
  if (!notes.length) return result;
  return { ...result, content: [...result.content, { type: 'text', text: notes.join('\n') }] };
}
