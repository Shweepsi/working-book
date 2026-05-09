import { useCallback } from 'react';
import {
  HEADER_DEFAULTS,
  OPTOPLEX_CODES,
  STACK_AXES,
  TD_ENTER_ORDER,
  TD_PAIRS,
  YAB_AXES,
  ZEISS_CODES,
  yabEnterOrder,
  type StackAxis,
  type YabAxis,
} from '../data/productionTest';
import { fmtHM } from '../lib/time';
import { load } from '../lib/storage';
import { useSyncedState } from '../lib/sync';
import type { Poste, ShiftKey, ShiftMeta } from '../types';

interface TestHeader {
  testNo: string;
  operator: string;
  date: string;
  hour: string;
  product: string;
  speed: string;
  m3Lot: string;
  thickness: string;
  origin: string;
  resistance: string;
}

type YabValues = Partial<Record<YabAxis, string>>;
type StackValues = Record<StackAxis, string>;

interface Test {
  id: string;
  header: TestHeader;
  td: Record<string, string>;
  optoplex: Record<string, YabValues>;
  zeiss: Record<string, YabValues>;
  stack: StackValues;
  comments: string;
}

interface TestState {
  tests: Test[];
  activeId: string;
}

type YabGroup = 'optoplex' | 'zeiss';

// A production test belongs to a specific shift (Matin / Après-Midi / Nuit),
// not just to a date — multiple postes share the same calendar day. The key
// is keyed by (date, shift) directly; the poste is recorded inside the test
// header for the printout.
function storageKey(date: string, shiftKey: ShiftKey): string {
  return `wb.prodtest.v6.${date}.${shiftKey}`;
}

// v5 keyed by (date, poste). Since poste is bijective with shiftKey on a given
// date, v5 data migrates 1-for-1 by looking it up under the current poste.
function v5Key(date: string, poste: Poste | null): string {
  return `wb.prodtest.v5.${date}.${poste}`;
}

function v4Key(date: string, poste: Poste | null): string {
  return `wb.prodtest.v4.${date}.${poste}`;
}

function newId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// Test n° accepts integers 1..399. Strips non-digits, drops leading zeros,
// clamps the high end. Returns '' for empty / zero input so the placeholder shows.
function sanitizeTestNo(raw: string | null | undefined): string {
  const digits = String(raw ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return '';
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n) || n < 1) return '';
  return String(Math.min(399, n));
}

function displayTestNo(raw: string | null | undefined): string {
  const s = sanitizeTestNo(raw);
  return s ? `#${s}` : '';
}

