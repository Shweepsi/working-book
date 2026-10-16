// The Suivi assistant's workshop vocabulary: rules like "chariot = Frame" or
// "flaquine = A6 - Flaking". The assistant proposes them (worker/src/mcp/
// assist.ts) when an operator asks it to remember something or corrects it;
// a proposed rule waits until someone validates it in the app, then goes into
// every question's prompt, on every tablet.
//
//   GET  /api/grid/assist/lexicon        → { data: [{ id, rule, source, status, created_at }] } pending and active
//   POST /api/grid/assist/lexicon        ← { rule } → { id }   added by hand, active at once
//   PUT  /api/grid/assist/lexicon?id=…   ← { status?, rule? } → { ok }   validate, reject, retire, reword

type Cors = Record<string, string>;

interface LexiconEnv {
  DB: D1Database;
}

export type RuleStatus = 'pending' | 'active' | 'rejected';

export interface Rule {
  id: number;
  rule: string;
  source: string;
  status: RuleStatus;
  created_at: number;
}

export const MAX_RULE = 200;
// Every active rule is in every prompt: a long list costs on each question.
const MAX_ACTIVE = 60;
const MAX_PENDING = 30;
const STATUSES = new Set<RuleStatus>(['pending', 'active', 'rejected']);

const json = (data: unknown, cors: Cors, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors } });

const clean = (s: unknown) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, MAX_RULE) : '');
// The same rule, whatever its quotes, accents, case or punctuation.
const key = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const same = (a: string, b: string) => key(a) === key(b);

/** The validated rules, oldest first: what the assistant is told. */
export async function activeRules(env: LexiconEnv): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT rule FROM assist_lexicon WHERE status = 'active' ORDER BY id LIMIT ?1")
    .bind(MAX_ACTIVE)
    .all<{ rule: string }>();
  return results.map((r) => r.rule);
}

/** A rule the assistant came up with, waiting for validation. Null when it's already known (in any state) or the queue is full. */
export async function proposeRule(env: LexiconEnv, rule: string, source: string): Promise<number | null> {
  const text = clean(rule);
  if (!text) return null;
  const { results } = await env.DB.prepare('SELECT rule, status FROM assist_lexicon').all<{ rule: string; status: string }>();
  if (results.some((r) => same(r.rule, text))) return null;
  if (results.filter((r) => r.status === 'pending').length >= MAX_PENDING) return null;
  const row = await env.DB.prepare('INSERT INTO assist_lexicon (rule, source, status, created_at) VALUES (?1, ?2, ?3, ?4) RETURNING id')
    .bind(text, source.slice(0, 500), 'pending', Date.now())
    .first<{ id: number }>();
  return row?.id ?? null;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function handleLexicon(request: Request, url: URL, env: LexiconEnv, cors: Cors): Promise<Response> {
  if (request.method === 'GET') {
    const { results } = await env.DB.prepare(
      "SELECT id, rule, source, status, created_at FROM assist_lexicon WHERE status IN ('pending', 'active') ORDER BY id",
    ).all<Rule>();
    return json({ data: results }, cors);
  }
  if (request.method === 'POST') {
    const rule = clean((await readBody(request)).rule);
    if (!rule) return json({ error: 'empty_rule' }, cors, 400);
    const active = await activeRules(env);
    if (active.length >= MAX_ACTIVE) return json({ error: 'too_many_rules', max: MAX_ACTIVE }, cors, 409);
    if (active.some((r) => same(r, rule))) return json({ error: 'already_known' }, cors, 409);
    const now = Date.now();
    const row = await env.DB.prepare('INSERT INTO assist_lexicon (rule, source, status, created_at, decided_at) VALUES (?1, ?2, ?3, ?4, ?4) RETURNING id')
      .bind(rule, '', 'active', now)
      .first<{ id: number }>();
    return json({ id: row?.id ?? null }, cors);
  }
  if (request.method === 'PUT') {
    const id = Number(url.searchParams.get('id'));
    if (!Number.isInteger(id) || id <= 0) return json({ error: 'invalid_params' }, cors, 400);
    const body = await readBody(request);
    const status = body.status as RuleStatus | undefined;
    if (status !== undefined && !STATUSES.has(status)) return json({ error: 'invalid_status' }, cors, 400);
    const rule = body.rule === undefined ? undefined : clean(body.rule);
    if (rule === '') return json({ error: 'empty_rule' }, cors, 400);
    if (status === 'active' && (await activeRules(env)).length >= MAX_ACTIVE) return json({ error: 'too_many_rules', max: MAX_ACTIVE }, cors, 409);
    const r = await env.DB.prepare(
      'UPDATE assist_lexicon SET rule = COALESCE(?2, rule), status = COALESCE(?3, status), decided_at = CASE WHEN ?3 IS NULL THEN decided_at ELSE ?4 END WHERE id = ?1',
    )
      .bind(id, rule ?? null, status ?? null, Date.now())
      .run();
    return r.meta.changes ? json({ ok: true }, cors) : json({ error: 'not_found' }, cors, 404);
  }
  return json({ error: 'method_not_allowed' }, cors, 405);
}
