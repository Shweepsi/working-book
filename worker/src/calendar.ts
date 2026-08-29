// Flux ICS du roulement 4 postes (feu continu, cycle de 28 jours).
//
// Les evenements sont derives de CYCLE / POSTE_OFFSET (src/lib/shiftCalendar.ts),
// la meme source que l'app : le calendrier publie ne peut pas diverger de ce que
// l'operateur voit dans Working Book.
//
// Un evenement par jour du cycle, repete tous les 28 jours (RRULE FREQ=DAILY;
// INTERVAL=28) : le flux est infini, tient en une vingtaine d'evenements, et
// n'exige aucune regeneration.

import { CYCLE, POSTE_OFFSET, POSTES } from '../../src/lib/shiftCalendar';
import type { Poste, ShiftKey } from '../../src/types';

const TZ = 'Europe/Luxembourg';
const ANCHOR = '20260101'; // Poste C = N ce jour-la (index 0 du cycle)

interface Creneau {
  nom: string;
  debut?: string;
  fin?: string;
  finJ1?: number;
  journee?: boolean;
}

const CRENEAUX: Record<ShiftKey, Creneau> = {
  // Titre court et rien d'autre : l'horaire est deja porte par l'evenement,
  // le repeter dans le libelle ne fait que le tronquer dans la vue mois.
  M: { nom: 'Matin', debut: '060000', fin: '140000', finJ1: 0 },
  A: { nom: 'Après-midi', debut: '140000', fin: '220000', finJ1: 0 },
  // La nuit s'arrete a minuit plutot qu'a 6h : l'evenement tient alors sur une
  // seule journee au lieu de deborder sur la case du lendemain, ou il masquait
  // le poste suivant. C'est un choix d'affichage, pas la fin reelle du poste.
  N: { nom: 'Nuit', debut: '220000', fin: '000000', finJ1: 1 },
  R: { nom: 'Repos', journee: true },
};

// Le fuseau est embarque : Google le tolere sans, les autres clients non.
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${TZ}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

function ajouterJours(yyyymmdd: string, n: number): string {
  const d = new Date(
    Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8)),
  );
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// Repli des lignes a 75 octets (RFC 5545).
function plier(ligne: string): string {
  if (ligne.length <= 75) return ligne;
  const out = [ligne.slice(0, 75)];
  let reste = ligne.slice(75);
  while (reste.length > 74) {
    out.push(' ' + reste.slice(0, 74));
    reste = reste.slice(74);
  }
  if (reste) out.push(' ' + reste);
  return out.join('\r\n');
}

export function parsePoste(raw: string | null): Poste {
  const p = (raw ?? 'C').trim().toUpperCase();
  return (POSTES as readonly string[]).includes(p) ? (p as Poste) : 'C';
}

export function buildICS(poste: Poste, avecRepos: boolean): string {
  // Le poste X vit le cycle de C decale de POSTE_OFFSET[X] jours : le jour J du
  // cycle pour ce poste tombe donc a ANCHOR - offset + J.
  const offset = POSTE_OFFSET[poste];
  const lignes: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Working Book//Feu continu 4 postes//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:Postes ${poste}`,
    `X-WR-TIMEZONE:${TZ}`,
    'REFRESH-INTERVAL;VALUE=DURATION:P1D',
    'X-PUBLISHED-TTL:P1D',
    ...VTIMEZONE,
  ];

  CYCLE.forEach((code, i) => {
    if (code === 'R' && !avecRepos) return;
    const c = CRENEAUX[code];
    const jour = ajouterJours(ANCHOR, i - offset);
    lignes.push('BEGIN:VEVENT');
    lignes.push(`UID:wb-poste-${poste}-${i}@working-book`);
    lignes.push('DTSTAMP:20260101T000000Z');
    lignes.push(plier(`SUMMARY:${c.nom}`));
    if (c.journee) {
      lignes.push(`DTSTART;VALUE=DATE:${jour}`);
      lignes.push(`DTEND;VALUE=DATE:${ajouterJours(jour, 1)}`);
      lignes.push('TRANSP:TRANSPARENT');
    } else {
      lignes.push(`DTSTART;TZID=${TZ}:${jour}T${c.debut}`);
      lignes.push(`DTEND;TZID=${TZ}:${ajouterJours(jour, c.finJ1 ?? 0)}T${c.fin}`);
      lignes.push('TRANSP:OPAQUE');
    }
    lignes.push('RRULE:FREQ=DAILY;INTERVAL=28');
    lignes.push('END:VEVENT');
  });

  lignes.push('END:VCALENDAR');
  return lignes.join('\r\n') + '\r\n';
}
