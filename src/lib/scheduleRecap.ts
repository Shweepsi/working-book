// Aggregation behind the schedule's second print mode — the portrait "récap
// plaques" sheet.
//
// The detailed landscape sheet answers "what is there to produce, line by
// line". This one answers a different question, the one asked in front of the
// racks: "for each dimension and each plate, how many lites are still to
// produce, and have I got the stock". So the planning rows collapse into
// qualité → dimension → plaque buckets — the PDP riding on the plate as a note
// rather than splitting one pile in two — and the plate count itself is left
// blank: nobody has that figure in the report, it is written by hand.
//
// Pure functions over rows: no DOM, no state, no formatting decisions beyond
// the group labels the sheet prints.

import type { PMS230Record } from './pms230Parser';
import { glassMakeup } from './pms230Parser';
import { totalM2, totalReqLites } from './coaterMath';

// Label used when a row carries no qualité at all. Same em dash the rest of the
// app uses for "not set".
const NO_QUALITE = '—';

// Rows whose tail didn't decode (or which the report simply doesn't carry a
// thickness for) still have lites to produce, so they cannot be dropped. They
// gather in a bucket of their own, sorted last, that names the gap rather than
// hiding it inside a real thickness.
const NO_THICKNESS_KEY = '';
const NO_THICKNESS_LABEL = 'épaisseur non renseignée';

// The plate is noted the way the report writes it: "PL6", "PL4.4.2". Only the
// laminate's plies are re-spaced (the report glues them, "PL44.2").
const PDP_PREFIX = 'PL';

// A PDP that carries no plate at all. Kept as the report writes it rather than
// left blank: an operator reading "O" knows the PDP was silent, where an empty
// parenthesis would only look like something failed to print.
const BARE_PDP = 'O';

// A row the report gave no usable dimension for. It has lites to produce like
// any other, so it cannot be dropped: the récap total has to keep matching the
// detailed sheet's Total row, and a quietly missing line is worse on paper than
// a line that says what it is missing. Sorts last, on a zero dimension.
const NO_DIMENSION_KEY = '';
const NO_DIMENSION_LABEL = 'dimension non renseignée';

export interface RecapPlateGroup {
  key: string;
  /** The finished thickness, written out: "08 mm". */
  label: string;
  /** Sort value in mm, or null for the "unknown thickness" bucket. Always the
   *  finished thickness, laminate included — a 5.5.2 sorts with the 10 mm. */
  mm: number | null;
  /** Laminated make-up ("4.4.2"), or null for a monolithic article. */
  makeup: string | null;
  /** What the PDPs of these rows say, ready to print between parentheses:
   *  ["PL6"], ["PL6", "LLT"], ["O"]. Empty when no row carried a PDP. */
  pdps: string[];
  reqLites: number;
  m2: number;
  /** How many planning rows collapsed into this bucket. */
  lines: number;
}

export interface RecapDimensionGroup {
  key: string;
  label: string;
  /** False for the bucket holding rows the report gave no dimension for. */
  known: boolean;
  largeur: number;
  longueur: number;
  reqLites: number;
  m2: number;
  lines: number;
  plates: RecapPlateGroup[];
}

export interface RecapQualityGroup {
  qualite: string;
  reqLites: number;
  m2: number;
  lines: number;
  dimensions: RecapDimensionGroup[];
}

export interface ScheduleRecap {
  qualities: RecapQualityGroup[];
  reqLites: number;
  m2: number;
  lines: number;
}

// "06.00" → "06 mm", "10.00" → "10 mm", "03.85" → "3,85 mm".
// The report pads whole millimetres to two digits and the racks are labelled
// the same way, so the padding is kept rather than normalised away.
export function thicknessLabel(raw: string): string {
  const mm = thicknessMm(raw);
  if (mm == null) return NO_THICKNESS_LABEL;
  if (Number.isInteger(mm)) return `${String(mm).padStart(2, '0')} mm`;
  return `${mm.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} mm`;
}

// Numeric millimetres of a raw thickness field, or null when it is missing or
// unparsable. Sorting needs the number; 08 must land between 10 and 06 rather
// than where a string compare would put it.
export function thicknessMm(raw: string): number | null {
  if (!raw) return null;
  const mm = parseFloat(raw);
  return Number.isFinite(mm) && mm > 0 ? mm : null;
}

