// Event types operators log during a shift, with their default flag styling.
// `defaultFlag` is what we auto-apply when the operator hasn't picked one;
// `bold` mirrors the design intent of highlighting state-change events.

export const EVENT_TYPES = [
  { key: 'Reprise', label: 'Reprise', defaultFlag: 'normal', bold: false },
  { key: 'Brûlage', label: 'Brûlage', defaultFlag: 'planned', bold: true },
  { key: 'Refroidissement', label: 'Refroid.', defaultFlag: 'planned', bold: true },
  { key: 'Coupure', label: 'Coupure', defaultFlag: 'unplan', bold: true },
  { key: 'Test', label: 'Test', defaultFlag: null, bold: false },
  { key: 'Contrôle', label: 'Contrôle', defaultFlag: null, bold: false },
  { key: 'Maintenance', label: 'Maintenance', defaultFlag: 'unplan', bold: false },
  { key: 'Note', label: 'Note', defaultFlag: 'note', bold: false },
];

export const FLAGS = {
  planned: { key: 'planned', label: 'Planifié', tint: 'yellow' },
  unplan: { key: 'unplan', label: 'Imprévu', tint: 'red' },
  note: { key: 'note', label: 'Note', tint: 'blue' },
  ok: { key: 'ok', label: 'OK', tint: null },
  normal: { key: 'normal', label: 'Normal', tint: 'green' },
};

export function tintForFlag(flagKey) {
  return FLAGS[flagKey]?.tint ?? null;
}
