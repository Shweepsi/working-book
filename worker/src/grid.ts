// GridCraft shared workbooks: an uploaded .xlsx template, and per (date, poste)
// the cells edited on top of it. GridCraft reports each edit as cell changes
// and applies other devices' changes, so several tablets can fill the same
// shift's workbook at once; this module stores the changes and hands each
// device the ones it hasn't seen.
//
//   GET  /api/grid/templates                  → { data: [{ id, name, size, created_at }] } newest first
//   POST /api/grid/templates?name=…           ← the .xlsx bytes → { id }
//   GET  /api/grid/template?id=…              → the .xlsx bytes (immutable, cached for good)
//   GET  /api/grid/doc?date&poste[&since=n]   → { template_id, seq, changes }
//   POST /api/grid/doc?date&poste             ← { client, changes } → { seqs } (null: cell refused)
//   PUT  /api/grid/doc/template?date&poste    ← { template_id } → { template_id }

export interface GridEnv {
  DB: D1Database;
}

type Cors = Record<string, string>;

export const GRID_METHODS = 'GET, POST, PUT, OPTIONS';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const POSTE_RE = /^[ABCD]$/;
const CELL_RE = /^[A-Z]{1,3}[1-9]\d{0,6}$/;
// D1 holds a value up to 2 000 000 bytes; a template is one value.
const MAX_TEMPLATE_BYTES = 1_900_000;
// Templates are never deleted (a shift keeps the one it started from), so the
// table only grows: an upload past this is refused.
const MAX_TEMPLATES = 30;
// A batch is what one edit changed: typing is a cell, a sort or a fill can be
// thousands. Past this the client splits it.
const MAX_CHANGES = 5_000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_CONTENT_BYTES = 32 * 1024;
// One reply's worth of changes when catching up; the client asks again.
const PAGE = 5_000;

interface Change {
  sheet: string;
  cell: string;
  c: unknown;
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

async function latestTemplateId(env: GridEnv): Promise<number | null> {
  const row = await env.DB.prepare('SELECT id FROM grid_templates ORDER BY id DESC LIMIT 1').first<{ id: number }>();
  return row?.id ?? null;
}

async function listTemplates(env: GridEnv, cors: Cors): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, name, size, created_at FROM grid_templates ORDER BY id DESC LIMIT 50',
  ).all();
  return json({ data: results }, cors);
}

async function uploadTemplate(request: Request, url: URL, env: GridEnv, cors: Cors): Promise<Response> {
  const name = (url.searchParams.get('name') ?? '').trim().slice(0, 200) || 'modele.xlsx';
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) return json({ error: 'empty' }, cors, 400);
  if (bytes.byteLength > MAX_TEMPLATE_BYTES) return json({ error: 'template_too_large', max: MAX_TEMPLATE_BYTES }, cors, 413);
  // An .xlsx is a zip: refuse anything else before it becomes every new shift's workbook.
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return json({ error: 'not_xlsx' }, cors, 400);
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM grid_templates').first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_TEMPLATES) return json({ error: 'too_many_templates', max: MAX_TEMPLATES }, cors, 409);
  const row = await env.DB.prepare(
    'INSERT INTO grid_templates (name, bytes, size, created_at) VALUES (?1, ?2, ?3, ?4) RETURNING id',
  )
    .bind(name, bytes, bytes.byteLength, Date.now())
    .first<{ id: number }>();
  return json({ id: row?.id ?? null }, cors);
}

async function getTemplate(url: URL, env: GridEnv, cors: Cors): Promise<Response> {
  const id = Number(url.searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'invalid_params' }, cors, 400);
  const row = await env.DB.prepare('SELECT name, bytes FROM grid_templates WHERE id = ?1')
    .bind(id)
    .first<{ name: string; bytes: ArrayBuffer | number[] }>();
  if (!row) return json({ error: 'not_found' }, cors, 404);
  const body = row.bytes instanceof ArrayBuffer ? row.bytes : new Uint8Array(row.bytes);
  return new Response(body, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // A template id never changes content: uploading makes a new id.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Template-Name': encodeURIComponent(row.name),
      'Access-Control-Expose-Headers': 'X-Template-Name',
      ...cors,
    },
  });
}

async function getDoc(url: URL, env: GridEnv, cors: Cors): Promise<Response> {
  const p = partition(url);
  if (!p) return json({ error: 'invalid_params' }, cors, 400);
  const since = Math.max(0, Number(url.searchParams.get('since') ?? 0) || 0);

  let doc = await env.DB.prepare('SELECT template_id FROM grid_docs WHERE date = ?1 AND poste = ?2')
    .bind(p.date, p.poste)
    .first<{ template_id: number }>();
  if (!doc) {
    // First open of this shift's workbook: it starts from the newest template
    // and keeps it. `OR IGNORE` because two tablets can open it at once.
    const latest = await latestTemplateId(env);
    if (latest === null) return json({ template_id: null, seq: 0, changes: [] }, cors);
    await env.DB.prepare('INSERT OR IGNORE INTO grid_docs (date, poste, template_id, created_at) VALUES (?1, ?2, ?3, ?4)')
      .bind(p.date, p.poste, latest, Date.now())
      .run();
    doc = await env.DB.prepare('SELECT template_id FROM grid_docs WHERE date = ?1 AND poste = ?2')
      .bind(p.date, p.poste)
      .first<{ template_id: number }>();
  }

  const { results } = await env.DB.prepare(
    `SELECT sheet, cell, content, seq, client FROM grid_cells
     WHERE date = ?1 AND poste = ?2 AND seq > ?3 ORDER BY seq LIMIT ${PAGE}`,
  )
    .bind(p.date, p.poste, since)
    .all<{ sheet: string; cell: string; content: string | null; seq: number; client: string }>();
  const changes = results.map((r) => ({
    sheet: r.sheet,
    cell: r.cell,
    c: r.content === null ? null : JSON.parse(r.content),
    seq: r.seq,
    client: r.client,
  }));
  const seq = changes.length ? changes[changes.length - 1].seq : since;
  return json({ template_id: doc?.template_id ?? null, seq, changes, more: changes.length === PAGE }, cors);
}