function emptyTest(): Test {
  const now = new Date();
  return {
    id: newId(),
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

function initialState(date: string, shiftKey: ShiftKey, poste: Poste | null): TestState {
  const v6 = load<TestState | null>(storageKey(date, shiftKey), null);
  if (v6 && Array.isArray(v6.tests) && v6.tests.length > 0) {
    return v6;
  }
  const v5 = load<TestState | null>(v5Key(date, poste), null);
  if (v5 && Array.isArray(v5.tests) && v5.tests.length > 0) {
    return v5;
  }
  const legacy = load<Partial<Test> | null>(v4Key(date, poste), null);
  if (legacy && legacy.header) {
    const test: Test = { ...emptyTest(), ...legacy, id: newId() };
    return { tests: [test], activeId: test.id };
  }
  return { tests: [], activeId: '' };
}

interface ProductionTestProps {
  poste: Poste | null;
  shiftMeta: ShiftMeta;
}

export default function ProductionTest({ poste, shiftMeta }: ProductionTestProps) {
  const { date, shift } = shiftMeta;
  const shiftKey = shift.key;
  const cacheKey = storageKey(date, shiftKey);
  const init = useCallback(
    () => initialState(date, shiftKey, poste),
    [date, shiftKey, poste],
  );
  const [state, setState] = useSyncedState<TestState>(
    cacheKey,
    { domain: 'prodtest', params: { date, shift: shiftKey } },
    init,
  );

  const active: Test | undefined = state.tests.find((t) => t.id === state.activeId) ?? state.tests[0];

  function patchActive(updater: (t: Test) => Test) {
    if (!active) return;
    setState((s) => ({
      ...s,
      tests: s.tests.map((t) => (t.id === active.id ? updater(t) : t)),
    }));
  }

  function patchHeader<K extends keyof TestHeader>(field: K, value: TestHeader[K]) {
    patchActive((t) => ({ ...t, header: { ...t.header, [field]: value } }));
  }

  function patchTd(code: string, value: string) {
    patchActive((t) => ({ ...t, td: { ...t.td, [code]: value } }));
  }

  function patchYab(group: YabGroup, code: string, axis: YabAxis, value: string) {
    patchActive((t) => ({
      ...t,
      [group]: {
        ...t[group],
        [code]: { ...(t[group][code] || {}), [axis]: value },
      },
    }));
  }

  function patchStack(axis: StackAxis, value: string) {
    patchActive((t) => ({ ...t, stack: { ...t.stack, [axis]: value } }));
  }

  function reset() {
    if (!active) return;
    if (!window.confirm('Effacer toutes les mesures de ce test ?')) return;
    setState((s) => ({
      ...s,
      tests: s.tests.map((t) =>
        t.id === active.id ? { ...emptyTest(), id: t.id } : t,
      ),
    }));
  }

  function autofill() {
    const now = new Date();
    patchActive((t) => ({
      ...t,
      header: {
        ...t.header,
        hour: fmtHM(now),
        date: now.toISOString().slice(0, 10),
      },
    }));
  }

  function addTest() {
    const t = emptyTest();
    setState((s) => ({ tests: [...s.tests, t], activeId: t.id }));
  }

  function selectTest(id: string) {
    setState((s) => ({ ...s, activeId: id }));
  }

  function deleteActive() {
    if (!active) return;
    if (!window.confirm('Supprimer ce test ?')) return;
    setState((s) => {
      const idx = s.tests.findIndex((t) => t.id === active.id);
      const next = s.tests.filter((t) => t.id !== active.id);
      const fallback = next[Math.min(idx, next.length - 1)]?.id ?? '';
      return { tests: next, activeId: fallback };
    });
  }

  return (
    <div className="pt">
      <div className="pt-tests no-print" role="tablist" aria-label="Tests">
        <button
          type="button"
          className="pt-test-chip add"
          onClick={addTest}
          title="Ajouter un nouveau test"
        >
          <span className="glyph">＋</span> Nouveau
        </button>
        {state.tests.map((t, i) => {
          const label = displayTestNo(t.header.testNo) || `Test ${i + 1}`;
          const isActive = active?.id === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`pt-test-chip ${isActive ? 'active' : ''}`}
              onClick={() => selectTest(t.id)}
              title={`Aller à ${label}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {!active && (
        <div className="pt-empty no-print">
          <h3>Aucun test en cours</h3>
          <p className="faint">Cliquer sur <strong>＋ Nouveau</strong> pour commencer un test.</p>
        </div>
      )}

      {active && (<>
      <div className="print-header print-only">
        <h1>Test production · Poste {poste} · {shiftMeta.shift.label}</h1>
        <div className="meta">
          <span><strong>Test n°:</strong> {displayTestNo(active.header.testNo) || '____________'}</span>
          <span><strong>Date:</strong> {shiftMeta.dateLabel} {active.header.hour}</span>
          <span><strong>Opérateur:</strong> {active.header.operator || '____________________'}</span>
        </div>
      </div>

      <header className="pt-header">
        <Field
          label="Test n°"
          prefix="#"
          inputMode="numeric"
          maxLength={3}
          value={active.header.testNo}
          onChange={(v) => patchHeader('testNo', sanitizeTestNo(v))}
        />
        <Field label="Opérateur" value={active.header.operator} onChange={(v) => patchHeader('operator', v)} />
        <Field label="Date" type="date" value={active.header.date} onChange={(v) => patchHeader('date', v)} auto />
        <Field label="Heure" value={active.header.hour} onChange={(v) => patchHeader('hour', v)} auto />
        <Field label="Produit" value={active.header.product} onChange={(v) => patchHeader('product', v)} />
        <Field label="M3 Lot" value={active.header.m3Lot} onChange={(v) => patchHeader('m3Lot', v)} />
        <Field label="Épaisseur" value={active.header.thickness} onChange={(v) => patchHeader('thickness', v)} />
        <Field label="Origine" value={active.header.origin} onChange={(v) => patchHeader('origin', v)} />
        <Field label="Résistance" value={active.header.resistance} onChange={(v) => patchHeader('resistance', v)} />
        <Field label="Vitesse" value={active.header.speed} onChange={(v) => patchHeader('speed', v)} />
      </header>

      <Section title="Transmissions Digitales">
        <div className="measure-grid" style={{ '--cols': 2 } as React.CSSProperties}>
          {TD_PAIRS.flatMap(([a, b]) => [
            <TdCell key={a} code={a} value={active.td[a] || ''} onChange={(v) => patchTd(a, v)} />,
            <TdCell key={b} code={b} value={active.td[b] || ''} onChange={(v) => patchTd(b, v)} />,
          ])}
        </div>
      </Section>

      <YabSection
        title="Optoplex"
        section="optoplex"
        codes={OPTOPLEX_CODES}
        values={active.optoplex}
        onChange={(code, axis, v) => patchYab('optoplex', code, axis, v)}
      />

      <YabSection
        title="Zeiss"
        section="zeiss"
        codes={ZEISS_CODES}
        values={active.zeiss}
        onChange={(code, axis, v) => patchYab('zeiss', code, axis, v)}
      />

      <Section title="Stack Analysis">
        <div className="lab-grid">
          <div className="head" />
          {STACK_AXES.map((a) => (
            <div key={a} className="head">{a}</div>
          ))}
          <div className="rowlabel">Thermal</div>
          {STACK_AXES.map((axis) => (
            <div key={axis} className="lab-cell">
              <input
                inputMode="decimal"
                value={active.stack[axis]}
                data-stack-axis={axis}
                onChange={(e) => patchStack(axis, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const next = STACK_AXES[STACK_AXES.indexOf(axis) + 1];
                  if (!next) return;
                  const el = document.querySelector<HTMLInputElement>(`input[data-stack-axis="${next}"]`);
                  if (el) {
                    el.focus();
                    el.select?.();
                  }
                }}
              />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Commentaires">
        <div className="pt-comments">
          <textarea
            placeholder="Notes, anomalies, conditions particulières…"
            value={active.comments}
            onChange={(e) => {
              const v = e.target.value;
              patchActive((t) => ({ ...t, comments: v }));
            }}
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
        <button className="btn" onClick={autofill}>↻ Remplir auto date / heure</button>
        <button className="btn ghost" onClick={reset}>Effacer</button>
        <button className="btn ghost" onClick={deleteActive}>Supprimer</button>
        <button className="btn" onClick={() => window.print()}>Imprimer</button>
      </div>
      </>)}
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  auto?: boolean;
  type?: string;
  prefix?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  maxLength?: number;
}

function Field({ label, value, onChange, auto, type, prefix, inputMode, maxLength }: FieldProps) {
  const input = (
    <input
      type={type || 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      inputMode={inputMode}
      maxLength={maxLength}
    />
  );
  return (
    <div className={`field ${auto ? 'auto' : ''} ${prefix ? 'has-prefix' : ''}`}>
      <label>{label}</label>
      {prefix ? (
        <div className="field-input">
          <span className="field-prefix" aria-hidden="true">{prefix}</span>
          {input}
        </div>
      ) : (
        input
      )}
    </div>
  );
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <section className="pt-section">
      <header>
        <h3>{title}</h3>
      </header>
      {children}
    </section>
  );
}

interface TdCellProps {
  code: string;
  value: string;
  onChange: (v: string) => void;
}

function TdCell({ code, value, onChange }: TdCellProps) {
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const idx = TD_ENTER_ORDER.indexOf(code);
    const nextCode = TD_ENTER_ORDER[idx + 1];
    if (!nextCode) return;
    const next = document.querySelector<HTMLInputElement>(`input[data-td-code="${nextCode}"]`);
    if (next) {
      next.focus();
      next.select?.();
    }
  }
  return (
    <div className="measure-cell">
      <span className="mlabel">{code}</span>
      <input
        inputMode="decimal"
        value={value}
        data-td-code={code}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}

interface YabSectionProps {
  title: string;
  section: YabGroup;
  codes: readonly string[];
  values: Record<string, YabValues>;
  onChange: (code: string, axis: YabAxis, v: string) => void;
}

function YabSection({ title, section, codes, values, onChange }: YabSectionProps) {
  const order = yabEnterOrder(codes);
  return (
    <Section title={title}>
      <div className="lab-grid">
        <div className="head" />
        {YAB_AXES.map((a) => (
          <div key={a} className="head">{a}</div>
        ))}
        {codes.map((code) => (
          <YabRow
            key={code}
            section={section}
            code={code}
            values={values[code] || {}}
            order={order}
            onChange={(axis, v) => onChange(code, axis, v)}
          />
        ))}
      </div>
    </Section>
  );
}

interface YabRowProps {
  section: YabGroup;
  code: string;
  values: YabValues;
  order: string[];
  onChange: (axis: YabAxis, v: string) => void;
}

function YabRow({ section, code, values, order, onChange }: YabRowProps) {
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, axis: YabAxis) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const idx = order.indexOf(`${code}.${axis}`);
    const next = order[idx + 1];
    if (!next) return;
    const el = document.querySelector<HTMLInputElement>(`input[data-yab-key="${section}.${next}"]`);
    if (el) {
      el.focus();
      el.select?.();
    }
  }
  return (
    <>
      <div className="rowlabel">{code}</div>
      {YAB_AXES.map((axis) => (
        <div key={axis} className="lab-cell">
          <input
            inputMode="decimal"
            value={values[axis] || ''}
            data-yab-key={`${section}.${code}.${axis}`}
            onChange={(e) => onChange(axis, e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, axis)}
          />
        </div>
      ))}
    </>
  );
}
