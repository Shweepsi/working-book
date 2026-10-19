// The line's own input, without a spreadsheet: what the Loading and Unloading
// tabs edit, per shift (date + poste). Four kinds of records, each one written
// whole and synced on its own (lib/lineSync.ts):
//   - colour: the coatings the shift ran, in the order they started; both tabs
//     share them (what is loaded in a colour comes out in that colour);
//   - loading: a jumbo loaded at the start of the line (Début de Ligne);
//   - unloading: a rack filled at the end of the line (Fin de Ligne);
//   - scrap: lites scrapped at the end of the line, for one defect.
// The rules are the template's (lib/suiviBilan.ts): a N° TAG has 10 or 11
// digits, m² = length × 3210 mm × lites, a scrap's dimension is « length x
// thickness » — its own, typed with it.

export type LineKind = 'colour' | 'loading' | 'unloading' | 'scrap';

interface Base {
  id: string;
  /** Created (ms): the order rows and colours are listed in. */
  at: number;
}

export interface Colour extends Base {
  kind: 'colour';
  name: string;
}

export interface LoadingRow extends Base {
  kind: 'loading';
  /** A colour's id; null for a row under none (or a colour deleted meanwhile). */
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
  /** The glass's date, YYYY-MM-DD. */
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
  comment: string;
}

export interface Scrap extends Base {
  kind: 'scrap';
  colour: string | null;
  defect: string;
  qty: number | null;
  dim: number | null;
  ep: string;
  comment: string;
}

export type LineRecord = Colour | LoadingRow | UnloadingRow | Scrap;

/** A shift's records by kind, each list in its order. */
export interface LineData {
  colours: Colour[];
  loading: LoadingRow[];
  unloading: UnloadingRow[];
  scraps: Scrap[];
}

export const EMPTY_LINE: LineData = { colours: [], loading: [], unloading: [], scraps: [] };

/** The template's defects list (sheet Listes, name List_M3). */
export const DEFECTS = [
  'A2 - Conditioning/Startup/Color Search',
  'A3 - Quality Test',
  'A4 - Color Out of Specifications',
  'A5 - Arcing',
  'A6 - Flaking',
  'A8 - Pinholes',
  'B1 - Cleaning Defects',
  'B2 - Corrosion/Oxidation',
  'B3 - Crazing',
  'B5 - Breakage Washer Equipment',
  'B6 - Breakage Ancillary Equipment',
  'B7 - Roll Marks',
  'B8 - Remains of Adhesive',
  'B9 - Scratches',
  'C4 - TPF',
  'C5 - Development',
  'C6 - Surplus Special Dimensions',
  'C8 - Discolored or Incomplete Product',
  'C9 - Equipment All Others',
  'D2 - All Raw Glass - Float Defects',
  'D3 - All Raw Glass - Lami Defects',
] as const;

// What October's shifts used most, offered first (each tab adds the shift's own).
export const COMMON_DIMS = [6000, 2550, 4500, 5100, 5850, 5500, 2250, 5820];
export const COMMON_EPS = ['6', '8', '10', '424', '626NEXA', '6UC', '414', '4', '323', '323SR', '10UC', '626', '442', '5', '616', '626SR', '8UC', '12'];
export const COMMON_COLOURS = ['SNX60HT', 'SN70/35', 'SN51HT', 'SNX50HT', 'SNX60', 'SNX70HT', 'SNX70', 'SN70/37', 'SN63', 'SN51', 'SN40/23', 'SN70/37HT', 'SN70SHT', 'SN70HT', 'SNX50', 'SN63HT'];
export const ORIGINES = ['LUX', 'PILK', 'WEIE', 'PILKWEIE', 'UK'];
export const SENS = ['PSI', 'PSO'] as const;
export const POLISHING = ['OUI', 'NON'] as const;

export const WIDTH_MM = 3210;
const TAG_DIGITS = [10, 11];

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const at = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const colourRef = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** A stored record's fields, typed; null when it isn't one of the four kinds. */
export function toRecord(id: string, kind: string, v: Record<string, unknown>): LineRecord | null {
  switch (kind) {
    case 'colour':
      return { id, kind, at: at(v.at), name: str(v.name, 60) };
    case 'loading':
      return {
        id,
        kind,
        at: at(v.at),
        colour: colourRef(v.colour),
        tag: str(v.tag, 40),
        lites: numOrNull(v.lites),
        dim: numOrNull(v.dim),
        ep: str(v.ep, 40),
        origine: str(v.origine, 40),
        sens: str(v.sens, 10),
        polishing: str(v.polishing, 10),
        date: str(v.date, 10),
        conso: numOrNull(v.conso),
        comment: str(v.comment),
      };
    case 'unloading':
      return {
        id,
        kind,
        at: at(v.at),
        colour: colourRef(v.colour),
        tag: str(v.tag, 40),
        frame: str(v.frame, 40),
        dim: numOrNull(v.dim),
        ep: str(v.ep, 40),
        lites: numOrNull(v.lites),
        comment: str(v.comment),
      };
    case 'scrap':
      return {
        id,
        kind,
        at: at(v.at),
        colour: colourRef(v.colour),
        defect: str(v.defect, 120),
        qty: numOrNull(v.qty),
        dim: numOrNull(v.dim),
        ep: str(v.ep, 40),
        comment: str(v.comment),
      };
    default:
      return null;
  }
}

/** A record as stored: its fields without id and kind. */
export function fieldsOf(r: LineRecord): Record<string, unknown> {
  const { id: _id, kind: _kind, ...fields } = r;
  return fields;
}

const byAt = (a: Base, b: Base) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Records (of any kind, in any order) as a shift's lists. */
export function toLineData(records: Iterable<LineRecord>): LineData {
  const d: LineData = { colours: [], loading: [], unloading: [], scraps: [] };
  for (const r of records) {
    if (r.kind === 'colour') d.colours.push(r);
    else if (r.kind === 'loading') d.loading.push(r);
    else if (r.kind === 'unloading') d.unloading.push(r);
    else d.scraps.push(r);
  }
  d.colours.sort(byAt);
  d.loading.sort(byAt);
  d.unloading.sort(byAt);
  d.scraps.sort(byAt);
  return d;
}

export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** A number as typed (« 12 », « 12,5 », « 1 200 »); null for nothing or anything else. */
export function parseNumber(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** A thickness as typed, the way the template's rows hold it: upper case, no spaces. */
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
  out.push(...missing([r.dim === null && 'dimension', !r.ep.trim() && 'épaisseur', r.lites === null && 'lites']));
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
export const scrapFilled = (s: Scrap) => !!(s.defect.trim() || s.qty || s.dim !== null || s.ep.trim() || s.comment.trim());

/** ISO date → « 05/10/26 ». */
export const shortDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : iso;
};