const CONTENT_KEYS = new Set(['f', 'a', 'v', 's']);

/** The change as stored (its content JSON, null for an emptied cell), or
 * undefined when it isn't one GridCraft could have sent. */
function storedContent(x: unknown): string | null | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const { sheet, cell, c } = x as Change;
  if (typeof sheet !== 'string' || sheet.length === 0 || sheet.length > 64) return undefined;
  if (typeof cell !== 'string' || !CELL_RE.test(cell)) return undefined;
  if (c === null || c === undefined) return null;
  // Every device replays what is stored here: a content GridCraft can't read
  // must not reach them.
  if (typeof c !== 'object' || Array.isArray(c) || !Object.keys(c).every((k) => CONTENT_KEYS.has(k))) return undefined;
  const content = JSON.stringify(c);
  return content.length > MAX_CONTENT_BYTES ? undefined : content;
}

async function postDoc(request: Request, url: URL, env: GridEnv, cors: Cors): Promise<Response> {
  const p = partition(url);
  if (!p) return json({ error: 'invalid_params' }, cors, 400);
  const body = (await readJson(request)) as { client?: unknown; changes?: unknown } | undefined;
  if (!body || typeof body.client !== 'string' || !Array.isArray(body.changes)) {
    return json({ error: 'expected_client_and_changes' }, cors, 400);
  }
  const client = body.client.slice(0, 64);
  const changes = body.changes;
  if (changes.length > MAX_CHANGES) return json({ error: 'too_many_changes', max: MAX_CHANGES }, cors, 413);

  const now = Date.now();
  // One statement per cell, in one batch: D1 runs a batch as a transaction and
  // writers one at a time, so each statement's MAX(seq)+1 is a fresh, strictly
  // increasing number — the order every device will apply these writes in.
  const stmt = env.DB.prepare(
    `INSERT INTO grid_cells (date, poste, sheet, cell, content, seq, client, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5,
       (SELECT COALESCE(MAX(seq), 0) + 1 FROM grid_cells WHERE date = ?1 AND poste = ?2), ?6, ?7)
     ON CONFLICT (date, poste, sheet, cell) DO UPDATE SET
       content = excluded.content, seq = excluded.seq, client = excluded.client, updated_at = excluded.updated_at
     RETURNING seq`,
  );
  // A cell refused gets a null seq and the others are stored: one bad cell
  // never holds back the rest of an edit.
  const statements: D1PreparedStatement[] = [];
  const at: number[] = [];
  changes.forEach((ch, i) => {
    const content = storedContent(ch);
    if (content === undefined) return;
    const { sheet, cell } = ch as Change;
    statements.push(stmt.bind(p.date, p.poste, sheet, cell, content, client, now));
    at.push(i);
  });
  const seqs: (number | null)[] = changes.map(() => null);
  if (statements.length) {
    const results = await env.DB.batch<{ seq: number }>(statements);
    results.forEach((r, j) => (seqs[at[j]] = r.results[0]?.seq ?? null));
  }
  return json({ seqs }, cors);
}

async function putDocTemplate(request: Request, url: URL, env: GridEnv, cors: Cors): Promise<Response> {
  const p = partition(url);
  if (!p) return json({ error: 'invalid_params' }, cors, 400);
  const body = (await readJson(request)) as { template_id?: unknown } | undefined;
  const id = Number(body?.template_id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'invalid_template_id' }, cors, 400);
  const exists = await env.DB.prepare('SELECT 1 AS ok FROM grid_templates WHERE id = ?1').bind(id).first();
  if (!exists) return json({ error: 'not_found' }, cors, 404);
  await env.DB.prepare(
    `INSERT INTO grid_docs (date, poste, template_id, created_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (date, poste) DO UPDATE SET template_id = excluded.template_id`,
  )
    .bind(p.date, p.poste, id, Date.now())
    .run();
  return json({ template_id: id }, cors);
}

export async function handleGrid(request: Request, url: URL, env: GridEnv, cors: Cors): Promise<Response> {
  const route = `${request.method} ${url.pathname}`;
  switch (route) {
    case 'GET /api/grid/templates':
      return listTemplates(env, cors);
    case 'POST /api/grid/templates':
      return uploadTemplate(request, url, env, cors);
    case 'GET /api/grid/template':
      return getTemplate(url, env, cors);
    case 'GET /api/grid/doc':
      return getDoc(url, env, cors);
    case 'POST /api/grid/doc':
      return postDoc(request, url, env, cors);
    case 'PUT /api/grid/doc/template':
      return putDocTemplate(request, url, env, cors);
    default:
      return json({ error: url.pathname.startsWith('/api/grid/') ? 'method_not_allowed' : 'not_found' }, cors, 405);
  }
}
