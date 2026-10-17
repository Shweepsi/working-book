// The shift's bilan, computed from the Suivi sheet's cells: what the template's
// Rapport sheet did with formulas (template #26 and earlier), now done here so
// the app can lay it out, colour by colour, and print it.
//
// The same rules as those formulas:
//   - a row whose N° TAG is a text, not a number, opens a colour's block
//     (EstCouleur: its first three characters aren't a number); the
//     template's « COULEUR » placeholder opens a block with no colour;
//   - numbers typed as text count (Nombre: IFERROR(--x, 0));
//   - Début de Ligne = Consommées (J), Fin de Ligne = Lites (R), Rejets = the
//     three Quantité columns (U, X, AA); DELTA = début − fin − rejets;
//   - m² = Dimension (mm) × 3210 mm × lites;
//   - a defect's dimension is « Dimension x Epaisseur » of its FL row.
// Plus what the Rapport didn't say: the DL plates left unfinished and the rows
// that look incomplete.
//
// The columns are the template's (row 2's headings): if Suivi's layout ever
// changes, so must COLS.

export const WIDTH_MM = 3210;
const FIRST_ROW = 3;
const LAST_ROW = 100;
const TAG_DIGITS = 11;
const PLACEHOLDER = 'COULEUR';
// The template's own content in Suivi's data rows (everything else is empty
// there, or Restantes' formula, computed below).
const TEMPLATE: Record<string, string> = { B3: PLACEHOLDER, N3: PLACEHOLDER };

const COLS = {
  dl: { tag: 'B', lites: 'C', dim: 'D', ep: 'E', date: 'I', conso: 'J', inputs: ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'L'] },
  fl: {
    tag: 'N',
    dim: 'P',
    ep: 'Q',
    lites: 'R',
    defects: [
      ['S', 'U'],
      ['V', 'X'],
      ['Y', 'AA'],
    ] as const,
    inputs: ['N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA'],
  },
};

export interface BilanTotals {
  /** Lites: Début de Ligne (consumed), Fin de Ligne, rejected, and the gap. */
  dl: number;
  fl: number;
  rejets: number;
  delta: number;
  dlM2: number;
  flM2: number;
  rejetsM2: number;
  deltaM2: number;
}

export interface BilanDefect {
  defect: string;
  total: number;
  /** By « Dimension x Epaisseur ». */
  byDim: Record<string, number>;
}

export interface BilanReste {
  row: number;
  tag: string;
  date: string;
  lites: number;
  conso: number;
  restantes: number;
  /** Consommées typed at all. */
  saisie: boolean;
}

export interface BilanColour {
  /** As typed in Suivi; « Sans couleur » for rows under no colour. */
  name: string;
  /** Rows under the template's placeholder or before any colour. */
  none: boolean;
  /** Which sides have a block of this colour. */
  inDl: boolean;
  inFl: boolean;
  totals: BilanTotals;
  defects: BilanDefect[];
  /** The dimensions its defects were found on, most rejected first. */
  dims: string[];
  restes: BilanReste[];
  /** Rows to look at, one sentence each. */
  checks: string[];
}

export interface SuiviBilan {
  totals: BilanTotals;
  colours: BilanColour[];
  /** No row filled in on either side. */
  empty: boolean;
}

export const NO_COLOUR = 'Sans couleur';

type Value = number | string | boolean | null;

/** A cell's value from GridCraft's shared content ({ v: { t, v }, … }). */
function valueOf(content: unknown): Value {
  if (!content || typeof content !== 'object') return null;
  const v = (content as { v?: { t?: string; v?: unknown } }).v;
  if (!v || typeof v !== 'object') return null;
  switch (v.t) {
    case 'Number':
      return typeof v.v === 'number' ? v.v : null;
    case 'Text':
      return typeof v.v === 'string' ? v.v : null;
    case 'Bool':
      return typeof v.v === 'boolean' ? v.v : null;
    default:
      return null;
  }
}

const filled = (v: Value) => v !== null && !(typeof v === 'string' && v.trim() === '');

/** The template's Nombre: a number, or a text that reads as one; 0 otherwise. */
function num(v: Value): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = v.trim().replace(/\s/g, '').replace(',', '.');
    if (!t) return 0;
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** The template's EstCouleur: a text whose first three characters aren't a number. */
function isColour(v: Value): v is string {
  if (typeof v !== 'string') return false;
  const head = v.slice(0, 3).trim();
  return head !== '' && Number.isNaN(Number(head.replace(',', '.')));
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/** Excel's 1900 serial → jj/mm/aa; a text as typed. */
function dayText(v: Value): string {
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
    const two = (n: number) => String(n).padStart(2, '0');
    return `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}/${two(d.getUTCFullYear() % 100)}`;
  }
  return typeof v === 'string' ? v.trim() : '';
}

