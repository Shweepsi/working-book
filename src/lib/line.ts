// The line's records as the Loading and Unloading tabs show them: the shift's
// colours, the jumbos loaded at the start of the line (Début de Ligne), the
// racks filled at its end (Fin de Ligne) and the scraps (the rejected lites,
// one defect at a time).
//
// They aren't typed here: lib/suiviCells.ts reads them off the shift's Suivi
// workbook, row by row, so every record knows its row (`row`) and the range
// to bring up in Suivi (`range`). The rules are the template's
// (lib/suiviBilan.ts): a N° TAG has 10 or 11 digits, m² = length × 3210 mm ×
// lites, a scrap's dimension is its Suivi row's « length x thickness ».

interface Base {
  id: string;
  /** The Suivi row it comes from: the order records are listed in. */
  row: number;
  /** What to select in Suivi to see it ("Suivi!B12:L12"). */
  range: string;
}

export interface Colour extends Base {
  kind: 'colour';
  name: string;
}

export interface LoadingRow extends Base {
  kind: 'loading';
  /** A colour's id; null for a row under none. */
  colour: string | null;
  tag: string;
  lites: number | null;
  /** Length, mm. */
  dim: number | null;
  /** Thickness as written: « 6 », « 6UC », « 424 ». */
  ep: string;
  origine: string;
  /** PSI or PSO. */
  sens: string;
  /** OUI or NON. */
  polishing: string;
  /** The glass's date, YYYY-MM-DD (as typed when it isn't a date). */
  date: string;
  conso: number | null;
  comment: string;
}

export interface UnloadingRow extends Base {
  kind: 'unloading';
  colour: string | null;
  tag: string;
  frame: string;
  dim: number | null;
  ep: string;
  lites: number | null;
  /** What the row's defect columns say without naming a defect (the operators' notes on the rack). */
  comment: string;
  /** The row also rejects lites: its lites may be left out (all of them went to scrap). */
  withScraps?: boolean;
}

export interface Scrap extends Base {
  kind: 'scrap';
  colour: string | null;
  defect: string;
  qty: number | null;
  /** Its Suivi row's dimension. */
  dim: number | null;
  ep: string;
  comment: string;
}

export type LineRecord = Colour | LoadingRow | UnloadingRow | Scrap;

/** A shift's records by kind, each list in its row order. */
export interface LineData {
  colours: Colour[];
  loading: LoadingRow[];
  unloading: UnloadingRow[];
  scraps: Scrap[];
}

export const EMPTY_LINE: LineData = { colours: [], loading: [], unloading: [], scraps: [] };

export const hasRecords = (d: LineData) => d.colours.length + d.loading.length + d.unloading.length + d.scraps.length > 0;

export const WIDTH_MM = 3210;
const TAG_DIGITS = [10, 11];

const byRow = (a: Base, b: Base) => a.row - b.row || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Records (of any kind, in any order) as a shift's lists. */
export function toLineData(records: Iterable<LineRecord>): LineData {
  const d: LineData = { colours: [], loading: [], unloading: [], scraps: [] };
  for (const r of records) {
    if (r.kind === 'colour') d.colours.push(r);
    else if (r.kind === 'loading') d.loading.push(r);
    else if (r.kind === 'unloading') d.unloading.push(r);
    else d.scraps.push(r);
  }
  d.colours.sort(byRow);
  d.loading.sort(byRow);
  d.unloading.sort(byRow);
  d.scraps.sort(byRow);
  return d;
}

/** A thickness the way the template's rows hold it: upper case, no spaces. */
export const normEp = (raw: string) => raw.trim().replace(/\s+/g, '').toUpperCase();

/** « 6000 x 6 », the bilan's dimension; « Sans dimension » when neither is known. */
export function dimLabel(dim: number | null, ep: string): string {
  if (dim === null && !ep.trim()) return 'Sans dimension';
  return `${dim === null ? '?' : fmtNum(dim)} x ${ep.trim() || '?'}`;
}

export const fmtNum = (v: number, digits = 3) => v.toLocaleString('fr-FR', { maximumFractionDigits: digits, useGrouping: false });

/** m² of `lites` plates `dim` mm long. */
export const area = (dim: number | null, lites: number | null) => ((dim ?? 0) * WIDTH_MM * (lites ?? 0)) / 1e6;

const list = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`);
const missing = (names: (string | false)[]) => {
  const m = names.filter((x): x is string => !!x);
  return m.length ? [`${list(m)} manquante${m.length > 1 ? 's' : ''}`] : [];
};

/** What's wrong with a N° TAG, as a sentence; '' when it looks right. */
export function tagIssue(tag: string): string {
  const t = tag.trim();
  if (!t) return 'N° TAG manquant';
  if (!/^\d+$/.test(t)) return `N° TAG « ${t} » : que des chiffres`;
  return TAG_DIGITS.includes(t.length) ? '' : `N° TAG à ${t.length} chiffres (${TAG_DIGITS.join(' ou ')} attendus)`;
}

/** A jumbo's problems, as short sentences (none when it looks complete). */
export function loadingIssues(r: LoadingRow): string[] {
  const out: string[] = [];
  const tag = tagIssue(r.tag);
  if (tag) out.push(tag);
  out.push(...missing([r.lites === null && 'lites', r.dim === null && 'dimension', !r.ep.trim() && 'épaisseur', !r.date && 'date']));
  if (r.lites !== null && r.conso !== null && r.conso > r.lites) out.push(`${fmtNum(r.conso)} consommées pour ${fmtNum(r.lites)} lites`);
  return out;
}

/** A rack's problems. */
export function unloadingIssues(r: UnloadingRow): string[] {
  const out: string[] = [];
  const tag = tagIssue(r.tag);
  if (tag) out.push(tag);
  out.push(...missing([r.dim === null && 'dimension', !r.ep.trim() && 'épaisseur', r.lites === null && !r.withScraps && 'lites']));
  return out;
}

/** A scrap's problems. */
export function scrapIssues(s: Scrap): string[] {
  const out: string[] = [];
  if (!s.defect.trim()) out.push('défaut manquant');
  if (!s.qty) out.push('quantité manquante');
  out.push(...missing([s.dim === null && 'dimension', !s.ep.trim() && 'épaisseur']));
  return out;
}

/** Whether a row holds anything at all (a row with nothing typed is no row). */
export const loadingFilled = (r: LoadingRow) =>
  !!(r.tag.trim() || r.lites !== null || r.dim !== null || r.ep.trim() || r.origine.trim() || r.sens || r.polishing || r.date || r.conso !== null || r.comment.trim());
export const unloadingFilled = (r: UnloadingRow) => !!(r.tag.trim() || r.frame.trim() || r.dim !== null || r.ep.trim() || r.lites !== null || r.comment.trim());
export const scrapFilled = (s: Scrap) => !!(s.defect.trim() || s.qty || s.comment.trim());

/** ISO date → « 05/10/26 ». */
export const shortDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : iso;
};
