// The Suivi assistant's workshop vocabulary, internal to it: rules like
// "chariot = Frame" or "flaquine = A6 - Flaking" that it learns when an
// operator asks it to remember something or corrects it (worker/src/mcp/
// assist.ts), and that go into every later question's prompt, on every
// tablet, oldest first (the newest wins a contradiction). Nobody manages them
// in the app; past MAX_ACTIVE the oldest is retired. Migration 0007 still says
// pending/rejected: written before the lexicon became internal, and every row
// is inserted with its status.

// The Suivi assistant's workshop vocabulary, internal to it: rules like
// "chariot = Frame" or "flaquine = A6 - Flaking" that it learns when an
// operator asks it to remember something or corrects it (worker/src/mcp/
// assist.ts), and that go into every later question's prompt, on every
// tablet. Nobody manages them in the app; past MAX_ACTIVE, the oldest is
// retired. (Migration 0007 still says pending/rejected: written before the
// lexicon became internal; every row is inserted with its status.)

interface LexiconEnv {
  DB: D1Database;
}

export type RuleStatus = 'active' | 'retired';

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

/** The rules in use, oldest first: what the assistant is told. */
export async function activeRules(env: LexiconEnv): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT rule FROM assist_lexicon WHERE status = 'active' ORDER BY id LIMIT ?1")
    .bind(MAX_ACTIVE)
    .all<{ rule: string }>();
  return results.map((r) => r.rule);
}

/** A rule the assistant learned: in use at once. Null when it already knows it. */
export async function learnRule(env: LexiconEnv, rule: string, source: string): Promise<number | null> {
  const text = clean(rule);
  if (!text) return null;
  const { results } = await env.DB.prepare("SELECT id, rule FROM assist_lexicon WHERE status = 'active' ORDER BY id").all<{ id: number; rule: string }>();
  if (results.some((r) => same(r.rule, text))) return null;
  const now = Date.now();
  if (results.length >= MAX_ACTIVE) {
    await env.DB.prepare("UPDATE assist_lexicon SET status = 'retired', decided_at = ?2 WHERE id = ?1").bind(results[0].id, now).run();
  }
  const row = await env.DB.prepare('INSERT INTO assist_lexicon (rule, source, status, created_at, decided_at) VALUES (?1, ?2, ?3, ?4, ?4) RETURNING id')
    .bind(text, source.slice(0, 500), 'active', now)
    .first<{ id: number }>();
  return row?.id ?? null;
}