const text = (v: Value) => (v === null ? '' : typeof v === 'number' ? String(round(v, 3)) : String(v).trim());

const emptyTotals = (): BilanTotals => ({ dl: 0, fl: 0, rejets: 0, delta: 0, dlM2: 0, flM2: 0, rejetsM2: 0, deltaM2: 0 });

function closeTotals(t: BilanTotals): BilanTotals {
  return {
    dl: round(t.dl, 3),
    fl: round(t.fl, 3),
    rejets: round(t.rejets, 3),
    delta: round(t.dl - t.fl - t.rejets, 3),
    dlM2: round(t.dlM2, 3),
    flM2: round(t.flM2, 3),
    rejetsM2: round(t.rejetsM2, 3),
    deltaM2: round(t.dlM2 - t.flM2 - t.rejetsM2, 2),
  };
}

/** A N° TAG that is a number of the wrong length, as a sentence; '' when it looks right. */
function tagIssue(tag: Value): string {
  const digits = typeof tag === 'number' ? String(Math.round(tag)) : typeof tag === 'string' && /^\d+$/.test(tag.trim()) ? tag.trim() : null;
  if (digits === null || digits.length === TAG_DIGITS) return '';
  return `N° TAG ${digits} à ${digits.length} chiffres (${TAG_DIGITS} attendus)`;
}

