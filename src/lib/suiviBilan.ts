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
// Plus what the Rapport didn't say: the rows that look incomplete.
//
// The columns are the template's (row 2's headings): if Suivi's layout ever
// changes, so must COLS.

export const WIDTH_MM = 3210;
const FIRST_ROW = 3;
const LAST_ROW = 100;
// A N° TAG's lengths: 11 digits, or 10 (some write it without the leading 2).
const TAG_DIGITS = [10, 11];
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
  /** Lites rejected for it, and their m². */
  total: number;
  m2: number;
  /** By « Dimension x Epaisseur ». */
  byDim: Record<string, number>;
}

/** A dimension (« Dimension x Epaisseur ») at Fin de Ligne: what went through, what was rejected. */
export interface BilanDim {
  dim: string;
  /** Good lites plus rejected ones. */
  passees: number;
  rejets: number;
}

/** What was rejected, against what went through Fin de Ligne: by defect, by dimension. */
export interface BilanRejects {
  rejets: number;
  passees: number;
  m2: number;
  /** Most rejected first. */
  defects: BilanDefect[];
  /** Most lites through first. */
  dims: BilanDim[];
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
  rejects: BilanRejects;
  /** Rows to look at. */
  checks: BilanCheck[];
}

/** A row to look at: one sentence, and where it is, to bring it up there. */
export interface BilanCheck {
  text: string;
  /** "Suivi!N47:AA47"; none for a remark about the whole block. */
  range?: string;
  /** The Loading or Unloading tab's record (lib/lineBilan.ts). */
  target?: { tab: 'loading' | 'unloading'; id: string };
}

