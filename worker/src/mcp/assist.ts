// The Suivi assistant: Claude for the operators on the tablets, who have no
// Claude account of their own. Paid by the API key the Worker holds
// (ANTHROPIC_API_KEY, the monthly API credits of the Max plan), reached from
// the app through the API's Worker (POST /api/grid/assist).
//
//   saisie    what the operator typed or dictated → the cells to fill, checked
//             here in GridCraft's engine (lists, protected cells) and handed
//             back with their shared content: the app writes them as the
//             operator's own edits once they say so.
//   controle  what looks wrong in the shift before the handover, with the
//             corrections that are certain, written the same way.
//   bilan     the shift's summary for the next team, from Rapport's results.
//
// Claude sees the workbook as this module writes it out (snapshot), not
// through tools: one request per question, a few seconds on a tablet. It also
// gets the shift's last exchanges with it (kept by the shift's session, so
// "pareil sur la suivante" or "annule la dernière" make sense) and the
// workshop's validated vocabulary (lexicon.ts), which it proposes rules for.

import type { AssistItem, AssistMode, AssistReply } from '../assistTypes';
import type { CellChange, Workbook } from './engine';

export interface AssistEnv {
  ANTHROPIC_API_KEY?: string;
  /** Vérifier and Bilan (Claude Sonnet 5.5 by default). */
  ASSIST_MODEL?: string;
  /** Saisir (Claude Haiku 5.5 by default): short, frequent, cheap. */
  ASSIST_MODEL_SAISIE?: string;
  /** low, medium, high… (DEFAULT_EFFORT otherwise). */
  ASSIST_EFFORT?: string;
  /** The `thinking` type, e.g. "between_tools"; the model's default otherwise. */
  ASSIST_THINKING?: string;
}

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const DEFAULT_MODEL_SAISIE = 'claude-haiku-5-5';
const DEFAULT_EFFORT = 'medium';
// $ per million tokens: input, output, cache read, cache write. For the log only.
const PRICES: Record<string, [number, number, number, number]> = {
  'claude-sonnet-5-5': [2, 10, 0.1, 2.5],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
  'claude-opus-5-5': [4, 20, 0.2, 5],
};
export const MAX_TEXT = 2_000;
// Suivi's data rows, and its two sides (row 2 holds the headers).
const FIRST_ROW = 3;
const LAST_ROW = 100;
const DL = { from: 1, to: 11, name: 'DL' }; // B..L, Début de Ligne
const FL = { from: 13, to: 26, name: 'FL' }; // N..AA, Fin de Ligne
// The two cells of Rapport an operator fills.
const RAPPORT_INPUTS: Record<string, string> = { C2: 'couleur étudiée', F2: 'défaut compté par dimension' };
// Lists the template checks with literal values (the others come from the workbook).
const LITERAL_LISTS: Record<string, string[]> = { G: ['PSI', 'PSO'], H: ['NON', 'OUI'] };
const DEFECT_COLS = new Set(['S', 'V', 'Y']);
const DEFECT_FROM = 18; // S

export class AssistError extends Error {}

/** One exchange of the shift with the assistant, kept by its session (session.ts). */
export interface Exchange {
  id: string;
  at: number;
  mode: AssistMode;
  ask: string;
  question?: string;
  cells: { cell: string; before: string; after: string }[];
  /** propose: shown, not written (yet); valide: written (`kept`: the cells kept, when not all); annule: written, then taken back. */
  outcome: 'propose' | 'valide' | 'annule';
  kept?: string[];
}

export interface Memory {
  history: Exchange[];
  /** The workshop's validated rules. */
  lexicon: string[];
}

const clock = (t: number) => new Date(t).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });

