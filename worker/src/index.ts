// Working Book API. Three domains, each stored as a JSON blob keyed by its
// natural partition. The front owns conflict resolution (last-write-wins);
// the Worker is a thin persistence layer.

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS?: string;
}

const MAX_BODY_BYTES = 512 * 1024;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const POSTE_RE = /^[ABCD]$/;
const SHIFT_RE = /^[MANR]$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(env, origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    try {
      switch (url.pathname) {
        case '/api/health':
          return json({ ok: true }, cors);
        case '/api/logbook':
          return await handleLogbook(request, url, env, cors);
        case '/api/prodtest':
          return await handleProdTest(request, url, env, cors);
        case '/api/suivi':
          return await handleSuivi(request, env, cors);
        default:
          return json({ error: 'not_found' }, cors, 404);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json({ error: 'internal_error', message }, cors, 500);
    }
  },
} satisfies ExportedHandler<Env>;

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  const raw = (env.ALLOWED_ORIGINS ?? '').trim();
  const wildcard = raw === '*';
  const allowed = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const allowOrigin = wildcard
    ? '*'
    : origin && allowed.includes(origin)
      ? origin
      : allowed[0] ?? 'null';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data: unknown, cors: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

async function readJsonBody(request: Request): Promise<unknown> {
  const lenHeader = request.headers.get('Content-Length');
  if (lenHeader && Number(lenHeader) > MAX_BODY_BYTES) {
    throw new HttpError(413, 'payload_too_large');
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'payload_too_large');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function handleLogbook(
  request: Request,
  url: URL,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const date = url.searchParams.get('date');
  const poste = url.searchParams.get('poste');
  if (!date || !poste) return json({ error: 'missing_params' }, cors, 400);
  if (!ISO_DATE_RE.test(date) || !POSTE_RE.test(poste)) {
    return json({ error: 'invalid_params' }, cors, 400);
  }

  if (request.method === 'GET') {
    const row = await env.DB.prepare(
      'SELECT events_json, updated_at FROM log_events WHERE date = ? AND poste = ?',
    )
      .bind(date, poste)
      .first<{ events_json: string; updated_at: number }>();
    if (!row) return json({ data: null, updated_at: null }, cors);
    return json({ data: JSON.parse(row.events_json), updated_at: row.updated_at }, cors);
  }

  if (request.method === 'PUT') {
    const body = await readJsonBody(request);
    if (!Array.isArray(body)) return json({ error: 'expected_array' }, cors, 400);
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO log_events (date, poste, events_json, updated_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(date, poste) DO UPDATE SET
         events_json = excluded.events_json,
         updated_at = excluded.updated_at`,
    )
      .bind(date, poste, JSON.stringify(body), now)
      .run();
    return json({ ok: true, updated_at: now }, cors);
  }

  return json({ error: 'method_not_allowed' }, cors, 405);
}

async function handleProdTest(
  request: Request,
  url: URL,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const date = url.searchParams.get('date');
  const shift = url.searchParams.get('shift');
  if (!date || !shift) return json({ error: 'missing_params' }, cors, 400);
  if (!ISO_DATE_RE.test(date) || !SHIFT_RE.test(shift)) {
    return json({ error: 'invalid_params' }, cors, 400);
  }

  if (request.method === 'GET') {
    const row = await env.DB.prepare(
      'SELECT state_json, updated_at FROM production_tests WHERE date = ? AND shift_key = ?',
    )
      .bind(date, shift)
      .first<{ state_json: string; updated_at: number }>();
    if (!row) return json({ data: null, updated_at: null }, cors);
    return json({ data: JSON.parse(row.state_json), updated_at: row.updated_at }, cors);
  }

  if (request.method === 'PUT') {
    const body = await readJsonBody(request);
    if (!body || typeof body !== 'object') return json({ error: 'expected_object' }, cors, 400);
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO production_tests (date, shift_key, state_json, updated_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(date, shift_key) DO UPDATE SET
         state_json = excluded.state_json,
         updated_at = excluded.updated_at`,
    )
      .bind(date, shift, JSON.stringify(body), now)
      .run();
    return json({ ok: true, updated_at: now }, cors);
  }

  return json({ error: 'method_not_allowed' }, cors, 405);
}

async function handleSuivi(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  if (request.method === 'GET') {
    const row = await env.DB.prepare(
      'SELECT state_json, updated_at FROM suivi WHERE id = 1',
    ).first<{ state_json: string; updated_at: number }>();
    if (!row) return json({ data: null, updated_at: null }, cors);
    return json({ data: JSON.parse(row.state_json), updated_at: row.updated_at }, cors);
  }

  if (request.method === 'PUT') {
    const body = await readJsonBody(request);
    if (!body || typeof body !== 'object') return json({ error: 'expected_object' }, cors, 400);
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO suivi (id, state_json, updated_at)
       VALUES (1, ?1, ?2)
       ON CONFLICT(id) DO UPDATE SET
         state_json = excluded.state_json,
         updated_at = excluded.updated_at`,
    )
      .bind(JSON.stringify(body), now)
      .run();
    return json({ ok: true, updated_at: now }, cors);
  }

  return json({ error: 'method_not_allowed' }, cors, 405);
}
