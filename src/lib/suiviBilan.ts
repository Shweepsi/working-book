// The shift's bilan: its shape, and the sums every way of reading a shift
// shares. The figures come from the Loading and Unloading records
// (lib/lineBilan.ts), which lib/suiviCells.ts reads off the Suivi workbook by
// the rules of the template's former Rapport sheet:
//   - Début de Ligne = Consommées (J), Fin de Ligne = Lites (R), Rejets = the
//     three Quantité columns (U, X, AA); DELTA = début − fin − rejets;
//   - m² = Dimension (mm) × 3210 mm × lites;
//   - a defect's dimension is « Dimension x Epaisseur » of its FL row.
// The cell helpers below (valueOf, num, isColour…) are those formulas' own.

export const FIRST_ROW = 3;
export const LAST_ROW = 100;
export const PLACEHOLDER = 'COULEUR';
// The template's own content in Suivi's data rows (everything else is empty
// there, or Restantes' formula, which isn't read: lib/line.ts computes it).
export const TEMPLATE: Record<string, string> = { B3: PLACEHOLDER, N3: PLACEHOLDER };

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
  /** Where it is in Suivi ("Suivi!N47:AA47"); none for a remark about the whole block. */
  range?: string;
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

export type Value = number | string | boolean | null;

/** A cell's value from GridCraft's shared content ({ v: { t, v }, … }). */
export function valueOf(content: unknown): Value {
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

export const filled = (v: Value) => v !== null && !(typeof v === 'string' && v.trim() === '');

/** The template's Nombre: a number, or a text that reads as one; 0 otherwise. */
export function num(v: Value): number {
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
export function isColour(v: Value): v is string {
  if (typeof v !== 'string') return false;
  const head = v.slice(0, 3).trim();
  return head !== '' && Number.isNaN(Number(head.replace(',', '.')));
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

export const text = (v: Value) => (v === null ? '' : typeof v === 'number' ? String(round(v, 3)) : String(v).trim());

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
