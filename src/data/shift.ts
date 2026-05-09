// Sample shift events for Poste C (06h–14h) using the new type/category set.
import type { LogEvent } from '../types';

let nextId = 1;
const id = () => `e${nextId++}`;

export const SAMPLE_EVENTS: LogEvent[] = [
  {
    id: id(),
    start: '06:00', end: '06:15', type: 'Production',
    desc: 'Reprise du poste',
    notes: ['SG NRG A/R Clear à 6 m/mn'],
    flag: 'normal',
  },
  {
    id: id(),
    start: '06:20', end: '06:35', type: 'Brûlage',
    desc: 'Brûlage',
    notes: ['Première plaque #375 à 06:35', 'Dernière plaque #389 à 06:49'],
    flag: 'scheduled',
  },
  {
    id: id(),
    start: '06:35', end: '07:00', type: 'Refroidissement',
    desc: 'Refroidissement four 1',
    flag: 'scheduled',
  },
  {
    id: id(),
    start: '07:30', end: '07:35', type: 'Qualité',
    desc: '#341 Test QC',
    flag: 'ok',
  },
  {
    id: id(),
    start: '08:15', end: '08:35', type: 'Recherche Couleur',
    desc: 'Tests recettes ISRA avec Andjelika',
    flag: 'note',
  },
  {
    id: id(),
    start: '09:44', end: '10:15', type: 'Entretien',
    desc: 'Passage 6.2.6 pour faire tomber O-ring K9',
    flag: 'unscheduled',
  },
  {
    id: id(),
    start: '10:25', end: '10:40', type: 'Brûlage',
    desc: 'Brûlage',
    notes: ['Première plaque #193 à 10:48'],
    flag: 'scheduled',
  },
  {
    id: id(),
    start: '10:40', end: '11:00', type: 'Refroidissement',
    desc: 'Refroidissement',
    notes: ['Dernière plaque #36 à 11:13'],
    flag: 'scheduled',
  },
  {
    id: id(),
    start: '11:30', end: '12:10', type: 'Conditionnement',
    desc: '#18 Conditionnement Man31 + Trempe',
    flag: 'normal',
  },
  {
    id: id(),
    start: '12:53', end: '12:59', type: 'Ventilation',
    desc: 'Reprise ventilation K31',
    flag: 'unscheduled',
  },
  {
    id: id(),
    start: '13:20', end: '13:30', type: 'Développement',
    desc: 'Test recette nouveau lot M3',
    flag: 'note',
  },
  {
    id: id(),
    start: '13:31', end: '13:55', type: 'Qualité',
    desc: '#302 Contrôle Man31 + Cosmétique (AJ955DE)',
    flag: 'ok',
  },
];

export const SAMPLE_SHIFT = {
  poste: 'C',
  date: '2026-04-28',
  hours: '06h – 14h',
  operator: '',
};

export function newId(): string {
  return `e${nextId++}`;
}