/** The shift's last exchanges, as Claude reads them. */
function historyText(history: Exchange[]): string {
  if (!history.length) return 'Aucun échange précédent avec toi sur ce poste.';
  const lines = history.map((x) => {
    const head = `- ${clock(x.at)}, ${x.mode === 'controle' ? 'vérification du poste' : `demande « ${x.ask} »`}`;
    if (x.question && !x.cells.length) return `${head} → tu as demandé : « ${x.question} »`;
    const cells = x.cells.map((c) => `${c.cell} ${c.before ? `« ${c.before} »` : 'vide'} → ${c.after ? `« ${c.after} »` : 'vide'}`).join(', ');
    const fate =
      x.outcome === 'valide'
        ? x.kept && x.kept.length < x.cells.length
          ? `écrit en partie (${x.kept.join(', ')})`
          : 'écrit dans le classeur'
        : x.outcome === 'annule'
          ? 'écrit puis annulé par l’opérateur'
          : 'pas écrit (l’opérateur n’a pas validé)';
    return `${head} → proposé : ${cells || 'rien'} → ${fate}.`;
  });
  return `Échanges précédents de ce poste avec toi, du plus ancien au plus récent :\n${lines.join('\n')}`;
}

// --- The engine ------------------------------------------------------------

interface ToolOut {
  result: unknown;
  text: string;
  isError: boolean;
  changes: CellChange[];
}

/** One GridCraft tool on the shift's workbook; `keep` commits what it did, otherwise it's taken back. */
function tool(book: Workbook, name: string, args: Record<string, unknown>, keep = false): ToolOut {
  const out = book.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  const reply = out.response ? (JSON.parse(out.response) as { result?: { content?: { text?: string }[]; isError?: boolean }; error?: { message?: string } }) : null;
  const text = reply?.result?.content?.[0]?.text ?? reply?.error?.message ?? '';
  const isError = !reply?.result || !!reply.result.isError || out.structural || out.lost;
  if (keep && !isError) book.commit();
  else book.rollback();
  let result: unknown = text;
  try {
    result = JSON.parse(text);
  } catch {
    // Plain text.
  }
  return { result, text, isError, changes: out.changes };
}

const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
const colIndex = (s: string): number => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

function readRange(book: Workbook, range: string): unknown[][] {
  const r = tool(book, 'read_range', { range });
  if (r.isError) throw new Error(`lecture ${range} : ${r.text}`);
  return ((r.result as { values?: unknown[][] }).values ?? []) as unknown[][];
}

