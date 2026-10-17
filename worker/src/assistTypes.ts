// The Suivi assistant (worker/src/mcp/assist.ts), as the API's Worker reaches
// it: POST /api/grid/assist goes to the MCP server's Worker over a service
// binding (an RPC entrypoint, never on the internet), which has GridCraft's
// engine and the Claude API key.

export type AssistMode = 'saisie' | 'controle' | 'bilan';

export interface AssistRequest {
  date: string;
  poste: string;
  mode: AssistMode;
  /** saisie: what the operator typed or dictated. */
  text?: string;
}

/** One cell of a proposal (saisie, or a correction from controle), or a remark (`after` null). */
export interface AssistItem {
  /** "Suivi!S12" */
  cell: string;
  /** "Ligne 12 · FL · Défaut" */
  label: string;
  before: string;
  after: string | null;
  /** Why it can't be written, or the remark itself. */
  note?: string;
  /** It can be written: its content is in `changes`. */
  ok: boolean;
}

export interface AssistCell {
  sheet: string;
  cell: string;
  c: unknown;
}

/** The shift's summary, always in this shape: the app lays it out the same way every time. */
export interface AssistBilan {
  /** One sentence: the shift, its colours, the essential. */
  resume: string;
  /** Rapport's POSTE table: lites and m², begin/end of line, rejects, delta. */
  poste: { dl_lites: number; dl_m2: number; fl_lites: number; fl_m2: number; rejets_lites: number; rejets_m2: number; delta_lites: number; delta_m2: number };
  /** Rapport's COULEUR table, in lites. */
  couleurs: { couleur: string; dl_lites: number; fl_lites: number; rejets_lites: number; delta_lites: number }[];
  /** Rejects per defect, as counted in Suivi, largest first. */
  defauts: { defaut: string; lites: number }[];
  /** One short sentence each; empty when there is nothing to say. */
  anomalies: string[];
  incompletes: string[];
  restes: string[];
  surveiller: string[];
}

export interface AssistReply {
  ok: boolean;
  error?: string;
  /** This exchange, in the shift's memory: what the app reports back about (AssistFeedback). */
  id?: string;
  /** saisie, controle: one sentence; bilan: the summary as plain text (clipboard, MCP clients). */
  text?: string;
  /** bilan: the summary, structured. */
  bilan?: AssistBilan;
  /** saisie: Claude needs to know more before proposing anything. */
  question?: string;
  items?: AssistItem[];
  /** The items' cells as GridCraft shares them, to write as the operator's own edits. */
  changes?: AssistCell[];
  /** What those cells held before, to take the edit back. */
  undo?: AssistCell[];
}

/** What became of a proposal: the operator wrote it (`cells`, those they kept) or took it back. */
export interface AssistFeedback {
  date: string;
  poste: string;
  id: string;
  outcome: 'valide' | 'annule';
  cells?: string[];
}

export interface AssistService {
  run(req: AssistRequest): Promise<AssistReply>;
  feedback(f: AssistFeedback): Promise<{ ok: boolean }>;
}
