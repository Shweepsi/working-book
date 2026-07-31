// Working Book API. Three domains, each stored as a JSON blob keyed by its
// natural partition. The front owns conflict resolution (last-write-wins);
// the Worker is a thin persistence layer.

import { mergePMS230, parsePMS230, type PMS230Result } from '../../src/lib/pms230Parser';

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS?: string;
  // Extra origins allowed to reach the ingest endpoint. The "Import direct"
  // bookmarklet runs inside the Infor portal, so its Origin is never the app's
  // own — see DEFAULT_INGEST_ORIGINS.
  INGEST_ORIGINS?: string;
}

const MAX_BODY_BYTES = 512 * 1024;
// A full Ctrl+A of an Operator Mashup page runs well past the 512 KB the JSON
// blobs are held to — the dump carries the whole page's chrome, not just the
// grid rows the parser keeps.
const INGEST_MAX_BODY_BYTES = 4 * 1024 * 1024;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const POSTE_RE = /^[ABCD]$/;
const SHIFT_RE = /^[MANR]$/;

const INGEST_PATH = '/api/schedules/ingest';
// Every Infor CloudSuite tenant lives under this domain, portal and embedded
// M3 host alike, and the bookmarklet may run from either.
const DEFAULT_INGEST_ORIGINS = '*.inforcloudsuite.com';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);
    // CORS is per-path: only the ingest endpoint answers to the Infor origins,
    // so widening it doesn't hand the portal the read/write API as well.
    const cors =
      url.pathname === INGEST_PATH
        ? corsHeaders(env, origin, {
            extraOrigins: splitPatterns(env.INGEST_ORIGINS ?? DEFAULT_INGEST_ORIGINS),
            methods: 'POST, OPTIONS',
          })
        : corsHeaders(env, origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

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
        case '/api/policy':
          return await handlePolicy(request, env, cors);
        case '/api/schedules':
          return await handleSchedules(request, env, cors);
        case INGEST_PATH:
          return await handleSchedulesIngest(request, env, cors);
        default:
          return json({ error: 'not_found' }, cors, 404);
      }
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, cors, err.status);
      const message = err instanceof Error ? err.message : String(err);
      return json({ error: 'internal_error', message }, cors, 500);
    }
  },
} satisfies ExportedHandler<Env>;

function originAllowed(patterns: string[], origin: string): boolean {
  return patterns.some((p) => {
    if (p === '*') return true;
    if (p.startsWith('*.')) return origin.endsWith(p.slice(1)); // *.foo.dev → .foo.dev
    return origin === p;
  });
}

function splitPatterns(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

interface CorsOptions {
  extraOrigins?: string[];
  methods?: string;
  headers?: string;
}

function corsHeaders(env: Env, origin: string | null, opts: CorsOptions = {}): Record<string, string> {
  const patterns = [...splitPatterns(env.ALLOWED_ORIGINS), ...(opts.extraOrigins ?? [])];
  const allowOrigin =
    origin && originAllowed(patterns, origin) ? origin : (patterns[0] ?? 'null');
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': opts.methods ?? 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': opts.headers ?? 'Content-Type',
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

async function readJsonBody(request: Request, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const lenHeader = request.headers.get('Content-Length');
  if (lenHeader && Number(lenHeader) > maxBytes) {
    throw new HttpError(413, 'payload_too_large');
  }
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'payload_too_large');
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

// PMS230 schedule report — singleton, gated by the user's local/sync mode.
// Same wire shape as suivi.
async function handleSchedules(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  if (request.method === 'GET') {
    const row = await env.DB.prepare(
      'SELECT state_json, updated_at FROM schedules WHERE id = 1',
    ).first<{ state_json: string; updated_at: number }>();
    if (!row) return json({ data: null, updated_at: null }, cors);
    return json({ data: JSON.parse(row.state_json), updated_at: row.updated_at }, cors);
  }

  if (request.method === 'PUT') {
    const body = await readJsonBody(request);
    if (body !== null && typeof body !== 'object') return json({ error: 'expected_object_or_null' }, cors, 400);
    const now = await writeSchedules(env, body);
    return json({ ok: true, updated_at: now }, cors);
  }

  return json({ error: 'method_not_allowed' }, cors, 405);
}

async function readSchedules(env: Env): Promise<PMS230Result | null> {
  const row = await env.DB.prepare(
    'SELECT state_json FROM schedules WHERE id = 1',
  ).first<{ state_json: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.state_json) as PMS230Result | null;
  } catch {
    // A corrupt blob shouldn't block a fresh import — treat it as empty and let
    // the incoming report overwrite it.
    return null;
  }
}

async function writeSchedules(env: Env, value: unknown): Promise<number> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO schedules (id, state_json, updated_at)
     VALUES (1, ?1, ?2)
     ON CONFLICT(id) DO UPDATE SET
       state_json = excluded.state_json,
       updated_at = excluded.updated_at`,
  )
    .bind(JSON.stringify(value), now)
    .run();
  return now;
}

// Direct import from the Infor portal. The "Import direct" bookmarklet and the
// browser extension both post the raw Operator Mashup text here; we run it
// through the very same parser the paste sheet uses, so no route can drift from
// the others, and merge the result into the shared report.
//
// Every import adds. There is no replace: an operator walking a multi-page
// report, or re-importing after a fresh search, only ever wants more rows —
// and `mergePMS230` keys on schedule|MO, so re-sending the same page updates
// those rows in place instead of duplicating them. Removing a schedule is a
// deliberate act, done from the Schedule tab.
async function handleSchedulesIngest(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, cors, 405);

  const body = await readJsonBody(request, INGEST_MAX_BODY_BYTES);
  if (!body || typeof body !== 'object') return json({ error: 'expected_object' }, cors, 400);
  const { text } = body as { text?: unknown };
  if (typeof text !== 'string' || !text.trim()) return json({ error: 'missing_text' }, cors, 400);

  const parsed = parsePMS230(text);
  if (parsed.records.length === 0) {
    // Text arrived but no row survived decoding — usually the wrong screen, or
    // a search that returned nothing. Say so rather than touching the report.
    return json({ error: 'no_records', warnings: parsed.warnings.slice(0, 10) }, cors, 422);
  }

  const merged = mergePMS230(await readSchedules(env), parsed);
  const updatedAt = await writeSchedules(env, merged);

  return json(
    {
      ok: true,
      imported: parsed.records.length,
      records: merged.records.length,
      schedules: merged.schedules.length,
      warnings: parsed.warnings.length,
      updated_at: updatedAt,
    },
    cors,
  );
}

// MTO/MTS policy — singleton lookup table shared across every client. Same
// shape as suivi (no params, body is the parsed PolicyResult).
async function handlePolicy(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  if (request.method === 'GET') {
    const row = await env.DB.prepare(
      'SELECT state_json, updated_at FROM policy WHERE id = 1',
    ).first<{ state_json: string; updated_at: number }>();
    if (!row) return json({ data: null, updated_at: null }, cors);
    return json({ data: JSON.parse(row.state_json), updated_at: row.updated_at }, cors);
  }

  if (request.method === 'PUT') {
    const body = await readJsonBody(request);
    if (!body || typeof body !== 'object') return json({ error: 'expected_object' }, cors, 400);
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO policy (id, state_json, updated_at)
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
