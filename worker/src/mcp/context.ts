// The shift's date and poste, handed to the workbook like the app does
// (src/lib/shiftContext.ts): in Excel the Suivi template works them out from
// its file path into the cells named `Date` and `Poste`; here the file has no
// such path, so those two cells get the shift's values, locally and never
// stored.

import type { Partition } from '../grid';
import type { CellChange } from './engine';

const REF_RE = /^(?:'((?:[^']|'')+)'|([^!'"]+))!\$?([A-Z]{1,3})\$?(\d+)$/;

/** Where a workbook-level name points, when it is a single cell. */
function namedCell(names: { name: string; scope: number | null; formula: string }[], name: string): { sheet: string; cell: string } | null {
  const n = names.find((x) => x.name === name && x.scope === null);
  const ref = n?.formula.replace(/^=/, '').trim().match(REF_RE);
  if (!ref) return null;
  return { sheet: (ref[1] ?? ref[2]).replace(/''/g, "'"), cell: `${ref[3]}${ref[4]}` };
}

/** Excel's serial for a YYYY-MM-DD day (1900 date system). */
function serial(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/** The cells that give the workbook its shift, for a template that names them. */
export function shiftContext(names: { name: string; scope: number | null; formula: string }[], p: Partition): CellChange[] {
  const out: CellChange[] = [];
  const date = namedCell(names, 'Date');
  if (date) out.push({ ...date, c: { v: { t: 'Number', v: serial(p.date) } } });
  const poste = namedCell(names, 'Poste');
  if (poste) out.push({ ...poste, c: { v: { t: 'Text', v: p.poste } } });
  return out;
}
