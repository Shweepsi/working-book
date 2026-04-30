// `prefill: true` opens the editor with desc set to the type label;
// `prefill: false` opens with an empty description.
// `row: 1 | 2` controls which row of the type strip the button lives in.
// `openNote: true` seeds an empty note row so the editor opens with the
//   notes section already prompting input.

export const EVENT_TYPES = [
  // Row 1 — recurring operations, prefilled description, no note prompt.
  { key: 'Développement',     label: 'Développement',     defaultFlag: 'scheduled',   prefill: true,  row: 1 },
  { key: 'Entretien',         label: 'Entretien',         defaultFlag: 'scheduled',   prefill: true,  row: 1 },
  { key: 'Conditionnement',   label: 'Conditionnement',   defaultFlag: 'scheduled',   prefill: true,  row: 1 },
  { key: 'Ventilation',       label: 'Ventilation',       defaultFlag: 'unscheduled', prefill: true,  row: 1 },
  { key: 'Brûlage',           label: 'Brûlage',           defaultFlag: 'scheduled',   prefill: true,  row: 1 },
  { key: 'Refroidissement',   label: 'Refroidissement',   defaultFlag: 'scheduled',   prefill: true,  row: 1 },
  { key: 'Pompage',           label: 'Pompage',           defaultFlag: 'normal',      prefill: true,  row: 1 },
  { key: 'Leak Test',         label: 'Leak Test',         defaultFlag: 'normal',      prefill: true,  row: 1 },

  // Row 2 — Production / Recherche Couleur keep their prefill but open with a
  // note prompt; Arrêt / Qualité / Note are pure ad-hoc.
  { key: 'Production',        label: 'Production',        defaultFlag: 'ok',          prefill: true,  row: 2, openNote: true },
  { key: 'Recherche Couleur', label: 'Recherche Couleur', defaultFlag: 'scheduled',   prefill: true,  row: 2, openNote: true },
  { key: 'Arrêt',             label: 'Arrêt',             defaultFlag: 'unscheduled', prefill: false, row: 2 },
  { key: 'Qualité',           label: 'Qualité',           defaultFlag: 'normal',      prefill: false, row: 2 },
  { key: 'Note',              label: 'Note',              defaultFlag: 'note',        prefill: false, row: 2 },
];

// Categories: Normal, OK, Scheduled, Unscheduled, Note
export const FLAGS = {
  normal: { key: 'normal', label: 'Normal', tint: null },
  ok: { key: 'ok', label: 'OK', tint: 'green' },
  scheduled: { key: 'scheduled', label: 'Scheduled', tint: 'yellow' },
  unscheduled: { key: 'unscheduled', label: 'Unscheduled', tint: 'red' },
  note: { key: 'note', label: 'Note', tint: 'blue' },
};

export function tintForFlag(flagKey) {
  return FLAGS[flagKey]?.tint ?? null;
}
