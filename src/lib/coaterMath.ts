// Coater throughput maths used by the Schedules page.
//
// Verified against the user's Excel reference: all maths run against
// reqLites (remaining work), so the schedule and footer agree once
// production has started:
//   3210 mm × 6000 mm × N reqLites / 1e6           = m² restants
//   Σ longueur·reqLites / 1000 / vitesse[m·min⁻¹]  = minutes
//   minutes × 1.09                                 = minutes + 9 % DT

export interface CoaterRow {
  largeur: number;
  longueur: number;
  schedLites: number;
  reqLites?: number;
  m2?: number;
}

export const DOWNTIME_FACTOR = 1.09;

const rowM2 = (largeur: number, longueur: number, schedLites: number): number =>
  (largeur * longueur * schedLites) / 1_000_000;

export const totalM2 = (rows: CoaterRow[]): number =>
  rows.reduce((sum, r) => sum + (r.m2 ?? rowM2(r.largeur, r.longueur, r.schedLites)), 0);

// Linear length still to coat, based on reqLites (sched minus already produced).
// Falls back to schedLites for rows that don't carry a reqLites value.
const coaterMeters = (rows: CoaterRow[]): number =>
  rows.reduce((sum, r) => sum + (r.longueur * (r.reqLites ?? r.schedLites)) / 1000, 0);

export const totalLites = (rows: CoaterRow[]): number =>
  rows.reduce((sum, r) => sum + (r.schedLites ?? 0), 0);

export const totalReqLites = (rows: CoaterRow[]): number =>
  rows.reduce((sum, r) => sum + (r.reqLites ?? 0), 0);

// Time still needed at the given speed (m/min). Returns null if the speed is
// not a positive number so the UI can render a fallback.
export function minutesAt(rows: CoaterRow[], vitesse: number | string): number | null {
  const v = Number(vitesse);
  if (!Number.isFinite(v) || v <= 0) return null;
  return coaterMeters(rows) / v;
}

export function fmtHMmin(minutes: number | null | undefined): string {
  // Truncate to whole minutes to match the source spreadsheet's formatting
  // (`[h] h mm min`, where Excel floors the seconds). Negative inputs would
  // mean a "remaining time" already overshot (overproduction) and produce
  // misleading negative h/m via floor — bail to the same em dash as null.
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return '—';
  const total = Math.floor(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')} h ${String(m).padStart(2, '0')} min`;
}
