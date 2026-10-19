// The line's own input (Loading and Unloading tabs): per (date, poste) a set
// of records — the shift's colours, the jumbos loaded, the racks unloaded, the
// scraps. Several tablets fill the same shift at once, so each record is
// written whole and on its own, last write wins per record, in the order of
// `seq`; a device asks for what came after the last `seq` it saw. The same
// scheme as the shared workbooks' cells (grid.ts), with a record instead of a
// cell.
//
//   GET  /api/line/doc?date&poste[&since=n]  → { seq, records: [{ id, kind, v, seq, client }], more }
//   POST /api/line/doc?date&poste            ← { client, records: [{ id, kind, v }] } → { seqs } (null: refused)
//
// `v` null deletes the record. The app owns what a record holds; this checks
// its shape and size only.

export interface LineEnv {
  DB: D1Database;
}

type Cors = Record<string, string>;

export const LINE_METHODS = 'GET, POST, OPTIONS';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const POSTE_RE = /^[ABCD]$/;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const KINDS = new Set(['colour', 'loading', 'unloading', 'scrap']);
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const MAX_KEYS = 32;
const MAX_STRING = 500;
const MAX_RECORD_BYTES = 8 * 1024;
// A batch is what the client queued since its last send: an edit is one
// record, an import a few hundred.
const MAX_RECORDS = 1_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
// One reply's worth when catching up; the client asks again.
const PAGE = 2_000;

interface RecordWrite {
  id: string;
  kind: string;
  v: unknown;
}

function json(data: unknown, cors: Cors, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors } });
}

function partition(url: URL): { date: string; poste: string } | null {
  const date = url.searchParams.get('date') ?? '';
  const poste = url.searchParams.get('poste') ?? '';
  return ISO_DATE_RE.test(date) && POSTE_RE.test(poste) ? { date, poste } : null;
}

async function readJson(request: Request): Promise<unknown> {
  const len = Number(request.headers.get('Content-Length') ?? 0);
  if (len > MAX_BODY_BYTES) return undefined;
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The record's value as stored (JSON, null once deleted), or undefined when
 * it isn't one: a flat object of short strings, numbers, booleans and nulls. */
function storedValue(x: unknown): { id: string; kind: string; v: string | null } | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const { id, kind, v } = x as RecordWrite;
  if (typeof id !== 'string' || !ID_RE.test(id) || typeof kind !== 'string' || !KINDS.has(kind)) return undefined;
  if (v === null) return { id, kind, v: null };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > MAX_KEYS) return undefined;
  for (const [k, val] of entries) {
    if (!KEY_RE.test(k)) return undefined;
    if (typeof val === 'string' ? val.length > MAX_STRING : typeof val === 'number' ? !Number.isFinite(val) : val !== null && typeof val !== 'boolean') {
      return undefined;
    }
  }
  const s = JSON.stringify(v);
  return s.length > MAX_RECORD_BYTES ? undefined : { id, kind, v: s };
}

async function getDoc(url: URL, env: LineEnv, cors: Cors): Promise<Response> {
  const p = partition(url);
  if (!p) return json({ error: 'invalid_params' }, cors, 400);
  const since = Math.max(0, Number(url.searchParams.get('since') ?? 0) || 0);
  const { results } = await env.DB.prepare(
    `SELECT id, kind, v, seq, client FROM line_records
     WHERE date = ?1 AND poste = ?2 AND seq > ?3 ORDER BY seq LIMIT ${PAGE}`,
  )
    .bind(p.date, p.poste, since)
    .all<{ id: string; kind: string; v: string | null; seq: number; client: string }>();
  const records = results.map((r) => ({ id: r.id, kind: r.kind, v: r.v === null ? null : JSON.parse(r.v), seq: r.seq, client: r.client }));
  const seq = records.length ? records[records.length - 1].seq : since;
  return json({ seq, records, more: records.length === PAGE }, cors);
}

async function postDoc(request: Request, url: URL, env: LineEnv, cors: Cors): Promise<Response> {
  const p = partition(url);
  if (!p) return json({ error: 'invalid_params' }, cors, 400);
  const body = (await readJson(request)) as { client?: unknown; records?: unknown } | undefined;
  if (!body || typeof body.client !== 'string' || !Array.isArray(body.records)) {
    return json({ error: 'expected_client_and_records' }, cors, 400);
  }
  if (body.records.length > MAX_RECORDS) return json({ error: 'too_many_records', max: MAX_RECORDS }, cors, 413);
  const client = body.client.slice(0, 64);
  const now = Date.now();
  // One statement per record, in one batch: D1 runs a batch as a transaction
  // and writers one at a time, so each statement's MAX(seq)+1 is a fresh,
  // strictly increasing number — the order every device applies them in.
  const stmt = env.DB.prepare(
    `INSERT INTO line_records (date, poste, id, kind, v, seq, client, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5,
       (SELECT COALESCE(MAX(seq), 0) + 1 FROM line_records WHERE date = ?1 AND poste = ?2), ?6, ?7)
     ON CONFLICT (date, poste, id) DO UPDATE SET
       kind = excluded.kind, v = excluded.v, seq = excluded.seq, client = excluded.client, updated_at = excluded.updated_at
     RETURNING seq`,
  );
  // A record refused gets a null seq and the others are stored.
  const statements: D1PreparedStatement[] = [];
  const at: number[] = [];
  body.records.forEach((r, i) => {
    const s = storedValue(r);
    if (!s) return;
    statements.push(stmt.bind(p.date, p.poste, s.id, s.kind, s.v, client, now));
    at.push(i);
  });
  const seqs: (number | null)[] = body.records.map(() => null);
  if (statements.length) {
    const results = await env.DB.batch<{ seq: number }>(statements);
    results.forEach((r, j) => (seqs[at[j]] = r.results[0]?.seq ?? null));
  }
  return json({ seqs }, cors);
}

export async function handleLine(request: Request, url: URL, env: LineEnv, cors: Cors): Promise<Response> {
  switch (`${request.method} ${url.pathname}`) {
    case 'GET /api/line/doc':
      return getDoc(url, env, cors);
    case 'POST /api/line/doc':
      return postDoc(request, url, env, cors);
    default:
      return json({ error: url.pathname.startsWith('/api/line/') ? 'method_not_allowed' : 'not_found' }, cors, 405);
  }
}
