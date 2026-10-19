// The line's two calculators, which lived at the bottom of the template's
// Rapport sheet (template #26 and earlier): how long a run of plates takes at
// a speed, and how many plates go through in a time. A plate takes its length
// plus the 150 mm gap between two plates; the speed is in m/min. Results are
// rounded the way the line counts: the time to the minute, whole plates. The
// values typed stay on this device. Opened from the app's header, on every
// page.

import { useEffect, useState } from 'react';
import { load, save } from '../lib/storage';
import { CloseIcon, ResetIcon, ToIcon } from './icons';

const GAP_M = 0.15;
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

function Result({ label, value }: { label: string; value: string }) {
  return (
    <div className="sc-result" aria-live="polite">
      <span className="sc-label">{label}</span>
      <output className={`sc-value${value === '—' ? ' is-empty' : ''}`}>{value}</output>
    </div>
  );
}

export default function SuiviCalculs({ onClose }: { onClose: () => void }) {
  const [v, setV] = useState<Inputs>(() => ({ ...DEFAULTS, ...load<Partial<Inputs>>(KEY, {}) }));
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
      <div className="sheet sc-sheet" role="dialog" aria-modal="true" aria-label="Calcul Temps">
        <div className="grabber" />
        <div className="sheet-head">
          <div className="sheet-head-titles">
            <h3>Calcul Temps</h3>
          </div>
          <button type="button" className="btn ghost icon" onClick={onClose} aria-label="Fermer">
            <CloseIcon />
          </button>
        </div>

        <div className="sc-row sc-line">
          <Field label="Vitesse" unit="m/min" value={v.vitesse} onChange={set('vitesse')} />
          <Field label="Longueur de plaque" unit="mm" value={v.longueur} onChange={set('longueur')} />
        </div>

        <div className="sc-calcs">
          <section className="sc-card">
            <Field label="Plaques" unit="plaques" value={v.plaques} onChange={set('plaques')} />
            <ToIcon className="sc-to" size={18} />
            <Result label="Temps" value={time} />
          </section>
          <section className="sc-card">
            <Field label="Temps" unit="min" value={v.temps} onChange={set('temps')} />
            <ToIcon className="sc-to" size={18} />
            <Result label="Plaques" value={count > 0 ? fmt(Math.floor(count), 0) : '—'} />
          </section>
        </div>

        <div className="sc-actions">
          <button type="button" className="btn ghost mini" onClick={() => setV(DEFAULTS)}>
            <ResetIcon size={14} /> Valeurs par défaut
          </button>
        </div>
      </div>
    </>
  );
}
