// `prefill: true` means the editor opens with desc set to the type label;
// `prefill: false` opens with an empty description for the operator to type.
// Order matters — the type strip renders prefilled types first, then ad-hoc.

export const EVENT_TYPES = [
  { key: 'Production',        label: 'Production',        defaultFlag: 'ok',          prefill: true  },
  { key: 'Recherche Couleur', label: 'Recherche Couleur', defaultFlag: 'scheduled',   prefill: true  },
  { key: 'Développement',     label: 'Développement',     defaultFlag: 'scheduled',   prefill: true  },
  { key: 'Entretien',         label: 'Entretien',         defaultFlag: 'scheduled',   prefill: true  },
  { key: 'Conditionnement',   label: 'Conditionnement',   defaultFlag: 'scheduled',   prefill: true  },
  { key: 'Ventilation',       label: 'Ventilation',       defaultFlag: 'unscheduled', prefill: true  },
  { key: 'Brûlage',           label: 'Brûlage',           defaultFlag: 'scheduled',   prefill: true  },
  { key: 'Refroidissement',   label: 'Refroidissement',   defaultFlag: 'scheduled',   prefill: true  },
  { key: 'Pompage',           label: 'Pompage',           defaultFlag: 'normal',      prefill: true  },
  { key: 'Leak Test',         label: 'Leak Test',         defaultFlag: 'normal',      prefill: true  },
  { key: 'Arrêt',             label: 'Arrêt',             defaultFlag: 'unscheduled', prefill: false },
  { key: 'Qualité',           label: 'Qualité',           defaultFlag: 'normal',      prefill: false },
  { key: 'Note',              label: 'Note',              defaultFlag: 'note',        prefill: false },
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
