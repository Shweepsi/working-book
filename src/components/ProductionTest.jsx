import { useEffect, useMemo, useState } from 'react';
import {
  HEADER_DEFAULTS,
  OPTOPLEX_CODES,
  TD_PAIRS,
  TOLERANCE,
  ZEISS_CODES,
  checkTolerance,
} from '../data/productionTest.js';
import { fmtHM } from '../lib/time.js';
import { load, save } from '../lib/storage.js';

function storageKey(date, poste) {
  return `wb.prodtest.v4.${date}.${poste}`;
}

function emptyTest(now) {
  return {
    header: {
      testNo: '',
      operator: '',
      date: now.toISOString().slice(0, 10),
      hour: fmtHM(now),
      product: HEADER_DEFAULTS.product,
      speed: HEADER_DEFAULTS.speed,
      m3Lot: '',
      thickness: '',
      origin: '',
      resistance: '',
    },
    td: {},
    optoplex: {},
    zeiss: {},
    stack: { Tsol: '', Rsol: '', Asol: '' },
    comments: '',
  };
}

export default function ProductionTest({ now, poste, shiftMeta }) {
  const { date } = shiftMeta;
  const [state, setState] = useState(() => load(storageKey(date, poste), emptyTest(now)));

  useEffect(() => {
    setState(load(storageKey(date, poste), emptyTest(now)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, poste]);

  useEffect(() => {
    save(storageKey(date, poste), state);
  }, [state, date, poste]);

  const stats = useMemo(() => computeStats(state), [state]);

  function patchHeader(field, value) {
    setState((s) => ({ ...s, header: { ...s.header, [field]: value } }));
  }

  function patchTd(code, value) {
    setState((s) => ({ ...s, td: { ...s.td, [code]: value } }));
  }

  function patchYab(group, code, axis, value) {
    setState((s) => ({
      ...s,
      [group]: {
        ...s[group],
        [code]: { ...(s[group][code] || {}), [axis]: value },
      },
    }));
  }

  function patchStack(axis, value) {
    setState((s) => ({ ...s, stack: { ...s.stack, [axis]: value } }));
  }

  function reset() {
    if (!window.confirm('Clear all measurements for this test?')) return;
    setState(emptyTest(now));
  }

  function autofill() {
    setState((s) => ({
      ...s,
      header: { ...s.header, hour: fmtHM(now), date: now.toISOString().slice(0, 10) },
    }));
  }

  return (
    <div className="pt">
      <div className="print-header print-only">
        <h1>Production Test · Poste {poste} · {shiftMeta.shift.label}</h1>
        <div className="meta">
          <span><strong>Test n°:</strong> {state.header.testNo || '____________'}</span>
          <span><strong>Date:</strong> {shiftMeta.dateLabel} {state.header.hour}</span>
          <span><strong>Opérateur:</strong> {state.header.operator || '____________________'}</span>
        </div>
      </div>

      <header className="pt-header">
        <Field label="Test n°" value={state.header.testNo} onChange={(v) => patchHeader('testNo', v)} />
        <Field label="Opérateur" value={state.header.operator} onChange={(v) => patchHeader('operator', v)} />
        <Field label="Date" type="date" value={state.header.date} onChange={(v) => patchHeader('date', v)} auto />
        <Field label="Heure" value={state.header.hour} onChange={(v) => patchHeader('hour', v)} auto />
        <Field label="Produit" value={state.header.product} onChange={(v) => patchHeader('product', v)} />
        <Field label="Vitesse" value={state.header.speed} onChange={(v) => patchHeader('speed', v)} />
        <Field label="M3 Lot" value={state.header.m3Lot} onChange={(v) => patchHeader('m3Lot', v)} />
        <Field label="Épaisseur" value={state.header.thickness} onChange={(v) => patchHeader('thickness', v)} />
        <Field label="Origine" value={state.header.origin} onChange={(v) => patchHeader('origin', v)} />
        <Field label="Résistance" value={state.header.resistance} onChange={(v) => patchHeader('resistance', v)} />
      </header>

      <Section
        title="Transmissions Digitales"
        hint={`${TD_PAIRS.length * 2} mesures · tol. ${TOLERANCE.td.min}–${TOLERANCE.td.max}`}
      >
        <div className="measure-grid" style={{ '--cols': 2 }}>
          {TD_PAIRS.flatMap(([a, b]) => [
            <TdCell key={a} code={a} value={state.td[a] || ''} onChange={(v) => patchTd(a, v)} />,
            <TdCell key={b} code={b} value={state.td[b] || ''} onChange={(v) => patchTd(b, v)} />,
          ])}
        </div>
      </Section>

      <YabSection
        title="Optoplex"
        codes={OPTOPLEX_CODES}
        tol={TOLERANCE.optoplex}
        values={state.optoplex}
        onChange={(code, axis, v) => patchYab('optoplex', code, axis, v)}
      />

      <YabSection
        title="Zeiss"
        codes={ZEISS_CODES}
        tol={TOLERANCE.zeiss}
        values={state.zeiss}
        onChange={(code, axis, v) => patchYab('zeiss', code, axis, v)}
      />

      <Section title="Stack Analysis" hint="Thermal · Tsol / Rsol / Asol">
        <div className="lab-grid">
          <div className="head" />
          <div className="head">Tsol</div>
          <div className="head">Rsol</div>
          <div className="head">Asol</div>
          <div className="rowlabel">Thermal</div>
          {['Tsol', 'Rsol', 'Asol'].map((axis) => {
            const status = checkTolerance(TOLERANCE.stack[axis], state.stack[axis]);
            return (
              <div key={axis} className={`lab-cell ${status === 'ok' ? 'ok' : status === 'bad' ? 'bad' : ''}`}>
                <input
                  inputMode="decimal"
                  value={state.stack[axis]}
                  onChange={(e) => patchStack(axis, e.target.value)}
                />
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Commentaires" hint="">
        <div className="pt-comments">
          <textarea
            placeholder="Notes, anomalies, conditions particulières…"
            value={state.comments}
            onChange={(e) => setState((s) => ({ ...s, comments: e.target.value }))}
          />
        </div>
      </Section>

      <div className="print-signature print-only">
        <div className="sig-row">
          <div>
            <div className="sig-line" />
            <div className="sig-label">Opérateur · Poste {poste}</div>
          </div>
          <div>
            <div className="sig-line" />
            <div className="sig-label">QC visa</div>
          </div>
        </div>
      </div>

      <div className="pt-actions sticky no-print">
        <button className="btn" onClick={autofill}>↻ Auto-fill date / hour</button>
        <button className="btn ghost" onClick={reset}>Clear</button>
        <button className="btn" onClick={() => window.print()}>Print</button>
        <span className="health">
          <strong>{stats.filled}</strong>/{stats.total} mesures ·{' '}
          {stats.bad > 0
            ? <span style={{ color: '#a14233' }}><strong>{stats.bad}</strong> hors tolérance</span>
            : <span>aucune hors tolérance</span>}
        </span>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, auto, type }) {
  return (
    <div className={`field ${auto ? 'auto' : ''}`}>
      <label>{label}</label>
      <input
        type={type || 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function Section({ title, hint, children }) {
  return (
    <section className="pt-section">
      <header>
        <h3>{title}</h3>
        {hint && <span className="hint">{hint}</span>}
      </header>
      {children}
    </section>
  );
}

function TdCell({ code, value, onChange }) {
  const status = checkTolerance(TOLERANCE.td, value);
  return (
    <div className={`measure-cell ${status === 'ok' ? 'ok' : status === 'bad' ? 'bad' : ''}`}>
      <span className="mlabel">{code}</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function YabSection({ title, codes, tol, values, onChange }) {
  return (
    <Section title={title} hint="Y / a* / b*">
      <div className="lab-grid">
        <div className="head" />
        <div className="head">Y</div>
        <div className="head">a*</div>
        <div className="head">b*</div>
        {codes.map((code) => (
          <YabRow
            key={code}
            code={code}
            tol={tol}
            values={values[code] || {}}
            onChange={(axis, v) => onChange(code, axis, v)}
          />
        ))}
      </div>
    </Section>
  );
}

function YabRow({ code, tol, values, onChange }) {
  return (
    <>
      <div className="rowlabel">{code}</div>
      {['Y', 'a*', 'b*'].map((axis) => {
        const status = checkTolerance(tol[axis], values[axis]);
        return (
          <div key={axis} className={`lab-cell ${status === 'ok' ? 'ok' : status === 'bad' ? 'bad' : ''}`}>
            <input
              inputMode="decimal"
              value={values[axis] || ''}
              onChange={(e) => onChange(axis, e.target.value)}
            />
          </div>
        );
      })}
    </>
  );
}

function computeStats(state) {
  let filled = 0;
  let bad = 0;
  let total = 0;

  for (const [a, b] of TD_PAIRS) {
    for (const code of [a, b]) {
      total += 1;
      const status = checkTolerance(TOLERANCE.td, state.td[code] || '');
      if (status === 'ok') filled += 1;
      else if (status === 'bad' || status === 'invalid') {
        filled += 1;
        bad += 1;
      }
    }
  }

  for (const [group, codes, tol] of [
    ['optoplex', OPTOPLEX_CODES, TOLERANCE.optoplex],
    ['zeiss', ZEISS_CODES, TOLERANCE.zeiss],
  ]) {
    for (const code of codes) {
      for (const axis of ['Y', 'a*', 'b*']) {
        total += 1;
        const v = state[group][code]?.[axis] || '';
        const status = checkTolerance(tol[axis], v);
        if (status === 'ok') filled += 1;
        else if (status === 'bad' || status === 'invalid') {
          filled += 1;
          bad += 1;
        }
      }
    }
  }

  for (const axis of ['Tsol', 'Rsol', 'Asol']) {
    total += 1;
    const status = checkTolerance(TOLERANCE.stack[axis], state.stack[axis]);
    if (status === 'ok') filled += 1;
    else if (status === 'bad' || status === 'invalid') {
      filled += 1;
      bad += 1;
    }
  }

  return { filled, bad, total };
}
