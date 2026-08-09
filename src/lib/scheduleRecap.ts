// Aggregation behind the schedule's second print mode — the portrait "récap
// plaques" sheet.
//
// The detailed landscape sheet answers "what is there to produce, line by
// line". This one answers a different question, the one asked in front of the
// racks: "for each dimension, each PDP and each plate, how many lites are
// still to produce, and have I got the stock". So the planning rows collapse
// into qualité → dimension → PDP → plaque buckets, and the plate count itself
// is left blank — nobody has that figure in the report, it is written by hand.
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

// Same treatment for a row the report gave no PDP: keyed apart, sorted last,
// never folded into a real one. The sheet names the gap itself.
//
// It doubles as the key of the single group a dimension holds when the PDP
// level is switched off — there is then no PDP to name, the sheet prints no
// heading for it, and an empty key is exactly the honest one to carry.
const NO_PDP_KEY = '';

// A row the report gave no usable dimension for. It has lites to produce like
// any other, so it cannot be dropped: the récap total has to keep matching the
// detailed sheet's Total row, and a quietly missing line is worse on paper than
// a line that says what it is missing. Sorts last, on a zero dimension.
const NO_DIMENSION_KEY = '';
const NO_DIMENSION_LABEL = 'dimension non renseignée';

export interface RecapThicknessGroup {
  key: string;
  /** The finished thickness, written out: "08 mm". */
  label: string;
  /** Sort value in mm, or null for the "unknown thickness" bucket. Always the
   *  finished thickness, laminate included — a 5.5.2 sorts with the 10 mm. */
  mm: number | null;
  /** Laminated make-up ("4.4.2"), or null for a monolithic article. */
  makeup: string | null;
  reqLites: number;
  m2: number;
  /** How many planning rows collapsed into this bucket. */
  lines: number;
}