/** Excel's 1900 serial → jj/mm/aa. */
function dayText(serial: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}/${two(d.getUTCFullYear() % 100)}`;
}

/** The template's `EstCouleur`: a text that doesn't start with a number names a colour (a block of lines). */
function isColour(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const head = v.slice(0, 3).trim();
  return head !== '' && Number.isNaN(Number(head.replace(',', '.')));
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const words = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** The list entry `typed` points to, like GridCraft's drop-downs: every word typed starts a word of the entry, and only one entry fits. */
function listEntry(typed: string, entries: string[]): string | null {
  const exact = entries.find((e) => fold(e) === fold(typed.trim()));
  if (exact) return exact;
  const want = words(typed);
  if (!want.length) return null;
  const fits = entries.filter((e) => {
    const have = words(e);
    return want.every((w) => have.some((h) => h.startsWith(w)));
  });
  return fits.length === 1 ? fits[0] : null;
}

/** What Claude is told about the workbook, and what this module needs to check its answers. */
interface Sheet {
  text: string;
  headers: string[];
  formulaCols: Set<string>;
  dateCols: Set<string>;
  defects: string[];
  colours: string[];
  /** Cells the template's validations refuse, as GridCraft circles them. */
  invalid: string[];
}

function display(v: unknown, col: string, dateCols: Set<string>): string {
  if (typeof v === 'number') return dateCols.has(col) ? dayText(v) : String(Math.round(v * 1000) / 1000);
  if (typeof v === 'boolean') return v ? 'VRAI' : 'FAUX';
  return JSON.stringify(v);
}

function cellsOf(book: Workbook, sheet: string): string[] {
  tool(book, 'select', { range: `${sheet}!A1` }, true);
  const r = tool(book, 'execute_command', { command: 'data.circleInvalid', params: {} });
  const list = (r.result as { invalid?: unknown[] })?.invalid ?? [];
  return list.map((c) => `${sheet}!${typeof c === 'string' ? c : ((c as { cell?: string }).cell ?? JSON.stringify(c))}`);
}

export function snapshot(book: Workbook, part: { date: string; poste: string }): Sheet {
  const rows = readRange(book, `Suivi!A1:AA${LAST_ROW}`);
  const headers = (rows[1] ?? []).map((h) => (typeof h === 'string' ? h.trim() : ''));
  const formulaCols = new Set<string>();
  const dateCols = new Set<string>();
  for (const side of [DL, FL]) {
    for (let c = side.from; c <= side.to; c++) {
      const col = colName(c);
      const g = tool(book, 'get_cell', { cell: `Suivi!${col}${LAST_ROW}` }).result as { formula?: string | null; style?: { num_fmt?: string } };
      if (g?.formula) formulaCols.add(col);
      if (/d/i.test(g?.style?.num_fmt ?? '') && /y/i.test(g?.style?.num_fmt ?? '')) dateCols.add(col);
    }
  }

  const lines: string[] = [];
  const blocks: Record<string, string[]> = { DL: [], FL: [] };
  const last: Record<string, number> = { DL: FIRST_ROW - 1, FL: FIRST_ROW - 1 };
  const colours: string[] = [];
  for (let r = FIRST_ROW; r <= LAST_ROW; r++) {
    const row = rows[r - 1] ?? [];
    const parts: string[] = [];
    for (const side of [DL, FL]) {
      const filled = [];
      let typed = false;
      for (let c = side.from; c <= side.to; c++) {
        const v = row[c];
        if (v === null || v === undefined || v === '') continue;
        const col = colName(c);
        if (!formulaCols.has(col)) typed = true;
        filled.push(`${col}=${display(v, col, dateCols)}`);
      }
      if (!typed) continue;
      last[side.name] = r;
      parts.push(`${side.name}: ${filled.join(' ')}`);
      const tag = row[side.from];
      if (isColour(tag)) {
        blocks[side.name].push(`L${r} « ${tag} »`);
        if (side === FL && !colours.includes(tag)) colours.push(tag);
      }
    }
    if (parts.length) lines.push(`L${r}  ${parts.join('  |  ')}`);
  }

  const report = readRange(book, 'Rapport!A1:L24');
  const reportLines: string[] = [];
  report.forEach((row, i) => {
    const cells = row
      .map((v, c) => (v === null || v === undefined || v === '' ? null : `${colName(c)}=${display(v, colName(c), new Set())}`))
      .filter(Boolean);
    if (cells.length) reportLines.push(`R${i + 1}  ${cells.join(' ')}`);
  });
  const defects = report
    .slice(2, 24)
    .map((row) => row[1])
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '');

  const invalid = [...cellsOf(book, 'Suivi'), ...cellsOf(book, 'Rapport')];
  const legend = (side: typeof DL) =>
    Array.from({ length: side.to - side.from + 1 }, (_, i) => {
      const col = colName(side.from + i);
      return `${col} ${headers[side.from + i] || '?'}${formulaCols.has(col) ? ' (formule)' : ''}`;
    }).join(', ');

  const text = [
    `Poste ${part.poste} du ${part.date.split('-').reverse().join('/')}.`,
    `Colonnes de Suivi — DL : ${legend(DL)}. FL : ${legend(FL)}.`,
    `Couleurs présentes en FL (liste de Rapport!C2) : ${colours.length ? colours.map((c) => `« ${c} »`).join(', ') : 'aucune'}.`,
    `Blocs de couleur — DL : ${blocks.DL.join(', ') || 'aucun'} ; FL : ${blocks.FL.join(', ') || 'aucun'}.`,
    `Dernière ligne remplie : DL L${last.DL}, FL L${last.FL}. Première ligne libre après : DL L${last.DL + 1}, FL L${last.FL + 1}.`,
    '',
    `Suivi, lignes remplies (texte entre guillemets, nombres sans ; dates en jj/mm/aa) :`,
    lines.length ? lines.join('\n') : '(aucune ligne remplie)',
    '',
    'Rapport (résultats calculés) :',
    reportLines.join('\n'),
    '',
    `Valeurs refusées par les listes du classeur : ${invalid.length ? invalid.join(', ') : 'aucune'}.`,
  ].join('\n');
  return { text, headers, formulaCols, dateCols, defects, colours, invalid };
}

// --- Checking and writing out Claude's cells -------------------------------

const ADDRESS_RE = /^(?:(Suivi|Rapport)!)?\$?([A-Z]{1,2})\$?(\d{1,3})$/i;

function labelOf(sheet: string, col: string, row: number, s: Sheet): string {
  if (sheet === 'Rapport') return `Rapport · ${RAPPORT_INPUTS[`${col}${row}`] ?? `${col}${row}`}`;
  const i = colIndex(col);
  const side = i >= FL.from ? 'FL' : 'DL';
  // FL's three defects, S/T/U, V/W/X and Y/Z/AA, have the same headers.
  const n = i >= DEFECT_FROM ? ` ${Math.floor((i - DEFECT_FROM) / 3) + 1}` : '';
  return `Ligne ${row} · ${side} · ${s.headers[i] || col}${n}`;
}

/** The list a cell's validation takes its entries from, if any. */
function listOf(sheet: string, col: string, row: number, s: Sheet): string[] | null {
  if (sheet === 'Rapport') return col === 'C' && row === 2 ? s.colours : col === 'F' && row === 2 ? s.defects : null;
  if (DEFECT_COLS.has(col)) return s.defects;
  return LITERAL_LISTS[col] ?? null;
}

function shownText(book: Workbook, ref: string): string {
  const g = tool(book, 'get_cell', { cell: ref }).result as { text?: string; value?: unknown } | string;
  if (typeof g === 'string') return '';
  return g?.text ?? (g?.value === null || g?.value === undefined ? '' : String(g.value));
}

/**
 * Tries each cell in the engine and takes it back: the reply carries, for the
 * cells that pass, what they'll hold (`changes`) and what they held (`undo`).
 */
export function writeOut(
  book: Workbook,
  s: Sheet,
  cells: { cellule?: unknown; valeur?: unknown; note?: unknown }[],
): { items: AssistItem[]; changes: CellChange[]; undo: CellChange[] } {
  const items: AssistItem[] = [];
  const changes: CellChange[] = [];
  const undo: CellChange[] = [];
  const seen = new Set<string>();
  for (const wanted of cells.slice(0, 60)) {
    const m = String(wanted.cellule ?? '').trim().match(ADDRESS_RE);
    const value = wanted.valeur === null || wanted.valeur === undefined ? '' : String(wanted.valeur).trim();
    const remark = typeof wanted.note === 'string' && wanted.note ? wanted.note : undefined;
    if (!m) {
      items.push({ cell: String(wanted.cellule ?? '?'), label: String(wanted.cellule ?? '?'), before: '', after: value, note: 'Adresse de cellule incompréhensible.', ok: false });
      continue;
    }
    const sheet = m[1] ? (m[1].toLowerCase() === 'rapport' ? 'Rapport' : 'Suivi') : 'Suivi';
    const col = m[2].toUpperCase();
    const row = Number(m[3]);
    const ref = `${sheet}!${col}${row}`;
    const item: AssistItem = { cell: ref, label: labelOf(sheet, col, row, s), before: '', after: value, ok: false, ...(remark ? { note: remark } : {}) };
    items.push(item);
    if (seen.has(ref)) {
      item.note = 'Cellule déjà proposée plus haut.';
      continue;
    }
    seen.add(ref);
    const i = colIndex(col);
    const inSuivi = sheet === 'Suivi' && row >= FIRST_ROW && row <= LAST_ROW && ((i >= DL.from && i <= DL.to) || (i >= FL.from && i <= FL.to));
    const inRapport = sheet === 'Rapport' && `${col}${row}` in RAPPORT_INPUTS;
    if (!inSuivi && !inRapport) {
      item.note = 'Hors des cellules de saisie.';
      continue;
    }
    if (sheet === 'Suivi' && s.formulaCols.has(col)) {
      item.note = 'Colonne calculée par une formule.';
      continue;
    }
    item.before = shownText(book, ref);
    let input = value;
    const list = listOf(sheet, col, row, s);
    if (input && list) {
      const entry = listEntry(input, list);
      if (!entry) {
        item.note = `« ${input} » n’est pas dans la liste.`;
        continue;
      }
      input = entry;
    }
    // A date cell takes the date as typed on a tablet (jour d'abord).
    const set = tool(book, 'set_cell', { cell: ref, input }, true);
    if (set.isError) {
      item.note = set.text.slice(0, 200) || 'Refusé par le classeur.';
      continue;
    }
    if (!set.changes.length) {
      item.after = item.before;
      item.note = 'Déjà saisi.';
      continue;
    }
    item.after = shownText(book, ref);
    const back = tool(book, 'undo', {}, true);
    if (back.isError || !back.changes.length) throw new Error(`le classeur n’a pas pu revenir en arrière sur ${ref}`);
    item.ok = true;
    changes.push(...set.changes);
    undo.push(...back.changes);
  }
  return { items, changes, undo };
}

// --- Claude ------------------------------------------------------------------

const ABOUT = `Tu es l'assistant du classeur « Suivi » d'une ligne de production de verre à couches, sur les tablettes de l'atelier. Les opérateurs t'écrivent en français, vite, au clavier ou à la voix : attends-toi aux fautes de frappe et de dictée (« flaquine » pour flaking, « scratch » pour scratches, chiffres en lettres).

