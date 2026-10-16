// The Suivi assistant: Claude, paid by the server's API key, for the operators
// on the tablets (worker/src/mcp/assist.ts, reached through POST
// /api/grid/assist). It proposes; the operator accepts; the cells it proposed
// are written here as this device's own edits (sharedGrid.write).

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
