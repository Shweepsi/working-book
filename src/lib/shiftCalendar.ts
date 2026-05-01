// 4-shift rotation: 4 postes (A/B/C/D) rotate through a 28-day cycle of
// Matin / Après-Midi / Nuit / Repos.
//
// Source of truth — Poste C calendar 2026 (PDF). Cycle starts Jan 1, 2026:
// Poste C on Jan 1 = N. Postes are spaced 7 days apart so all four shift
// types are always covered by some poste.

import type { Poste, ShiftKey, ShiftType } from '../types.ts';

export const CYCLE: ShiftKey[] = 'NRRRMMAANNNRRMMAAANNRRMMMAAN'.split('') as ShiftKey[]; // length 28

const CYCLE_LEN = CYCLE.length;
const ANCHOR_ISO = '2026-01-01';      // Poste C on this date = N (cycle index 0)
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Offsets relative to Poste C, picked so every day all 4 shift types are
// represented (verified against the 2026 calendar).
export const POSTES: Poste[] = ['A', 'B', 'C', 'D'];
const POSTE_OFFSET: Record<Poste, number> = { C: 0, B: 7, A: 14, D: 21 };

export const SHIFT_TYPES: Record<ShiftKey, ShiftType> = {
  M: { key: 'M', label: 'Matin',       hours: '06h – 14h', range: [6, 14] },
  A: { key: 'A', label: 'Après-Midi',  hours: '14h – 22h', range: [14, 22] },
  N: { key: 'N', label: 'Nuit',        hours: '22h – 06h', range: [22, 30] }, // 30 = next-day 06h
  R: { key: 'R', label: 'Repos',       hours: '—',         range: null },
};

function dateOnly(d: Date): number {
  // Day-precision UTC midnight to avoid DST off-by-ones.
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function dayDiff(a: Date, b: Date): number {
  return Math.round((dateOnly(a) - dateOnly(b)) / MS_PER_DAY);
}

export function shiftFor(poste: Poste, date: string | Date): ShiftType {
  const d = typeof date === 'string' ? parseISODate(date) : date;
  const anchor = parseISODate(ANCHOR_ISO);
  const days = dayDiff(d, anchor);
  const offset = POSTE_OFFSET[poste] ?? 0;
  const idx = ((days + offset) % CYCLE_LEN + CYCLE_LEN) % CYCLE_LEN;
  const code = CYCLE[idx]!;
  return SHIFT_TYPES[code];
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function dateFromISO(iso: string): Date {
  return parseISODate(iso);
}

export function todayISO(now: Date = new Date()): string {
  return isoDate(now);
}

// Pick the poste currently working a given clock-time on a given date.
// At shift boundaries we pick the one *starting* the shift.
export function activePosteAt(date: string | Date, hour: number): Poste | undefined {
  let target: ShiftKey;
  if (hour >= 6 && hour < 14) target = 'M';
  else if (hour >= 14 && hour < 22) target = 'A';
  else target = 'N';
  return POSTES.find((p) => shiftFor(p, date).key === target);
}

export function addDaysISO(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

export function fmtDateLong(iso: string): string {
  const d = parseISODate(iso);
  return d.toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'UTC',
  });
}
