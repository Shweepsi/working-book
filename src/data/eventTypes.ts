// Event types operators log during a shift, with their default category.
// `defaultFlag` is the category we auto-assign when the operator hasn't picked one;
// `bold` highlights state-change events (Brûlage, Refroidissement, Ventilation).

import type { EventType, Flag, FlagKey, FlagTint } from '../types.ts';

export const EVENT_TYPES: EventType[] = [
  { key: 'Production', label: 'Production', defaultFlag: 'normal', bold: false },
  { key: 'Recherche Couleur', label: 'Recherche Couleur', defaultFlag: 'note', bold: false },
  { key: 'Brûlage', label: 'Brûlage', defaultFlag: 'scheduled', bold: true },
  { key: 'Refroidissement', label: 'Refroidissement', defaultFlag: 'scheduled', bold: true },
  { key: 'Qualité', label: 'Qualité', defaultFlag: 'ok', bold: false },
  { key: 'Développement', label: 'Développement', defaultFlag: 'note', bold: false },
  { key: 'Entretien', label: 'Entretien', defaultFlag: 'unscheduled', bold: false },
  { key: 'Ventilation', label: 'Ventilation', defaultFlag: 'unscheduled', bold: true },
  { key: 'Conditionnement', label: 'Conditionnement', defaultFlag: 'normal', bold: false },
];

// Categories: Normal, OK, Scheduled, Unscheduled, Note
export const FLAGS: Record<FlagKey, Flag> = {
  normal: { key: 'normal', label: 'Normal', tint: null },
  ok: { key: 'ok', label: 'OK', tint: 'green' },
  scheduled: { key: 'scheduled', label: 'Scheduled', tint: 'yellow' },
  unscheduled: { key: 'unscheduled', label: 'Unscheduled', tint: 'red' },
  note: { key: 'note', label: 'Note', tint: 'blue' },
};

export function tintForFlag(flagKey: FlagKey | '' | null | undefined): FlagTint {
  if (!flagKey) return null;
  return FLAGS[flagKey]?.tint ?? null;
}
