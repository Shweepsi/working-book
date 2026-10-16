// The Suivi assistant: Claude, paid by the server's API key, for the operators
// on the tablets (worker/src/mcp/assist.ts, reached through POST
// /api/grid/assist). It proposes; the operator accepts; the cells it proposed
// are written here as this device's own edits (sharedGrid.write), and the
// shift's session hears what became of them (reportAssistant), so that
// « pareil sur la suivante » or « annule la dernière » make sense to it. Its
// workshop vocabulary (worker/src/lexicon.ts) is managed here too.

import { API_BASE } from './api';
import type { CellChange, Partition } from './sharedGrid';

export type AssistMode = 'saisie' | 'controle' | 'bilan';

/** One cell to write (or a remark, `after` null), as worker/src/assistTypes.ts has it. */
export interface AssistItem {
  cell: string;
  label: string;
  before: string;
  after: string | null;
  note?: string;
  ok: boolean;
}

export interface AssistReply {
  ok: boolean;
  error?: string;
  /** This exchange, for reportAssistant. */
  id?: string;
  /** A vocabulary rule Claude proposed, waiting for validation. */
  rule?: string;
  text?: string;
  question?: string;
  items?: AssistItem[];
  changes?: CellChange[];
  undo?: CellChange[];
}

export const cellKey = (c: CellChange) => `${c.sheet}!${c.cell}`;

export async function askAssistant(p: Partition, mode: AssistMode, text: string, signal?: AbortSignal): Promise<AssistReply> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/grid/assist?date=${p.date}&poste=${p.poste}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, text }),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    return { ok: false, error: navigator.onLine ? 'Le serveur ne répond pas : réessaie dans un instant.' : 'Pas de réseau : l’assistant a besoin d’Internet.' };
  }
  const body = (await res.json().catch(() => null)) as AssistReply | null;
  if (body && typeof body.ok === 'boolean') return body;
  if (res.status === 404 || res.status === 405) return { ok: false, error: 'L’assistant n’est pas encore installé sur ce serveur.' };
  return { ok: false, error: `Le serveur a répondu ${res.status}.` };
}

/** What became of a proposal, for the shift's memory. Best effort: losing it only costs that memory. */
export function reportAssistant(p: Partition, id: string | undefined, outcome: 'valide' | 'annule', cells?: string[]): void {
  if (!id) return;
  void fetch(`${API_BASE}/api/grid/assist?date=${p.date}&poste=${p.poste}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'retour', id, outcome, cells }),
    keepalive: true,
  }).catch(() => undefined);
}

// --- The workshop's vocabulary -----------------------------------------------------

export interface Rule {
  id: number;
  rule: string;
  source: string;
  status: 'pending' | 'active' | 'rejected';
  created_at: number;
}

const LEXICON = () => `${API_BASE}/api/grid/assist/lexicon`;

async function lexiconCall(url: string, init?: RequestInit): Promise<unknown> {
  const r = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } });
  const body = (await r.json().catch(() => null)) as { error?: string } | null;
  if (!r.ok) {
    const why: Record<string, string> = { too_many_rules: 'Trop de règles actives : retires-en une d’abord.', already_known: 'Cette règle existe déjà.', empty_rule: 'La règle est vide.' };
    throw new Error(why[body?.error ?? ''] ?? `Le serveur a répondu ${r.status}.`);
  }
  return body;
}

export async function listRules(): Promise<Rule[]> {
  return ((await lexiconCall(LEXICON())) as { data: Rule[] }).data;
}

export async function addRule(rule: string): Promise<void> {
  await lexiconCall(LEXICON(), { method: 'POST', body: JSON.stringify({ rule }) });
}

export async function updateRule(id: number, patch: { status?: Rule['status']; rule?: string }): Promise<void> {
  await lexiconCall(`${LEXICON()}?id=${id}`, { method: 'PUT', body: JSON.stringify(patch) });
}
