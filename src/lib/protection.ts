// A shift's protection plates (« plaques de protection »): plates put with the
// glass to protect it, reported by the operator to the supervisor in the
// shift's bilan. Never rejects: they have their own rubric, their own totals,
// and stay out of every reject figure and rate.
//
// One synced partition per (date, poste) like the logbook (`/api/protection`,
// last write wins, offline queue, followed live while the bilan is open). The
// dimension is typed by hand: length and thickness as written (« 6 », « 6UC »).

import { useEffect, useState } from 'react';
import { apiGet } from './api';
import type { Partition } from './sharedGrid';
import { load } from './storage';
import { useSyncedState } from './sync';

export interface ProtectionLine {
  id: string;
  /** mm, as typed. */
  longueur: string;
  epaisseur: string;
  nombre: number;
}

export interface ProtectionState {
  lines: ProtectionLine[];
  comment: string;
}

export const EMPTY_PROTECTION: ProtectionState = { lines: [], comment: '' };

const cacheKey = (p: Partition) => `wb.protection.${p.date}.${p.poste}`;

/** Whatever is stored, in shape (an old or foreign value reads as empty). */
export function normalizeProtection(v: unknown): ProtectionState {
  if (!v || typeof v !== 'object') return EMPTY_PROTECTION;
  const { lines, comment } = v as { lines?: unknown; comment?: unknown };
  return {
    lines: Array.isArray(lines)
      ? lines
          .filter((l): l is ProtectionLine => !!l && typeof l === 'object' && typeof (l as ProtectionLine).id === 'string')
          .map((l) => ({ id: l.id, longueur: String(l.longueur ?? ''), epaisseur: String(l.epaisseur ?? ''), nombre: Math.max(0, Math.round(Number(l.nombre) || 0)) }))
      : [],
    comment: typeof comment === 'string' ? comment : '',
  };
}

export const newLineId = () => `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

/** « 6000 x 6 »; what's missing shows as « ? ». */
export const dimLabel = (l: { longueur: string; epaisseur: string }) => `${l.longueur.trim() || '?'} x ${l.epaisseur.trim() || '?'}`;

export const totalOf = (s: ProtectionState) => s.lines.reduce((n, l) => n + l.nombre, 0);

/** Lines of several shifts by dimension, most first. */
export function byDimension(states: ProtectionState[]): { dim: string; nombre: number }[] {
  const m = new Map<string, number>();
  for (const s of states) for (const l of s.lines) if (l.nombre > 0) m.set(dimLabel(l), (m.get(dimLabel(l)) ?? 0) + l.nombre);
  return [...m].map(([dim, nombre]) => ({ dim, nombre })).sort((a, b) => b.nombre - a.nombre || a.dim.localeCompare(b.dim));
}

/** The shift's protection plates, editable; synced and followed live. */
export function useProtection(part: Partition | null): [ProtectionState, (next: ProtectionState | ((prev: ProtectionState) => ProtectionState)) => void] {
  const key = part ? cacheKey(part) : 'wb.protection.none';
  const [value, setValue] = useSyncedState<ProtectionState>(
    key,
    part ? { domain: 'protection', params: { date: part.date, poste: part.poste } } : null,
    () => normalizeProtection(load<unknown>(key, null)),
    { live: true },
  );
  return [normalizeProtection(value), setValue];
}

/** Several shifts' protection plates, read (not followed): the day's bilan. Again after 30 s while shown. */
export function useProtectionOf(parts: Partition[], enabled: boolean): Map<string, ProtectionState> {
  const [map, setMap] = useState<Map<string, ProtectionState>>(new Map());
  const sig = parts.map((p) => `${p.date}|${p.poste}`).join(',');
  useEffect(() => {
    if (!enabled || !parts.length) return;
    let alive = true;
    const read = async () => {
      const entries = await Promise.all(
        parts.map(async (p) => {
          try {
            const env = await apiGet<unknown>(`/api/protection?date=${p.date}&poste=${p.poste}`);
            return [`${p.date}|${p.poste}`, normalizeProtection(env?.data ?? load<unknown>(cacheKey(p), null))] as const;
          } catch {
            return [`${p.date}|${p.poste}`, normalizeProtection(load<unknown>(cacheKey(p), null))] as const;
          }
        }),
      );
      if (alive) setMap(new Map(entries));
    };
    void read();
    const t = setInterval(read, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // `sig` stands for `parts`.
  }, [sig, enabled]);
  return map;
}
