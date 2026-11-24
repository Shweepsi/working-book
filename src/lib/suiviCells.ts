// The Loading and Unloading tabs' records, read off a shift's Suivi workbook:
// Suivi is where the line's rows are typed, and what the two tabs and the
// bilan show is computed from its cells each time they change — nothing is
// copied, so they can't disagree with it.
//
// The template's layout (row 2's headings), which the template editor must
// keep:
//   Début de Ligne  B N° TAG · C Lites · D Dimension · E Epaisseur · F Origine ·
//                   G Sens · H Polishing · I Date · J Consommées · K Restantes
//                   (a formula) · L Commentaires
//   Fin de Ligne    N N° TAG · O Frame · P Dimension · Q Epaisseur · R Lites,
//                   then up to three defects: S Défaut · T Commentaires ·
//                   U Quantité, V · W · X, Y · Z · AA
// and the rules of the template's Rapport (lib/suiviBilan.ts):
//   - a row whose N° TAG is a text, not a number, opens a colour's block on its
//     side (« COULEUR », the template's placeholder, opens a block with none);
//   - numbers typed as text count;
//   - a defect belongs to its Fin de Ligne row's dimension: each one is a scrap
//     of that « Dimension x Epaisseur ».
// A row is a record whatever it lacks: what is missing shows as a problem
// (lib/line.ts), not as a row left out.

import { FIRST_ROW, LAST_ROW, PLACEHOLDER, TEMPLATE, filled, isColour, num, text, valueOf, type Value } from './suiviBilan';
import { normEp, toLineData, type Colour, type LineData, type LineRecord, type Scrap } from './line';

const DL = { tag: 'B', lites: 'C', dim: 'D', ep: 'E', origine: 'F', sens: 'G', polishing: 'H', date: 'I', conso: 'J', comment: 'L' } as const;
const DL_FIRST = 'B';
const DL_LAST = 'L';
const FL = { tag: 'N', frame: 'O', dim: 'P', ep: 'Q', lites: 'R' } as const;
const FL_FIRST = 'N';
const FL_LAST = 'AA';
const DEFECTS = [
  { name: 'S', comment: 'T', qty: 'U' },
  { name: 'V', comment: 'W', qty: 'X' },
  { name: 'Y', comment: 'Z', qty: 'AA' },
] as const;
const FL_INPUTS: string[] = [...Object.values(FL), ...DEFECTS.flatMap((d) => [d.name, d.comment, d.qty])];

const numOrNull = (v: Value): number | null => (filled(v) ? num(v) : null);
const noSpaces = (v: Value) => text(v).replace(/\s+/g, '');

/** An Excel date (days since 1899-12-30) as YYYY-MM-DD; anything else as typed. */
function isoDate(v: Value): string {
  if (typeof v !== 'number' || v < 1 || v > 80_000) return text(v);
  return new Date(Math.round((v - 25_569) * 86_400_000)).toISOString().slice(0, 10);
}

/** The records of a shift's Suivi cells (by "Sheet!A1", as GridCraft shares them). */
export function cellsToLine(cells: ReadonlyMap<string, unknown>): LineData {
  const at = (col: string, row: number): Value => {
    const key = `Suivi!${col}${row}`;
    if (cells.has(key)) return valueOf(cells.get(key));
    return TEMPLATE[`${col}${row}`] ?? null;
  };
  const records: LineRecord[] = [];
  const colours = new Map<string, Colour>();

  /** A colour row opens its block: the colour's id, or null for the placeholder. */
  const openBlock = (name: string, row: number, col: string): string | null => {
    const n = name.trim().toUpperCase();
    if (n === PLACEHOLDER) return null;
    const id = `c:${n}`;
    const range = `Suivi!${col}${row}`;
    const known = colours.get(n);
    if (!known) colours.set(n, { id, kind: 'colour', row, range, name: n });
    else if (row < known.row) Object.assign(known, { row, range });
    return id;
  };

  // Début de Ligne.
  {
    let colour: string | null = null;
    for (let r = FIRST_ROW; r <= LAST_ROW; r++) {
      const tag = at(DL.tag, r);
      const colourRow = isColour(tag);
      if (colourRow) colour = openBlock(tag, r, DL.tag);
      // The colour's name is the N° TAG cell: what else is typed on that row counts too.
      const own = (col: string) => !(colourRow && col === DL.tag) && filled(at(col, r));
      if (!Object.values(DL).some(own)) continue;
      records.push({
        id: `l${r}`,
        kind: 'loading',
        row: r,
        range: `Suivi!${DL_FIRST}${r}:${DL_LAST}${r}`,
        colour,
        // The colour row's N° TAG cell holds its name, not a tag: the row is reported as having none.
        tag: colourRow ? '' : noSpaces(tag),
        lites: numOrNull(at(DL.lites, r)),
        dim: numOrNull(at(DL.dim, r)),
        ep: normEp(text(at(DL.ep, r))),
        origine: text(at(DL.origine, r)).toUpperCase(),
        sens: text(at(DL.sens, r)).toUpperCase(),
        polishing: text(at(DL.polishing, r)).toUpperCase(),
        date: isoDate(at(DL.date, r)),
        conso: numOrNull(at(DL.conso, r)),
        comment: text(at(DL.comment, r)),
      });
    }
  }

  // Fin de Ligne.
  {
    let colour: string | null = null;
    for (let r = FIRST_ROW; r <= LAST_ROW; r++) {
      const tag = at(FL.tag, r);
      const colourRow = isColour(tag);
      if (colourRow) colour = openBlock(tag, r, FL.tag);
      const own = (col: string) => !(colourRow && col === FL.tag) && filled(at(col, r));
      if (!FL_INPUTS.some(own)) continue;

      const dim = numOrNull(at(FL.dim, r));
      const ep = normEp(text(at(FL.ep, r)));
      const scraps: Scrap[] = [];
      // A comment beside no defect and no quantity is a note on the rack.
      const notes: string[] = [];
      DEFECTS.forEach((d, i) => {
        const [defect, qty, comment] = [text(at(d.name, r)), at(d.qty, r), text(at(d.comment, r))];
        if (!defect && !filled(qty)) {
          if (comment) notes.push(comment);
          return;
        }
        scraps.push({
          id: `s${r}.${i}`,
          kind: 'scrap',
          row: r,
          range: `Suivi!${d.name}${r}:${d.qty}${r}`,
          colour,
          defect,
          qty: numOrNull(qty),
          dim,
          ep,
          comment,
        });
      });

      // A row that only gives a dimension to its defects is no rack (the
      // October rejects were typed that way): a rack has a N° TAG, a frame or lites.
      const rack = own(FL.tag) || own(FL.frame) || own(FL.lites) || !!notes.length || (!scraps.length && (own(FL.dim) || own(FL.ep)));
      if (rack) {
        records.push({
          id: `u${r}`,
          kind: 'unloading',
          row: r,
          range: `Suivi!${FL_FIRST}${r}:${FL_LAST}${r}`,
          colour,
          tag: colourRow ? '' : noSpaces(tag),
          frame: text(at(FL.frame, r)),
          dim,
          ep,
          lites: numOrNull(at(FL.lites, r)),
          comment: notes.join(' · '),
          withScraps: scraps.some((s) => s.qty) || undefined,
        });
      }
      records.push(...scraps);
    }
  }

  records.push(...colours.values());
  return toLineData(records);
}
