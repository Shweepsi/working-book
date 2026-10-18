// The shift's bilan from the Loading and Unloading tabs (lib/line.ts), in the
// same shape and by the same rules as the workbook's (lib/suiviBilan.ts):
//   - Loading = Consommées of the jumbos, Unloading = Lites of the racks,
//     Scraps = the scraps' quantities; delta = loading − unloading − scraps;
//   - m² = length × 3210 mm × lites;
//   - a scrap counts against its own dimension, « length x thickness »;
//   - what went through a dimension = its racks' lites plus its scraps.
// A colour is its name: two colours typed alike on two tablets are one.

import { area, dimLabel, fmtNum, loadingFilled, loadingIssues, scrapFilled, scrapIssues, unloadingFilled, unloadingIssues, type LineData } from './line';
import {
  closeRejects,
  closeTotals,
  emptyTotals,
  NO_COLOUR,
  rejectAcc,
  type BilanCheck,
  type BilanColour,
  type BilanTotals,
  type RejectAcc,
  type SuiviBilan,
} from './suiviBilan';

interface Acc {
  name: string;
  none: boolean;
  inDl: boolean;
  inFl: boolean;
  raw: BilanTotals;
  acc: RejectAcc;
  checks: BilanCheck[];
}

const short = (defect: string) => defect.split(' - ')[0] || defect;

export function computeLineBilan(d: LineData): SuiviBilan {
  const names = new Map(d.colours.map((c) => [c.id, c.name.trim().toUpperCase()]));
  const colours = new Map<string, Acc>();
  const colourOf = (id: string | null): Acc => {
    const name = (id && names.get(id)) || null;
    const key = name ?? NO_COLOUR;
    let c = colours.get(key);
    if (!c) {
      c = { name: key, none: name === null, inDl: false, inFl: false, raw: emptyTotals(), acc: rejectAcc(), checks: [] };
      colours.set(key, c);
    }
    return c;
  };
  // The colours in the order they started, whatever was typed first.
  for (const c of d.colours) if (c.name.trim()) colourOf(c.id);

  // A row's number within its colour, on its tab (what the operator sees).
  const counter = new Map<string, number>();
  const nth = (tab: string, c: Acc) => {
    const k = `${tab}|${c.name}`;
    const n = (counter.get(k) ?? 0) + 1;
    counter.set(k, n);
    return n;
  };
  let empty = true;

  for (const r of d.loading) {
    if (!loadingFilled(r)) continue;
    empty = false;
    const c = colourOf(r.colour);
    c.inDl = true;
    c.raw.dl += r.conso ?? 0;
    c.raw.dlM2 += area(r.dim, r.conso);
    const n = nth('loading', c);
    const issues = loadingIssues(r);
    if (issues.length) c.checks.push({ text: `Loading, ligne ${n}${r.tag.trim() ? ` (${r.tag.trim()})` : ''} : ${issues.join(', ')}.`, target: { tab: 'loading', id: r.id } });
  }

  for (const r of d.unloading) {
    if (!unloadingFilled(r)) continue;
    empty = false;
    const c = colourOf(r.colour);
    c.inFl = true;
    c.raw.fl += r.lites ?? 0;
    c.raw.flM2 += area(r.dim, r.lites);
    const label = dimLabel(r.dim, r.ep);
    const dim = c.acc.dims.get(label) ?? { dim: label, passees: 0, rejets: 0 };
    dim.passees += r.lites ?? 0;
    c.acc.dims.set(label, dim);
    const n = nth('unloading', c);
    const issues = unloadingIssues(r);
    if (issues.length) c.checks.push({ text: `Unloading, rack ${n}${r.tag.trim() ? ` (${r.tag.trim()})` : ''} : ${issues.join(', ')}.`, target: { tab: 'unloading', id: r.id } });
  }

  for (const s of d.scraps) {
    if (!scrapFilled(s)) continue;
    empty = false;
    const c = colourOf(s.colour);
    c.inFl = true;
    const q = s.qty ?? 0;
    const label = dimLabel(s.dim, s.ep);
    c.raw.rejets += q;
    c.raw.rejetsM2 += area(s.dim, q);
    const name = s.defect.trim();
    if (name && q) {
      const def = c.acc.defects.get(name) ?? { defect: name, total: 0, m2: 0, byDim: {} };
      def.total += q;
      def.m2 += area(s.dim, q);
      def.byDim[label] = (def.byDim[label] ?? 0) + q;
      c.acc.defects.set(name, def);
    }
    const dim = c.acc.dims.get(label) ?? { dim: label, passees: 0, rejets: 0 };
    dim.passees += q;
    dim.rejets += q;
    c.acc.dims.set(label, dim);
    const n = nth('scrap', c);
    const issues = scrapIssues(s);
    if (issues.length) {
      const what = name ? short(name) : q ? `${fmtNum(q)} lites` : '';
      c.checks.push({ text: `Scrap ${n}${what ? ` (${what})` : ''} : ${issues.join(', ')}.`, target: { tab: 'unloading', id: s.id } });
    }
  }

  const all = emptyTotals();
  const out: BilanColour[] = [];
  const used: Acc[] = [];
  for (const c of colours.values()) {
    // A colour started but with nothing under it yet.
    if (!(c.raw.dl || c.raw.fl || c.raw.rejets || c.checks.length || c.acc.dims.size || c.inDl || c.inFl)) continue;
    used.push(c);
    for (const k of Object.keys(all) as (keyof BilanTotals)[]) all[k] += c.raw[k];
    const checks = [...c.checks];
    if (c.none) checks.unshift({ text: 'Ces lignes n’ont pas de couleur : indique-la en tête du bloc « Sans couleur », dans Loading ou Unloading.' });
    out.push({ name: c.name, none: c.none, inDl: c.inDl, inFl: c.inFl, totals: closeTotals(c.raw), rejects: closeRejects([c.acc], c.raw.rejetsM2), checks });
  }
  // Rows under no colour last: what to fix, after the production.
  out.sort((a, b) => Number(a.none) - Number(b.none));
  return {
    totals: closeTotals(all),
    rejects: closeRejects(
      used.map((c) => c.acc),
      all.rejetsM2,
    ),
    checks: out.flatMap((c) => c.checks),
    colours: out,
    empty,
  };
}