const list = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`);

export function computeBilan(cells: ReadonlyMap<string, unknown>): SuiviBilan {
  const at = (col: string, row: number): Value => {
    const key = `Suivi!${col}${row}`;
    if (cells.has(key)) return valueOf(cells.get(key));
    return TEMPLATE[`${col}${row}`] ?? null;
  };

  const colours = new Map<string, BilanColour & { raw: BilanTotals; defectMap: Map<string, BilanDefect>; dimTotals: Map<string, number> }>();
  const colourOf = (name: string | null) => {
    const key = name ?? NO_COLOUR;
    let c = colours.get(key);
    if (!c) {
      c = { name: key, none: name === null, inDl: false, inFl: false, totals: emptyTotals(), raw: emptyTotals(), defects: [], dims: [], restes: [], checks: [], defectMap: new Map(), dimTotals: new Map() };
      colours.set(key, c);
    }
    return c;
  };
  // Colour names as typed (trimmed); the placeholder is no colour.
  const blockName = (v: string) => (v.trim().toUpperCase() === PLACEHOLDER ? null : v.trim());
  let empty = true;

  // Fin de Ligne first: the Rapport listed the colours in that order.
  {
    const c = COLS.fl;
    let current: string | null = null;
    for (let r = FIRST_ROW; r <= LAST_ROW; r++) {
      const tag = at(c.tag, r);
      // A colour's row opens its block, and counts in it like the Rapport did
      // if anything else was typed on it.
      const colourRow = isColour(tag);
      if (colourRow) {
        current = blockName(tag);
        if (current !== null) colourOf(current).inFl = true;
      }
      if (!c.inputs.some((col) => (!colourRow || col !== c.tag) && filled(at(col, r)))) continue;
      empty = false;
      const colour = colourOf(current);
      colour.inFl = true;
      const dim = num(at(c.dim, r));
      const lites = num(at(c.lites, r));
      let rejets = 0;
      const dimLabel = `${text(at(c.dim, r))} x ${text(at(c.ep, r))}`.trim();
      const issues: string[] = [];
      for (const [dc, qc] of c.defects) {
        const name = text(at(dc, r));
        const q = num(at(qc, r));
        rejets += q;
        if (name && q) {
          const d = colour.defectMap.get(name) ?? { defect: name, total: 0, byDim: {} };
          d.total += q;
          d.byDim[dimLabel] = (d.byDim[dimLabel] ?? 0) + q;
          colour.defectMap.set(name, d);
          colour.dimTotals.set(dimLabel, (colour.dimTotals.get(dimLabel) ?? 0) + q);
        } else if (name && !filled(at(qc, r))) issues.push(`« ${name} » sans quantité`);
        else if (!name && q) issues.push(`une quantité de ${q} sans défaut`);
      }
      colour.raw.fl += lites;
      colour.raw.flM2 += (dim * WIDTH_MM * lites) / 1e6;
      colour.raw.rejets += rejets;
      colour.raw.rejetsM2 += (dim * WIDTH_MM * rejets) / 1e6;

      const t = at(c.tag, r);
      if (colourRow) issues.unshift('la ligne de la couleur porte aussi des valeurs');
      else if (!filled(t)) issues.unshift('N° TAG manquant');
      else {
        const bad = tagIssue(t);
        if (bad) issues.unshift(bad);
        const missing = [!filled(at(c.dim, r)) && 'dimension', !filled(at(c.ep, r)) && 'épaisseur', !filled(at(c.lites, r)) && !rejets && 'lites'].filter(
          (x): x is string => !!x,
        );
        if (missing.length) issues.push(`${list(missing)} manquante${missing.length > 1 ? 's' : ''}`);
      }
      if (issues.length) colour.checks.push(`Ligne ${r} FL : ${issues.join(', ')}.`);
    }
  }

  // Début de Ligne.
  {
    const c = COLS.dl;
    let current: string | null = null;
    for (let r = FIRST_ROW; r <= LAST_ROW; r++) {
      const tag = at(c.tag, r);
      const colourRow = isColour(tag);
      if (colourRow) {
        current = blockName(tag);
        if (current !== null) colourOf(current).inDl = true;
      }
      if (!c.inputs.some((col) => (!colourRow || col !== c.tag) && filled(at(col, r)))) continue;
      empty = false;
      const colour = colourOf(current);
      colour.inDl = true;
      const conso = num(at(c.conso, r));
      const lites = num(at(c.lites, r));
      colour.raw.dl += conso;
      colour.raw.dlM2 += (num(at(c.dim, r)) * WIDTH_MM * conso) / 1e6;

      const issues: string[] = [];
      if (colourRow) issues.push('la ligne de la couleur porte aussi des valeurs');
      else if (!filled(tag)) issues.push('N° TAG manquant');
      else {
        const bad = tagIssue(tag);
        if (bad) issues.push(bad);
        const missing = [
          !filled(at(c.lites, r)) && 'lites',
          !filled(at(c.dim, r)) && 'dimension',
          !filled(at(c.ep, r)) && 'épaisseur',
          !filled(at(c.date, r)) && 'date',
        ].filter((x): x is string => !!x);
        if (missing.length) issues.push(`${list(missing)} manquante${missing.length > 1 ? 's' : ''}`);
      }
      if (filled(at(c.lites, r)) && conso > lites) issues.push(`${round(conso, 3)} consommées pour ${round(lites, 3)} lites`);
      if (issues.length) colour.checks.push(`Ligne ${r} DL : ${issues.join(', ')}.`);

      // Restantes (the template's formula: Lites − Consommées).
      if (filled(at(c.lites, r)) && lites - conso > 0) {
        colour.restes.push({
          row: r,
          tag: text(tag),
          date: dayText(at(c.date, r)),
          lites: round(lites, 3),
          conso: round(conso, 3),
          restantes: round(lites - conso, 3),
          saisie: filled(at(c.conso, r)),
        });
      }
    }
  }

  const all = emptyTotals();
  const out: BilanColour[] = [];
  for (const c of colours.values()) {
    // A colour named in a block but with nothing under it on either side.
    const used = c.raw.dl || c.raw.fl || c.raw.rejets || c.checks.length || c.restes.length || c.defectMap.size;
    if (!used) continue;
    for (const k of Object.keys(all) as (keyof BilanTotals)[]) all[k] += c.raw[k];
    const { raw, defectMap, dimTotals, ...rest } = c;
    // By row, Début de Ligne before Fin de Ligne on the same row.
    const order = (x: string) => {
      const m = x.match(/^Ligne (\d+) (DL|FL)/);
      return m ? Number(m[1]) * 2 + (m[2] === 'FL' ? 1 : 0) : 0;
    };
    rest.checks = [...rest.checks].sort((x, y) => order(x) - order(y));
    if (c.none) rest.checks.unshift('Ces lignes ne sont sous aucune couleur : écris la couleur en N° TAG sur la ligne au-dessus d’elles.');
    out.push({
      ...rest,
      totals: closeTotals(raw),
      defects: [...defectMap.values()].sort((a, b) => b.total - a.total || a.defect.localeCompare(b.defect)),
      dims: [...dimTotals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([d]) => d),
    });
  }
  // Rows under no colour last: what to fix, after the production.
  out.sort((a, b) => Number(a.none) - Number(b.none));
  return { totals: closeTotals(all), colours: out, empty };
}