export interface RecapPdpGroup {
  /** The plate this PDP calls for ("6 mm", "4.4.2", "LLT", "O"), or '' when
   *  the report carried no PDP at all. */
  key: string;
  reqLites: number;
  m2: number;
  lines: number;
  thicknesses: RecapThicknessGroup[];
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
  pdps: RecapPdpGroup[];
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
  /** Whether the plates were split by PDP. False collapses that level: every
   *  dimension then holds one nameless group, and the sheet prints no heading
   *  for it. Carried here so the tree says how it was built. */
  byPdp: boolean;
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

// The plate a PDP calls for, rather than the PDP as the report writes it:
//   "O PL6"          -> "6 mm"   a plain 6 mm plate
//   "O PL44.2"       -> "4.4.2"  4 + 4 + a 0.2 interlayer
//   "O SP3 PL6"      -> "6 mm"   SP3 says nothing about the plate
//   "O"    + ILLT1   -> "LLT"    no payload, but the format code carries it
//   "O"    + I11L    -> "O"      genuinely unsaid — kept as the report writes it
//
// Only the `PL` payload is kept: the leading "O" is on every PDP, and the other
// tokens (SP3, EC…) don't change what comes off the rack. Since they are
// dropped from the label they are dropped from the grouping too — two PDPs that
// differ only by one of them are the same plate, and printing them as two
// identical headings would only look like a bug. A payload with a decimal is a
// laminate (its whole-number part is the plies, one digit each); one without is
// a thickness in millimetres.
//
// A PDP with no payload at all usually still says its plate through the format
// code — `ILLT1` marks an LLT. When even that is silent the heading stays "O",
// exactly as the report writes it: measured on the live report that is a real
// bucket (~15 rows), and an honest O beats a label the data doesn't carry.
export function pdpLabel(pdp: string, formatCode = ''): string {
  const tokens = pdp.split(/\s+/).filter((t) => t && t !== 'O');
  const pl = tokens.find((t) => /^PL[\d.]+$/.test(t));
  if (!pl) return formatCode.includes('LLT') ? 'LLT' : 'O';

  const payload = pl.slice(2);
  const [whole = '', decimals] = payload.split('.');
  if (!decimals) return `${whole} mm`;
  // One digit per ply, "44.2" being 4 + 4 + 0.2. A zero among them would be a
  // nought-millimetre ply, so on that payload the convention plainly doesn't
  // hold: print it as the report writes it rather than invent a plate nobody
  // can fetch. Same for a payload with nothing in front of the dot.
  if (!whole || whole.includes('0')) return payload;
  return `${whole.split('').join('.')}.${decimals}`;
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
 * Collapse planning rows into the qualité → dimension → PDP → épaisseur tree
 * the récap sheet prints.
 *
 * Feed it the rows the table itself shows (`visibleRows`): schedule-scoped,
 * QC samples and finished lines already out, current filters applied. The
 * totals then match the detailed sheet's Total row line for line, which is the
 * only way the two printouts can be trusted side by side.
 *
 * `byPdp` false drops the PDP level: the plates of a dimension are then listed
 * straight under it, and two rows that differ only by their PDP become one
 * line. Shorter sheet, one less thing to read — for the days the plates are
 * prepared by dimension rather than picked PDP by PDP.
 */
export function buildScheduleRecap(
  rows: PMS230Record[],
  { byPdp = true }: { byPdp?: boolean } = {},
): ScheduleRecap {
  // Nested maps keep insertion cheap; the ordering is imposed once at the end,
  // because it isn't the order rows arrive in (the table's sort is the user's,
  // and it may be on any column).
  type ThicknessBuckets = Map<string, PMS230Record[]>;
  type PdpBuckets = Map<string, ThicknessBuckets>;
  const byQualite = new Map<string, Map<string, PdpBuckets>>();

  for (const r of rows) {
    const qualite = r.qualite || NO_QUALITE;
    // A row whose dimension didn't decode gathers in a bucket that names the
    // gap, rather than being dropped: it still carries lites, and a récap whose
    // total no longer matches the detailed sheet's is a récap nobody can check.
    const dimKey = r.largeur && r.longueur ? `${r.largeur}×${r.longueur}` : NO_DIMENSION_KEY;
    // Keyed on the plate the PDP calls for, not on its raw text — see pdpLabel.
    const pdpKey = !byPdp ? NO_PDP_KEY : r.pdp ? pdpLabel(r.pdp, r.formatCode) : NO_PDP_KEY;
    // Thickness *and* make-up. On the thickness alone a 4.4.2 lands in the same
    // bucket as a plain 8 mm — same finished thickness, two entirely different
    // plates to fetch, and the sheet would send the operator to the wrong rack.
    const thMm = thicknessMm(r.thickness) == null ? NO_THICKNESS_KEY : r.thickness;
    const makeup = glassMakeup(r.itemName);
    const thKey = `${thMm}|${makeup ?? ''}`;

    let dims = byQualite.get(qualite);
    if (!dims) byQualite.set(qualite, (dims = new Map()));
    let pdps = dims.get(dimKey);
    if (!pdps) dims.set(dimKey, (pdps = new Map()));
    let ths = pdps.get(pdpKey);
    if (!ths) pdps.set(pdpKey, (ths = new Map()));
    const bucket = ths.get(thKey);
    if (bucket) bucket.push(r);
    else ths.set(thKey, [r]);
  }

  const qualities: RecapQualityGroup[] = [];

  for (const [qualite, dims] of byQualite) {
    const dimensions: RecapDimensionGroup[] = [];

    for (const [dimKey, pdpBuckets] of dims) {
      const pdps: RecapPdpGroup[] = [];

      for (const [pdpKey, ths] of pdpBuckets) {
        const thicknesses: RecapThicknessGroup[] = [];

        for (const [thKey, bucket] of ths) {
          const [rawMm = '', makeup = ''] = thKey.split('|');
          thicknesses.push({
            key: thKey,
            label: thicknessLabel(rawMm),
            mm: thicknessMm(rawMm),
            makeup: makeup || null,
            reqLites: totalReqLites(bucket),
            m2: totalM2(bucket),
            lines: bucket.length,
          });
        }

        // Thickest first, like the pivot the sheet takes after (10, 08, 06);
        // the unknown bucket sinks to the bottom of its PDP. Laminates sort on
        // their finished thickness, so a 5.5.2 sits next to the plain 10 mm it
        // would otherwise have been confused with — side by side is exactly
        // where the difference has to be visible.
        thicknesses.sort((a, b) =>
          (b.mm ?? -1) - (a.mm ?? -1) || (a.makeup ?? '').localeCompare(b.makeup ?? '', 'fr'));

        pdps.push({
          key: pdpKey,
          reqLites: thicknesses.reduce((s, t) => s + t.reqLites, 0),
          m2: thicknesses.reduce((s, t) => s + t.m2, 0),
          lines: thicknesses.reduce((s, t) => s + t.lines, 0),
          thicknesses,
        });
      }

      // PDP descending, the planner's secondary sort in the detailed table
      // (longueur DESC, PDP DESC). The bare-O bucket sinks below the named
      // plates — it says the least — and a row with no PDP at all lands last.
      const rank = (k: string) => (k === '' ? 2 : k === 'O' ? 1 : 0);
      pdps.sort((a, b) => rank(a.key) - rank(b.key) || b.key.localeCompare(a.key, 'fr'));

      const first = pdpBuckets.values().next().value!.values().next().value![0]!;
      const known = !!first.largeur && !!first.longueur;
      dimensions.push({
        key: dimKey,
        label: known ? dimensionLabel(first.largeur, first.longueur) : NO_DIMENSION_LABEL,
        known,
        largeur: first.largeur,
        longueur: first.longueur,
        reqLites: pdps.reduce((s, p) => s + p.reqLites, 0),
        m2: pdps.reduce((s, p) => s + p.m2, 0),
        lines: pdps.reduce((s, p) => s + p.lines, 0),
        pdps,
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
    byPdp,
    reqLites: qualities.reduce((s, q) => s + q.reqLites, 0),
    m2: qualities.reduce((s, q) => s + q.m2, 0),
    lines: qualities.reduce((s, q) => s + q.lines, 0),
  };
}
