import type { EventType, Flag, FlagKey, FlagTint } from '../types';

// `prefill: true` opens the editor with desc set to the type label;
// `prefill: false` opens with an empty description.
// `row: 1 | 2` — row 1 is the primary strip, always visible.
//   Row 2 holds the secondary recurring operations and is hidden behind
//   a toggle in the Logbook so the daily UI stays uncluttered.
// `openNote: true` seeds an empty note row so the editor opens with the
//   notes section already prompting input.

export const EVENT_TYPES = [
  // Row 1 — primary, always visible.
  { key: 'Nouveau',           label: 'Nouveau',           defaultFlag: 'normal',      prefill: false, row: 1 },
  { key: 'Production',        label: 'Production',        defaultFlag: 'ok',          prefill: true,  row: 1, openNote: true },
  { key: 'Recherche Couleur', label: 'Recherche Couleur', defaultFlag: 'scheduled',   prefill: true,  row: 1, openNote: true },
  { key: 'Brûlage',           label: 'Brûlage',           defaultFlag: 'scheduled',   prefill: true,  row: 1 },
  { key: 'Arrêt',             label: 'Arrêt',             defaultFlag: 'unscheduled', prefill: false, row: 1 },
  { key: 'Qualité',           label: 'Qualité',           defaultFlag: 'normal',      prefill: 'Test', row: 1 },
  { key: 'Note',              label: 'Note',              defaultFlag: 'note',        prefill: false, row: 1 },

  // Row 2 — secondary recurring operations, hidden behind a toggle.
  { key: 'Développement',     label: 'Développement',     defaultFlag: 'scheduled',   prefill: true,  row: 2 },
  { key: 'Entretien',         label: 'Entretien',         defaultFlag: 'scheduled',   prefill: true,  row: 2 },
  { key: 'Conditionnement',   label: 'Conditionnement',   defaultFlag: 'scheduled',   prefill: true,  row: 2 },
  { key: 'Ventilation',       label: 'Ventilation',       defaultFlag: 'unscheduled', prefill: true,  row: 2 },
  { key: 'Refroidissement',   label: 'Refroidissement',   defaultFlag: 'scheduled',   prefill: true,  row: 2 },
  { key: 'Pompage',           label: 'Pompage',           defaultFlag: 'normal',      prefill: true,  row: 2 },
  { key: 'Leak Test',         label: 'Leak Test',         defaultFlag: 'normal',      prefill: true,  row: 2 },
] as const satisfies readonly EventType[];

export type EventTypeKey = (typeof EVENT_TYPES)[number]['key'];

// Categories: Normal, OK, Scheduled, Unscheduled, Note
export const FLAGS: Record<FlagKey, Flag> = {
  normal: { key: 'normal', label: 'Normal', tint: null },
  ok: { key: 'ok', label: 'OK', tint: 'green' },
  scheduled: { key: 'scheduled', label: 'Planifié', tint: 'yellow' },
  unscheduled: { key: 'unscheduled', label: 'Non planifié', tint: 'red' },
  note: { key: 'note', label: 'Note', tint: 'blue' },
};

export function tintForFlag(flagKey: FlagKey | null | undefined): FlagTint {
  if (!flagKey) return null;
  return FLAGS[flagKey]?.tint ?? null;
}
