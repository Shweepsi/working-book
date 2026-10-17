// The line's two calculators, which lived at the bottom of the template's
// Rapport sheet (template #26 and earlier): how long a run of plates takes at
// a speed, and how many plates go through in a time. A plate takes its length
// plus the 0,19 m gap between two plates; the speed is in m/min. Results are
// rounded the way the line counts: the time to the minute, whole plates. The
// values typed stay on this device. Opened from the Suivi tab and from a
// schedule (with its speed).

import { useEffect, useState } from 'react';
import { load, save } from '../lib/storage';

const GAP_M = 0.19;
const KEY = 'wb.suivi.calculs';

interface Inputs {
  vitesse: string;
  longueur: string;
  plaques: string;
  temps: string;
}

// The Rapport's own figures.
const DEFAULTS: Inputs = { vitesse: '6', longueur: '6000', plaques: '60', temps: '60' };

const parse = (s: string) => {
  const n = Number(s.trim().replace(/\s/g, '').replace(',', '.'));
  return s.trim() && Number.isFinite(n) ? n : NaN;
};

const two = (n: number) => String(n).padStart(2, '0');

/** Minutes → « 1 h 02 », to the minute. */
function duration(min: number): string {
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h} h ${two(m)}` : `${m} min`;
}

/** Minutes → « 1 min 02 s », to the second: one plate's passage. */
function shortDuration(min: number): string {
  const s = Math.round(min * 60);
  return s >= 60 ? `${Math.floor(s / 60)} min ${two(s % 60)} s` : `${s} s`;
}

const fmt = (v: number, digits: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: digits });

interface FieldProps {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
}

function Field({ label, unit, value, onChange }: FieldProps) {
  const bad = value.trim() !== '' && !(parse(value) > 0);
  return (
    <label className={`sc-field${bad ? ' is-bad' : ''}`}>
      <span className="sc-label">{label}</span>
      <span className="sc-input">
        <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={bad} />
        <span className="sc-unit">{unit}</span>
      </span>
    </label>
  );
}

/** `vitesse`: the speed to start from (a schedule's), when there's one. */
export default function SuiviCalculs({ onClose, vitesse: given }: { onClose: () => void; vitesse?: number }) {
  const [v, setV] = useState<Inputs>(() => ({
    ...DEFAULTS,
    ...load<Partial<Inputs>>(KEY, {}),
    ...(given && given > 0 ? { vitesse: String(given).replace('.', ',') } : {}),
  }));
  useEffect(() => save(KEY, v), [v]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const set = (k: keyof Inputs) => (s: string) => setV((x) => ({ ...x, [k]: s }));

  const vitesse = parse(v.vitesse);
  const longueur = parse(v.longueur);
  // Minutes per plate, gap included.
  const perPlate = vitesse > 0 && longueur > 0 ? (longueur / 1000 + GAP_M) / vitesse : NaN;
  const plaques = parse(v.plaques);
  const temps = parse(v.temps);
  const time = perPlate > 0 && plaques > 0 ? duration(perPlate * plaques) : '—';
  const count = perPlate > 0 && temps > 0 ? temps / perPlate : NaN;

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet sc-sheet" role="dialog" aria-modal="true" aria-label="Calculs de ligne">
        <div className="grabber" />
        <div className="sheet-head">
          <div className="sheet-head-titles">
            <h3>Calculs</h3>
            <span className="sheet-head-sub">Vitesse de ligne, temps et nombre de plaques</span>
          </div>
          <button type="button" className="btn ghost icon" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>

        <div className="sc-row">
          <Field label="Vitesse" unit="m/min" value={v.vitesse} onChange={set('vitesse')} />
          <Field label="Longueur de plaque" unit="mm" value={v.longueur} onChange={set('longueur')} />
        </div>
        <p className="sc-hint">
          Une plaque passe en {perPlate > 0 ? shortDuration(perPlate) : '—'}, écart de {fmt(GAP_M, 2)} m entre deux plaques compris.
        </p>

        <section className="sc-card">
          <h4>Temps pour un nombre de plaques</h4>
          <div className="sc-row">
            <Field label="Plaques" unit="plaques" value={v.plaques} onChange={set('plaques')} />
            <div className="sc-result" aria-live="polite">
              <span className="sc-label">Temps</span>
              <strong>{time}</strong>
            </div>
          </div>
        </section>

        <section className="sc-card">
          <h4>Plaques dans un temps</h4>
          <div className="sc-row">
            <Field label="Temps" unit="min" value={v.temps} onChange={set('temps')} />
            <div className="sc-result" aria-live="polite">
              <span className="sc-label">Plaques</span>
              <strong>{count > 0 ? fmt(Math.floor(count), 0) : '—'}</strong>
              {count > 0 && <span className="sc-sub">plaques entières</span>}
            </div>
          </div>
        </section>

        <div className="sc-actions">
          <button type="button" className="btn ghost" onClick={() => setV(DEFAULTS)}>
            Valeurs par défaut
          </button>
        </div>
      </div>
    </>
  );
}