export interface SuiviBilan {
  totals: BilanTotals;
  /** The whole shift's, every colour together. */
  rejects: BilanRejects;
  /** Every colour's rows to look at, by row. */
  checks: BilanCheck[];
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

const text = (v: Value) => (v === null ? '' : typeof v === 'number' ? String(round(v, 3)) : String(v).trim());

export const emptyTotals = (): BilanTotals => ({ dl: 0, fl: 0, rejets: 0, delta: 0, dlM2: 0, flM2: 0, rejetsM2: 0, deltaM2: 0 });

export function closeTotals(t: BilanTotals): BilanTotals {
  return {
    dl: round(t.dl, 3),
    fl: round(t.fl, 3),
    rejets: round(t.rejets, 3),
    // `|| 0`: no « -0 » for a gap that rounds to nothing.
    delta: round(t.dl - t.fl - t.rejets, 3) || 0,
    dlM2: round(t.dlM2, 3),
    flM2: round(t.flM2, 3),
    rejetsM2: round(t.rejetsM2, 3),
    deltaM2: round(t.dlM2 - t.flM2 - t.rejetsM2, 2) || 0,
  };
}

/** A N° TAG that is a number of the wrong length, as a sentence; '' when it looks right. */
function tagIssue(tag: Value): string {
  const digits = typeof tag === 'number' ? String(Math.round(tag)) : typeof tag === 'string' && /^\d+$/.test(tag.trim()) ? tag.trim() : null;
  if (digits === null || TAG_DIGITS.includes(digits.length)) return '';
  return `N° TAG ${digits} à ${digits.length} chiffres (${TAG_DIGITS.join(' ou ')} attendus)`;
}

export interface RejectAcc {
  defects: Map<string, BilanDefect>;
  dims: Map<string, BilanDim>;
}
export const rejectAcc = (): RejectAcc => ({ defects: new Map(), dims: new Map() });

export function closeRejects(accs: RejectAcc[], m2: number): BilanRejects {
  const defects = new Map<string, BilanDefect>();
  const dims = new Map<string, BilanDim>();
  for (const a of accs) {
    for (const d of a.defects.values()) {
      const t = defects.get(d.defect) ?? { defect: d.defect, total: 0, m2: 0, byDim: {} };
      t.total += d.total;
      t.m2 += d.m2;
      for (const [k, v] of Object.entries(d.byDim)) t.byDim[k] = (t.byDim[k] ?? 0) + v;
      defects.set(d.defect, t);
    }
    for (const d of a.dims.values()) {
      const t = dims.get(d.dim) ?? { dim: d.dim, passees: 0, rejets: 0 };
      t.passees += d.passees;
      t.rejets += d.rejets;
      dims.set(d.dim, t);
    }
  }
  const dimList = [...dims.values()].map((d) => ({ ...d, passees: round(d.passees, 3), rejets: round(d.rejets, 3) }));
  const rejets = round(dimList.reduce((n, d) => n + d.rejets, 0), 3);
  return {
    rejets,
    passees: round(dimList.reduce((n, d) => n + d.passees, 0), 3),
    m2: round(m2, 3),
    defects: [...defects.values()]
      .map((d) => ({ ...d, total: round(d.total, 3), m2: round(d.m2, 3) }))
      .sort((a, b) => b.total - a.total || a.defect.localeCompare(b.defect)),
    dims: dimList.filter((d) => d.passees > 0).sort((a, b) => b.passees - a.passees || a.dim.localeCompare(b.dim)),
  };
}

const list = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`);

export function computeBilan(cells: ReadonlyMap<string, unknown>): SuiviBilan {
  const at = (col: string, row: number): Value => {
    const key = `Suivi!${col}${row}`;
    if (cells.has(key)) return valueOf(cells.get(key));
    return TEMPLATE[`${col}${row}`] ?? null;
  };

  type Acc = Omit<BilanColour, 'rejects'> & { raw: BilanTotals; acc: RejectAcc };
  const colours = new Map<string, Acc>();
  const colourOf = (name: string | null) => {
    const key = name ?? NO_COLOUR;
    let c = colours.get(key);
    if (!c) {
      c = { name: key, none: name === null, inDl: false, inFl: false, totals: emptyTotals(), raw: emptyTotals(), checks: [], acc: rejectAcc() };
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
      const [len, ep] = [text(at(c.dim, r)), text(at(c.ep, r))];
      const dimLabel = len || ep ? `${len || '?'} x ${ep || '?'}` : 'Sans dimension';
      const issues: string[] = [];
      for (const [dc, qc] of c.defects) {
        const name = text(at(dc, r));
        const q = num(at(qc, r));
        rejets += q;
        if (name && q) {
          const d = colour.acc.defects.get(name) ?? { defect: name, total: 0, m2: 0, byDim: {} };
          d.total += q;
          d.m2 += (dim * WIDTH_MM * q) / 1e6;
          d.byDim[dimLabel] = (d.byDim[dimLabel] ?? 0) + q;
          colour.acc.defects.set(name, d);
        } else if (name && !filled(at(qc, r))) issues.push(`« ${name} » sans quantité`);
        else if (!name && q) issues.push(`une quantité de ${q} sans défaut`);
      }
      const dimStat = colour.acc.dims.get(dimLabel) ?? { dim: dimLabel, passees: 0, rejets: 0 };
      dimStat.passees += lites + rejets;
      dimStat.rejets += rejets;
      colour.acc.dims.set(dimLabel, dimStat);

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
      if (issues.length) colour.checks.push({ text: `Ligne ${r} FL : ${issues.join(', ')}.`, range: `Suivi!${c.tag}${r}:${c.inputs[c.inputs.length - 1]}${r}` });
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
      if (issues.length) colour.checks.push({ text: `Ligne ${r} DL : ${issues.join(', ')}.`, range: `Suivi!${c.tag}${r}:${c.inputs[c.inputs.length - 1]}${r}` });
    }
  }

  // Rows to look at by row, Début de Ligne before Fin de Ligne on the same row.
  const order = (x: BilanCheck) => {
    const m = x.text.match(/^Ligne (\d+) (DL|FL)/);
    return m ? Number(m[1]) * 2 + (m[2] === 'FL' ? 1 : 0) : 0;
  };
  const all = emptyTotals();
  const out: BilanColour[] = [];
  const used: Acc[] = [];
  for (const c of colours.values()) {
    // A colour named in a block but with nothing under it on either side.
    if (!(c.raw.dl || c.raw.fl || c.raw.rejets || c.checks.length || c.acc.dims.size)) continue;
    used.push(c);
    for (const k of Object.keys(all) as (keyof BilanTotals)[]) all[k] += c.raw[k];
    const { raw, acc, ...rest } = c;
    rest.checks = [...rest.checks].sort((x, y) => order(x) - order(y));
    if (c.none) rest.checks.unshift({ text: 'Ces lignes ne sont sous aucune couleur : écris la couleur en N° TAG sur la ligne au-dessus d’elles.' });
    out.push({ ...rest, totals: closeTotals(raw), rejects: closeRejects([acc], raw.rejetsM2) });
  }
  // Rows under no colour last: what to fix, after the production.
  out.sort((a, b) => Number(a.none) - Number(b.none));
  return {
    totals: closeTotals(all),
    rejects: closeRejects(
      used.map((c) => c.acc),
      all.rejetsM2,
    ),
    checks: out.flatMap((c) => c.checks).sort((x, y) => order(x) - order(y)),
    colours: out,
    empty,
  };
}

/**
 * Several shifts' bilans as one (the day's, 06:00 to 06:00): totals added up,
 * the same colour's figures put together, rejects merged by defect and by
 * dimension. A plate loaded at Début de Ligne on one shift and unloaded on
 * the next leaves each shift's delta off and the day's right.
 */
export function mergeBilans(bilans: SuiviBilan[]): SuiviBilan {
  const sum = (ts: BilanTotals[]) => {
    const t = emptyTotals();
    for (const x of ts) for (const k of ['dl', 'fl', 'rejets', 'dlM2', 'flM2', 'rejetsM2'] as const) t[k] += x[k];
    return closeTotals(t);
  };
  const toAcc = (r: BilanRejects): RejectAcc => ({
    defects: new Map(r.defects.map((d) => [d.defect, { ...d, byDim: { ...d.byDim } }])),
    dims: new Map(r.dims.map((d) => [d.dim, { ...d }])),
  });
  const mergeRejects = (rs: BilanRejects[]) =>
    closeRejects(
      rs.map(toAcc),
      rs.reduce((n, r) => n + r.m2, 0),
    );
  const byName = new Map<string, BilanColour[]>();
  for (const b of bilans) for (const c of b.colours) byName.set(c.name, [...(byName.get(c.name) ?? []), c]);
  const colours: BilanColour[] = [...byName.values()].map((cs) => ({
    name: cs[0].name,
    none: cs[0].none,
    inDl: cs.some((c) => c.inDl),
    inFl: cs.some((c) => c.inFl),
    totals: sum(cs.map((c) => c.totals)),
    rejects: mergeRejects(cs.map((c) => c.rejects)),
    checks: cs.flatMap((c) => c.checks),
  }));
  colours.sort((a, b) => Number(a.none) - Number(b.none));
  return {
    totals: sum(bilans.map((b) => b.totals)),
    rejects: mergeRejects(bilans.map((b) => b.rejects)),
    checks: bilans.flatMap((b) => b.checks),
    colours,
    empty: bilans.every((b) => b.empty),
  };
}