// The plate a PDP calls for, or null when it names none:
//   "O PL6"      -> "6"      a plain 6 mm plate
//   "O PL44.2"   -> "4.4.2"  4 + 4 + a 0.2 interlayer
//   "O SP3 PL6"  -> "6"      SP3 says nothing about the plate
//   "O"          -> null     the PDP is silent
//
// Only the `PL` payload is read: the leading "O" is on every PDP, and the other
// tokens (SP3, EC…) don't change what comes off the rack. A payload with a
// decimal is a laminate — its whole-number part is the plies, one digit each;
// one without is a thickness in millimetres, written bare because that is how
// the report writes it (`PL6`).
export function pdpPlate(pdp: string): string | null {
  const tokens = pdp.split(/\s+/).filter((t) => t && t !== 'O');
  const pl = tokens.find((t) => /^PL[\d.]+$/.test(t));
  if (!pl) return null;

  const payload = pl.slice(2);
  const [whole = '', decimals] = payload.split('.');
  if (!decimals) return whole;
  // One digit per ply, "44.2" being 4 + 4 + 0.2. A zero among them would be a
  // nought-millimetre ply, so on that payload the convention plainly doesn't
  // hold: print it as the report writes it rather than invent a plate nobody
  // can fetch. Same for a payload with nothing in front of the dot.
  if (!whole || whole.includes('0')) return payload;
  return `${whole.split('').join('.')}.${decimals}`;
}

/**
 * What the PDPs of a plate's rows have to say, ready to print in parentheses
 * behind the plate: `06 mm (PL6)`, `4.4.2 (PL4.4.2)`, `06 mm (PL6, LLT)`.
 *
 * It is an annotation, not a grouping: two rows of the same plate that differ
 * only by their PDP stay one line and put both PDPs behind it. Which is the
 * whole point — the operator counts plates, and the PDP only says which one to
 * fetch.
 *
 * A PDP with no `PL` payload still often names its plate through the format
 * code, where `ILLT1` marks an LLT; that marker rides alongside the plate
 * rather than instead of it, so a row can read `(PL6, LLT)`. When a PDP says
 * neither, it leaves the "O" the report wrote — an honest O beats a silence
 * that reads like a printing fault. A row carrying no PDP field at all adds
 * nothing: there the silence is the report's, and nothing is what it said.
 */
export function pdpNotes(rows: PMS230Record[]): string[] {
  const plates = new Set<string>();
  let bare = false;
  let llt = false;

  for (const r of rows) {
    if (!r.pdp) continue;
    const plate = pdpPlate(r.pdp);
    const isLlt = !!r.formatCode?.includes('LLT');
    if (plate) plates.add(plate);
    if (isLlt) llt = true;
    // "O" only for a row that says nothing at all. A silent PDP whose format
    // code carries the LLT has already been answered — noting both would print
    // the question next to its own answer.
    if (!plate && !isLlt) bare = true;
  }

  const notes = [...plates].sort((a, b) => a.localeCompare(b, 'fr')).map((p) => `${PDP_PREFIX}${p}`);
  if (bare) notes.push(BARE_PDP);
  if (llt) notes.push('LLT');
  return notes;
}

// Dimension as the rest of the app writes it — largeur × longueur (see the
// `format` cell in Schedules and the row detail sheet). The Excel pivot this
// sheet takes after writes it the other way round; internal consistency wins,
// an operator reading both this sheet and the detailed one should not have to
// flip the two numbers in their head.
export function dimensionLabel(largeur: number, longueur: number): string {
  const fmt = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
  return `${fmt(largeur)} × ${fmt(longueur)}`;
}

/**
 * Collapse planning rows into the qualité → dimension → plaque tree the récap
 * sheet prints.
 *
 * Feed it the rows the table itself shows (`visibleRows`): schedule-scoped,
 * QC samples and finished lines already out, current filters applied. The
 * totals then match the detailed sheet's Total row line for line, which is the
 * only way the two printouts can be trusted side by side.
 *
 * The PDP is not a level of this tree: it rides on the plate as an annotation
 * (see `pdpNotes`). Grouping by it split one pile of plates across several
 * headings — the operator counts a plate once, whichever PDP asked for it.
 */
