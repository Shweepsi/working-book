// The shift's date and poste, handed to the workbook.
//
// In Excel the Suivi template works them out from its own file path
// (`CELL("filename")` on …\2026\10.Octobre\15\[… - Poste C.xlsx]), into the
// cells named `Date` and `Poste`. In the app the file has no such path, so the
// app fills those two cells itself: it reads where the template defines the
// names, and the shared workbook puts the values there on every device that
// opens the shift — locally, like a peer's edit, never sent to the Worker.

import type { CellChange, Partition } from './sharedGrid';

/** One file of the .xlsx (a zip), or null. */
async function zipEntry(bytes: ArrayBuffer, name: string): Promise<string | null> {
  const b = new Uint8Array(bytes);
  const view = new DataView(bytes);
  // End of central directory: last "PK\5\6".
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const entry = decoder.decode(b.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
    if (entry !== name) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = b.slice(start, start + size);
    if (method === 0) return decoder.decode(data);
    if (method !== 8) return null;
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  }
  return null;
}

const unescapeXml = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Where a workbook-level name points, when it is a single cell. */
function namedCell(workbookXml: string, name: string): { sheet: string; cell: string } | null {
  for (const m of workbookXml.matchAll(/<definedName\b([^>]*)>([^<]*)<\/definedName>/g)) {
    const attrs = m[1];
    if (!new RegExp(`\\bname="${name}"`).test(attrs) || /\blocalSheetId=/.test(attrs)) continue;
    const ref = unescapeXml(m[2]).trim().match(/^(?:'((?:[^']|'')+)'|([^!'"]+))!\$?([A-Z]{1,3})\$?(\d+)$/);
    if (!ref) return null;
    return { sheet: (ref[1] ?? ref[2]).replace(/''/g, "'"), cell: `${ref[3]}${ref[4]}` };
  }
  return null;
}

/** Excel's serial for a YYYY-MM-DD day (1900 date system). */
function serial(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/** The cells that give the workbook its shift, for a template that names them. */
export async function shiftContext(template: ArrayBuffer, p: Partition): Promise<CellChange[]> {
  try {
    const xml = await zipEntry(template, 'xl/workbook.xml');
    if (!xml) return [];
    const out: CellChange[] = [];
    const date = namedCell(xml, 'Date');
    if (date) out.push({ ...date, c: { v: { t: 'Number', v: serial(p.date) } } });
    const poste = namedCell(xml, 'Poste');
    if (poste) out.push({ ...poste, c: { v: { t: 'Text', v: p.poste } } });
    return out;
  } catch {
    // A template without them, or one this can't read: the cells keep their formulas.
    return [];
  }
}
