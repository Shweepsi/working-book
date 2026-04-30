// Event types operators log during a shift, with their default category.
// `defaultFlag` is the category we auto-assign when the operator hasn't picked one;
// `bold` highlights state-change events (e.g. Ventilation);
// `prefill` controls whether the editor opens with the description pre-filled
// from the type label (true) or left blank for the operator to type (false).

export const EVENT_TYPES = [
  // Row 1 — recurring operations, description prefilled
  { key: 'Production',       label: 'Production',       defaultFlag: 'normal',      bold: false, prefill: true },
  { key: 'Recherche Couleur', label: 'Recherche Couleur', defaultFlag: 'note',        bold: false, prefill: true },
  { key: 'Développement',    label: 'Développement',    defaultFlag: 'note',        bold: false, prefill: true },
  { key: 'Entretien',        label: 'Entretien',        defaultFlag: 'unscheduled', bold: false, prefill: true },
  { key: 'Conditionnement',  label: 'Conditionnement',  defaultFlag: 'normal',      bold: false, prefill: true },
  { key: 'Ventilation',      label: 'Ventilation',      defaultFlag: 'unscheduled', bold: true,  prefill: true },
  { key: 'Pompage',          label: 'Pompage',          defaultFlag: 'normal',      bold: false, prefill: true },
  { key: 'Leak Test',        label: 'Leak Test',        defaultFlag: 'normal',      bold: false, prefill: true },

  // Row 2 — ad-hoc events, operator types description
  { key: 'Arrêt',   label: 'Arrêt',   defaultFlag: 'unscheduled', bold: false, prefill: false },
  { key: 'Qualité', label: 'Qualité', defaultFlag: 'normal',      bold: false, prefill: false },
  { key: 'Note',    label: 'Note',    defaultFlag: 'note',        bold: false, prefill: false },
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
