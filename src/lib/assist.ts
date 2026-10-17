// The Suivi assistant: Claude, paid by the server's API key, for the operators
// on the tablets (worker/src/mcp/assist.ts, reached through POST
// /api/grid/assist). It proposes; the operator accepts; the cells it proposed
// are written here as this device's own edits (sharedGrid.write), and the
// shift's session hears what became of them (reportAssistant), so that
// « pareil sur la suivante » or « annule la dernière » make sense to it.

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

/** The shift's summary, always in this shape (worker/src/assistTypes.ts). */
export interface AssistBilan {
  resume: string;
  poste: { dl_lites: number; dl_m2: number; fl_lites: number; fl_m2: number; rejets_lites: number; rejets_m2: number; delta_lites: number; delta_m2: number };
  couleurs: { couleur: string; dl_lites: number; fl_lites: number; rejets_lites: number; delta_lites: number }[];
  defauts: { defaut: string; lites: number }[];
  anomalies: string[];
  incompletes: string[];
  restes: string[];
  surveiller: string[];
}

export interface AssistReply {
  ok: boolean;
  error?: string;
  /** This exchange, for reportAssistant. */
  id?: string;
  /** saisie, controle: one sentence; bilan: the summary as plain text, for the clipboard. */
  text?: string;
  /** bilan: the summary, structured; laid out the same way every time. */
  bilan?: AssistBilan;
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
