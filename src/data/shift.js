// Sample shift events from the Poste C / 06h-14h reference data.
// flag: 'planned' | 'unplan' | 'note' | 'ok' | 'normal' | null

let nextId = 1;
const id = () => `e${nextId++}`;

export const SAMPLE_EVENTS = [
  {
    id: id(),
    start: '06:00', end: null, type: 'Reprise',
    desc: 'Reprise du poste en Production',
    notes: ['SG NRG A/R Clear à 6 m/mn'],
    flag: 'normal',
  },
  { id: id(), start: null, end: null, type: 'Test', desc: '#341 Test QC', flag: 'ok' },
  {
    id: id(),
    start: '06:20', end: '06:35', type: 'Brûlage',
    desc: 'Brûlage',
    notes: ['Première plaque #375 à 06:35', 'Dernière plaque #389 à 06:49'],
    flag: 'planned',
  },
  { id: id(), start: null, end: null, type: 'Contrôle', desc: '#18 Contrôle Man31 + Trempe' },
  { id: id(), start: null, end: null, type: 'Test', desc: '#36 Test Vapo' },
  { id: id(), start: null, end: null, type: 'Contrôle', desc: '#177 Contrôle Man31' },
  {
    id: id(),
    start: '09:44', end: '10:15', type: 'Maintenance',
    desc: 'Passage 6.2.6 pour faire tomber O-ring K9',
    flag: 'unplan',
  },
  { id: id(), start: '10:00', end: null, type: 'Test', desc: '#180 Test QC' },
  {
    id: id(),
    start: '10:25', end: '10:40', type: 'Brûlage',
    desc: 'Brûlage',
    notes: ['Première plaque #193 à 10:48'],
    flag: 'planned',
  },
  {
    id: id(),
    start: '10:40', end: '11:00', type: 'Refroidissement',
    desc: 'Refroidissement',
    notes: ['Dernière plaque #36 à 11:13', 'Tests différentes recettes ISRA avec Andjelika'],
    flag: 'planned',
  },
  { id: id(), start: '12:53', end: '12:59', type: 'Coupure', desc: 'Coupure K31', flag: 'unplan' },
  {
    id: id(),
    start: null, end: null, type: 'Contrôle',
    desc: '#302 Contrôle Man31 + Cosmétique (AJ955DE)',
  },
  { id: id(), start: '13:31', end: '13:35', type: 'Coupure', desc: 'Coupure K31', flag: 'unplan' },
];

export const SAMPLE_SHIFT = {
  poste: 'C',
  date: '2026-04-28',
  hours: '06h – 14h',
  operator: '',
};

export function newId() {
  return `e${++nextId}`;
}
