// Coater throughput maths used by the Schedules page.
//
// Verified against the user's Excel screenshot:
//   3210 mm × 6000 mm × 28 lites / 1e6 = 539.28 m²
//   Σ longueur·lites / 1000 / 6 m·min⁻¹ = 575 min = 9 h 35 min
//   575 × 1.09                          = 626.75 min ≈ 10 h 27 min

import type { CoaterRow } from '../types.ts';

export const DOWNTIME_FACTOR = 1.09;

export const rowM2 = (largeur: number, longueur: number, schedLites: number): number =>
  (largeur * longueur * schedLites) / 1_000_000;

export const totalM2 = (rows: CoaterRow[]): number =>
  rows.reduce((sum, r) => sum + (r.m2 ?? rowM2(r.largeur, r.longueur, r.schedLites)), 0);

export const totalMeters = (rows: CoaterRow[]): number =>
  rows.reduce((sum, r) => sum + (r.longueur * r.schedLites) / 1000, 0);

export const totalLites = (rows: CoaterRow[]): number =>
  rows.reduce((sum, r) => sum + (r.schedLites ?? 0), 0);

export const totalReqLites = (rows: CoaterRow[]): number =>
  rows.reduce((sum, r) => sum + (r.reqLites ?? 0), 0);

export function minutesAt(rows: CoaterRow[], vitesse: number | string): number | null {
  const v = Number(vitesse);
  if (!Number.isFinite(v) || v <= 0) return null;
  return totalMeters(rows) / v;
}

export function fmtHMmin(minutes: number | null | undefined): string {
  // Truncate to whole minutes to match the source spreadsheet's formatting
  // (`[h] h mm min`, where Excel floors the seconds).
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  const total = Math.floor(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')} h ${String(m).padStart(2, '0')} min`;
}