Le classeur (un par poste) :
- Feuille Suivi, lignes 3 à 100. À gauche le Début de Ligne (DL, le chargement) : colonnes B à L. À droite la Fin de Ligne (FL, le déchargement) : colonnes N à AA. Les deux côtés sont indépendants : une même ligne du tableau ne parle pas forcément de la même plaque à gauche et à droite.
- Une ligne dont le N° TAG (B côté DL, N côté FL) est un texte au lieu d'un numéro ouvre un bloc : c'est la couleur (le produit) des lignes suivantes, jusqu'à la couleur suivante.
- DL : N° TAG, Lites (nombre de plaques), Dimension, Epaisseur, Origine, Sens (PSI ou PSO), Polishing (NON ou OUI), Date (jj/mm/aa), Consommées, Restantes (formule = Lites − Consommées, on n'y écrit jamais), Commentaires.
- FL : N° TAG, Frame, Dimension, Epaisseur, Lites, puis jusqu'à trois défauts, chacun avec un commentaire et une quantité rejetée : S/T/U, V/W/X, Y/Z/AA. Un défaut s'écrit tel que dans la liste des défauts.
- Feuille Rapport, protégée, calculée : rejets par défaut pour la couleur choisie en C2, rejets par dimension pour le défaut choisi en F2, totaux Lites et m² DL/FL et leur écart (DELTA), totaux par couleur, calculs de vitesse et de temps. Seules C2 et F2 s'y saisissent.`;

const TASKS: Record<AssistMode, string> = {
  saisie: `Ta tâche : traduire la demande de l'opérateur en cellules à remplir.
- Une nouvelle plaque va sur la première ligne libre du côté concerné (donnée dans l'état du classeur), sauf si l'opérateur désigne une ligne existante : par son numéro, son N° TAG, ou « la dernière ».
- Le côté se déduit de ce qui est dit : défauts, quantités rejetées, frame → FL ; consommées, sens, polishing, origine → DL. Lites, dimension, épaisseur, TAG : le côté dont parle l'opérateur.
- Des défauts ou des quantités sans plaque désignée (ni ligne, ni TAG, ni « la dernière », ni données d'une nouvelle plaque) : ne devine pas, demande sur quelle plaque en proposant la dernière plaque FL (sa ligne et son TAG).
- Une nouvelle couleur (« on passe en premium 2 ») s'écrit seule sur la première ligne libre, en N° TAG du côté concerné, sauf si ce bloc est déjà le dernier ouvert de ce côté.
- Valeurs exactes : défauts et couleurs tels que dans les listes, nombres sans unité, dates en jj/mm/aa. Le jour seul ou jour et mois suffisent pour une date : « 15 » ou « 15/10 ».
- N'invente rien. Si la demande est ambiguë (quelle ligne, quel côté, quel défaut ?), ne propose aucune cellule et pose une question courte dans « question ». Sinon « question » reste vide.
- « resume » : une phrase simple qui dit ce qui sera saisi, par exemple « Ligne 14 FL : 3 Flaking et 2 Scratches ».
- Les échanges précédents de ce poste te sont donnés : « pareil », « la même », « la suivante », « encore », « annule la dernière » y renvoient. Une proposition écrite est déjà dans le classeur. Pour défaire une saisie écrite, propose de remettre les valeurs d'avant ; une valeur vide efface la cellule.
- « regle » : si l'opérateur te demande de retenir quelque chose (« retiens que… », « chez nous on dit… »), ou si sa demande corrige ta compréhension d'un mot ou d'une habitude de l'atelier (pas un simple numéro de ligne ou une quantité), écris la règle générale en une phrase courte, par exemple « "chariot" désigne la colonne Frame (FL). » Un responsable la validera avant qu'elle serve. Sinon laisse vide. Une demande qui n'est qu'une règle à retenir ne propose aucune cellule.`,
  controle: `Ta tâche : vérifier le poste avant la relève. Signale seulement de vrais problèmes, chacun sur sa cellule :
- un nombre ou une date tapés comme du texte (valeur entre guillemets dans une colonne de nombres ou de dates) ;
- un défaut sans quantité, une quantité sans défaut, plus de plaques rejetées que de lites sur la ligne ;
- une ligne incomplète : N° TAG sans lites, sans dimension ou sans épaisseur ; côté DL, une plaque sans date ;
- plus de consommées que de lites ;
- un écart DL/FL (DELTA) qui n'est pas nul pour une couleur ou au total ;
- une valeur refusée par les listes du classeur (indiquées dans l'état), en particulier Rapport!C2 et Rapport!F2.
Pour chaque problème : la cellule, une phrase courte et concrète, et dans « correction » la valeur corrigée seulement si elle est certaine, sinon une chaîne vide (« 15/10 » tapé en texte dans la colonne Date → « 15/10/26 » ; un défaut écrit à moitié → son nom exact dans la liste). Rien sur la mise en forme, pas de conseils vagues. Si tout va bien, aucune entrée.`,
  bilan: `Ta tâche : rédiger le bilan du poste pour l'équipe suivante. Texte brut, sans markdown ni titre, 10 lignes au plus, phrases courtes :
- production : lites et m² en début et en fin de ligne, par couleur ;
- rejets : total, principaux défauts avec leurs quantités ;
- écarts DL/FL s'il y en a, lignes incomplètes, points à surveiller.
Seulement les chiffres de Rapport et de Suivi, sans en inventer. Un poste vide se dit en une ligne.`,
};

// What saisie and controle answer, as JSON (structured outputs): every field
// is there, empty when it doesn't apply.
const arrayOf = (item: Record<string, unknown>) => ({ type: 'array', items: { type: 'object', properties: item, required: Object.keys(item), additionalProperties: false } });
const SCHEMAS = {
  saisie: {
    type: 'object',
    properties: {
      resume: { type: 'string', description: 'Ce qui sera saisi, en une phrase.' },
      question: { type: 'string', description: 'Si la demande est ambiguë, la question à poser (alors aucune cellule) ; sinon vide.' },
      regle: { type: 'string', description: 'Une règle de vocabulaire ou d’usage de l’atelier à retenir, seulement si l’opérateur le demande ou corrige ta compréhension ; sinon vide.' },
      cellules: arrayOf({
        cellule: { type: 'string', description: 'Adresse, par exemple "S14" pour Suivi ou "Rapport!C2".' },
        valeur: { type: 'string', description: 'Ce qui s’écrit dans la cellule, tel que dans les listes.' },
      }),
    },
    required: ['resume', 'question', 'regle', 'cellules'],
    additionalProperties: false,
  },
  controle: {
    type: 'object',
    properties: {
      resume: { type: 'string', description: 'Le bilan de la vérification en une phrase.' },
      problemes: arrayOf({
        cellule: { type: 'string', description: 'Adresse, par exemple "I5" pour Suivi ou "Rapport!C2".' },
        message: { type: 'string', description: 'Le problème, en une phrase courte.' },
        correction: { type: 'string', description: 'La valeur corrigée si elle est certaine, sinon vide.' },
      }),
    },
    required: ['resume', 'problemes'],
    additionalProperties: false,
  },
};

interface ClaudeReply {
  content: { type: string; text?: string }[];
  stop_reason?: string;
  usage?: Record<string, number>;
}

async function claude(env: AssistEnv, mode: AssistMode, s: Sheet, ask: string, lexicon: string[]): Promise<ClaudeReply> {
  if (!env.ANTHROPIC_API_KEY) throw new AssistError('L’assistant n’est pas encore configuré (clé API manquante sur le serveur).');
  const model = mode === 'saisie' ? env.ASSIST_MODEL_SAISIE || DEFAULT_MODEL_SAISIE : env.ASSIST_MODEL || DEFAULT_MODEL;
  const body = {
    model,
    // Thinking counts in it, when the model thinks before answering.
    max_tokens: 16_000,
    // The part that doesn't change from one question to the next, cached.
    system: [
      { type: 'text', text: ABOUT },
      {
        type: 'text',
        text: `Liste des défauts : ${s.defects.map((d) => `« ${d} »`).join(', ')}.\n\n${lexicon.length ? `Lexique de l'atelier (règles validées, à appliquer) :\n${lexicon.map((r) => `- ${r}`).join('\n')}\n\n` : ''}${TASKS[mode]}`,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: `État du classeur :\n${s.text}\n\n${ask}` }],
    output_config: {
      effort: env.ASSIST_EFFORT || DEFAULT_EFFORT,
      ...(mode === 'bilan' ? {} : { format: { type: 'json_schema', schema: SCHEMAS[mode] } }),
    },
    // "between_tools": no thinking before the answer (Sonnet 5.5), the fastest.
    ...(env.ASSIST_THINKING ? { thinking: { type: env.ASSIST_THINKING } } : {}),
  };
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AssistError('Claude ne répond pas : réessaie dans un instant.');
  }
  const reply = (await res.json().catch(() => null)) as (ClaudeReply & { error?: { message?: string } }) | null;
  if (!res.ok || !reply) {
    const message = reply?.error?.message ?? `HTTP ${res.status}`;
    console.log(JSON.stringify({ assist: mode, model, status: res.status, error: message }));
    if (/credit balance/i.test(message)) throw new AssistError('Les crédits API du mois sont épuisés : l’assistant revient avec les prochains.');
    if (res.status === 401 || res.status === 403) throw new AssistError('La clé API du serveur est refusée.');
    if (res.status === 429 || res.status >= 500) throw new AssistError('Claude est surchargé : réessaie dans un instant.');
    throw new AssistError(`Claude a refusé la demande (${message.slice(0, 160)}).`);
  }
  const u = reply.usage ?? {};
  const [pi, po, pr, pw] = PRICES[model] ?? PRICES[DEFAULT_MODEL];
  const usd = ((u.input_tokens ?? 0) * pi + (u.output_tokens ?? 0) * po + (u.cache_read_input_tokens ?? 0) * pr + (u.cache_creation_input_tokens ?? 0) * pw) / 1e6;
  console.log(JSON.stringify({ assist: mode, model, ms: Date.now() - started, stop: reply.stop_reason, usage: u, usd: Math.round(usd * 1e5) / 1e5 }));
  if (reply.stop_reason === 'max_tokens') throw new AssistError('Claude n’a pas fini sa réponse : réessaie.');
  return reply;
}

const textOf = (reply: ClaudeReply) => reply.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();

function jsonOf(reply: ClaudeReply): Record<string, unknown> {
  try {
    return JSON.parse(textOf(reply)) as Record<string, unknown>;
  } catch {
    throw new AssistError('Claude n’a pas répondu comme prévu : réessaie.');
  }
}

/** One question to the assistant, on the shift's workbook as it stands. */
export async function assist(env: AssistEnv, book: Workbook, part: { date: string; poste: string }, mode: AssistMode, text: string, memory: Memory): Promise<AssistReply> {
  const s = snapshot(book, part);
  const ask = (q: string) => claude(env, mode, s, q, memory.lexicon);
  if (mode === 'bilan') {
    const reply = await ask('Rédige le bilan du poste.');
    const out = textOf(reply);
    return { ok: true, text: out || 'Rien à dire sur ce poste.' };
  }
  if (mode === 'saisie') {
    const reply = await ask(`${historyText(memory.history)}\n\nDemande de l'opérateur : ${text}`);
    const input = jsonOf(reply);
    const question = typeof input.question === 'string' && input.question.trim() ? input.question.trim() : undefined;
    const rule = typeof input.regle === 'string' && input.regle.trim() ? input.regle.trim() : undefined;
    const cells = Array.isArray(input.cellules) ? (input.cellules as { cellule?: unknown; valeur?: unknown }[]) : [];
    const summary = typeof input.resume === 'string' && input.resume.trim() ? input.resume.trim() : undefined;
    if (!cells.length) return { ok: true, ...(question ? { question } : { text: summary }), ...(rule ? { rule } : {}), items: [] };
    const out = writeOut(book, s, cells);
    return { ok: true, text: summary, ...(question ? { question } : {}), ...(rule ? { rule } : {}), ...out };
  }
  const reply = await ask('Vérifie le poste.');
  const input = jsonOf(reply);
  const found = Array.isArray(input.problemes) ? (input.problemes as { cellule?: unknown; message?: unknown; correction?: unknown }[]) : [];
  const fixes = found.filter((p) => typeof p.correction === 'string' && p.correction.trim());
  const out = writeOut(
    book,
    s,
    fixes.map((p) => ({ cellule: p.cellule, valeur: p.correction, note: p.message })),
  );
  // The remarks without a correction, as items nothing gets written to.
  const remarks: AssistItem[] = found
    .filter((p) => !fixes.includes(p))
    .map((p) => {
      const m = String(p.cellule ?? '').trim().match(ADDRESS_RE);
      const sheet = m?.[1] && m[1].toLowerCase() === 'rapport' ? 'Rapport' : 'Suivi';
      const ref = m ? `${sheet}!${m[2].toUpperCase()}${m[3]}` : String(p.cellule ?? '');
      return {
        cell: ref,
        label: m ? labelOf(sheet, m[2].toUpperCase(), Number(m[3]), s) : ref,
        before: m ? shownText(book, ref) : '',
        after: null,
        note: String(p.message ?? ''),
        ok: false,
      };
    });
  return { ok: true, text: typeof input.resume === 'string' ? input.resume : undefined, items: [...out.items, ...remarks], changes: out.changes, undo: out.undo };
}