export function buildScheduleRecap(rows: PMS230Record[]): ScheduleRecap {
  // Nested maps keep insertion cheap; the ordering is imposed once at the end,
  // because it isn't the order rows arrive in (the table's sort is the user's,
  // and it may be on any column).
  type PlateBuckets = Map<string, PMS230Record[]>;
  const byQualite = new Map<string, Map<string, PlateBuckets>>();

  for (const r of rows) {
    const qualite = r.qualite || NO_QUALITE;
    // A row whose dimension didn't decode gathers in a bucket that names the
    // gap, rather than being dropped: it still carries lites, and a récap whose
    // total no longer matches the detailed sheet's is a récap nobody can check.
    const dimKey = r.largeur && r.longueur ? `${r.largeur}×${r.longueur}` : NO_DIMENSION_KEY;
    // Thickness *and* make-up. On the thickness alone a 4.4.2 lands in the same
    // bucket as a plain 8 mm — same finished thickness, two entirely different
    // plates to fetch, and the sheet would send the operator to the wrong rack.
    const thMm = thicknessMm(r.thickness) == null ? NO_THICKNESS_KEY : r.thickness;
    const makeup = glassMakeup(r.itemName);
    const plateKey = `${thMm}|${makeup ?? ''}`;

    let dims = byQualite.get(qualite);
    if (!dims) byQualite.set(qualite, (dims = new Map()));
    let plates = dims.get(dimKey);
    if (!plates) dims.set(dimKey, (plates = new Map()));
    const bucket = plates.get(plateKey);
    if (bucket) bucket.push(r);
    else plates.set(plateKey, [r]);
  }

  const qualities: RecapQualityGroup[] = [];

  for (const [qualite, dims] of byQualite) {
    const dimensions: RecapDimensionGroup[] = [];

    for (const [dimKey, plateBuckets] of dims) {
      const plates: RecapPlateGroup[] = [];

      for (const [plateKey, bucket] of plateBuckets) {
        const [rawMm = '', makeup = ''] = plateKey.split('|');
        plates.push({
          key: plateKey,
          label: thicknessLabel(rawMm),
          mm: thicknessMm(rawMm),
          makeup: makeup || null,
          pdps: pdpNotes(bucket),
          reqLites: totalReqLites(bucket),
          m2: totalM2(bucket),
          lines: bucket.length,
        });
      }

      // Thickest first, like the pivot the sheet takes after (10, 08, 06); the
      // unknown bucket sinks to the bottom of its dimension. Laminates sort on
      // their finished thickness, so a 5.5.2 sits next to the plain 10 mm it
      // would otherwise have been confused with — side by side is exactly where
      // the difference has to be visible.
      plates.sort((a, b) =>
        (b.mm ?? -1) - (a.mm ?? -1) || (a.makeup ?? '').localeCompare(b.makeup ?? '', 'fr'));

      const first = plateBuckets.values().next().value![0]!;
      const known = !!first.largeur && !!first.longueur;
      dimensions.push({
        key: dimKey,
        label: known ? dimensionLabel(first.largeur, first.longueur) : NO_DIMENSION_LABEL,
        known,
        largeur: first.largeur,
        longueur: first.longueur,
        reqLites: plates.reduce((s, p) => s + p.reqLites, 0),
        m2: plates.reduce((s, p) => s + p.m2, 0),
        lines: plates.reduce((s, p) => s + p.lines, 0),
        plates,
      });
    }

    // Longueur DESC then largeur DESC — the planner's own order, the one the
    // table groups by (DEFAULT_SORT_KEY) and the one the racks are walked in.
    // The undecoded bucket carries a zero dimension, so it lands last on its
    // own without a rule of its own.
    dimensions.sort((a, b) => b.longueur - a.longueur || b.largeur - a.largeur);

    qualities.push({
      qualite,
      reqLites: dimensions.reduce((s, d) => s + d.reqLites, 0),
      m2: dimensions.reduce((s, d) => s + d.m2, 0),
      lines: dimensions.reduce((s, d) => s + d.lines, 0),
      dimensions,
    });
  }

  qualities.sort((a, b) => a.qualite.localeCompare(b.qualite, 'fr'));

  return {
    qualities,
    reqLites: qualities.reduce((s, q) => s + q.reqLites, 0),
    m2: qualities.reduce((s, q) => s + q.m2, 0),
    lines: qualities.reduce((s, q) => s + q.lines, 0),
  };
}
