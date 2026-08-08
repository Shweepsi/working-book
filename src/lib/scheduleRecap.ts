// Aggregation behind the schedule's second print mode — the portrait "récap
// plaques" sheet.
//
// The detailed landscape sheet answers "what is there to produce, line by
// line". This one answers a different question, the one asked in front of the
// racks: "for each dimension and each thickness, how many lites are still to
// produce, and have I got the plates for it". So the planning rows collapse
// into qualité → dimension → épaisseur buckets, and the plate count itself is
// left blank — nobody has that figure in the report, it is written by hand.
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

// Same treatment for a row the report gave no PDP: named, sorted last, never
// folded into a real one.
const NO_PDP_KEY = '';
const NO_PDP_LABEL = 'PDP non renseigné';

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
  key: string;
  label: string;
  reqLites: number;
  m2: number;
  lines: number;
  thicknesses: RecapThicknessGroup[];
}

export interface RecapDimensionGroup {
  key: string;
  label: string;
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
//   "O PL6"      -> "6 mm"    a plain 6 mm plate
//   "O PL44.2"   -> "4.4.2"   4 + 4 + a 0.2 interlayer
//   "O SP3 PL6"  -> "6 mm"    SP3 says nothing about the plate
//   "O"          -> "O"       nothing to unpack, left as it is
//
// Only the `PL` payload is kept: the leading "O" is on every PDP, and the other
// tokens don't change what comes off the rack. Since they are dropped from the
// label they are dropped from the grouping too — two PDPs that differ only by
// one of them are the same plate, and printing them as two identical headings
// would only look like a bug. A payload with a decimal is a laminate (its
// whole-number part is the plies, one digit each); one without is a thickness.
export function pdpLabel(pdp: string): string {
  const tokens = pdp.split(/\s+/).filter((t) => t && t !== 'O');
  const pl = tokens.find((t) => /^PL[\d.]+$/.test(t));
  if (!pl) return tokens.join(' ') || pdp;

  const [whole = '', decimals] = pl.slice(2).split('.');
  return decimals ? `${whole.split('').join('.')}.${decimals}` : `${whole} mm`;
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
 */
export function buildScheduleRecap(rows: PMS230Record[]): ScheduleRecap {
  // Nested maps keep insertion cheap; the ordering is imposed once at the end,
  // because it isn't the order rows arrive in (the table's sort is the user's,
  // and it may be on any column).
  type ThicknessBuckets = Map<string, PMS230Record[]>;
  type PdpBuckets = Map<string, ThicknessBuckets>;
  const byQualite = new Map<string, Map<string, PdpBuckets>>();

  for (const r of rows) {
    // A row with no dimension is not a plate to prepare — QC samples are
    // already filtered out upstream, but a malformed row would otherwise open
    // a "0 × 0" group that means nothing on the racks.
    if (!r.largeur || !r.longueur) continue;

    const qualite = r.qualite || NO_QUALITE;
    const dimKey = `${r.largeur}×${r.longueur}`;
    // Keyed on the plate the PDP calls for, not on its raw text — see pdpLabel.
    const pdpKey = r.pdp ? pdpLabel(r.pdp) : NO_PDP_KEY;
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
          label: pdpKey || NO_PDP_LABEL,
          reqLites: thicknesses.reduce((s, t) => s + t.reqLites, 0),
          m2: thicknesses.reduce((s, t) => s + t.m2, 0),
          lines: thicknesses.reduce((s, t) => s + t.lines, 0),
          thicknesses,
        });
      }

      // PDP descending, the planner's secondary sort in the detailed table
      // (longueur DESC, PDP DESC). A row without one lands last whatever the
      // comparison would otherwise do with an empty string.
      pdps.sort((a, b) => {
        if (!a.key !== !b.key) return a.key ? -1 : 1;
        return b.key.localeCompare(a.key, 'fr');
      });

      const first = pdpBuckets.values().next().value!.values().next().value![0]!;
      dimensions.push({
        key: dimKey,
        label: dimensionLabel(first.largeur, first.longueur),
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
