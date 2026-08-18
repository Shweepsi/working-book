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
import { useToast } from '../lib/toast';
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

export interface Test {
  id: string;
  header: TestHeader;
  td: Record<string, string>;
  optoplex: Record<string, YabValues>;
  zeiss: Record<string, YabValues>;
  stack: StackValues;
  comments: string;
  // Audit timestamps (epoch ms). Optional for legacy compatibility.
  createdAt?: number;
  updatedAt?: number;
}

export interface TestState {
  tests: Test[];
  activeId: string;
}

export type TestSetState = (next: TestState | ((prev: TestState) => TestState)) => void;

// Test mutator, shared between ProductionTestView and the journal's
// TestSheet — one write path, so the timestamp stamping can never drift.
export function patchTestById(
  setState: TestSetState,
  id: string,
  updater: (t: Test) => Test,
): void {
  const now = Date.now();
  setState((s) => ({
    ...s,
    tests: s.tests.map((t) =>
      t.id === id ? { ...updater(t), createdAt: t.createdAt ?? now, updatedAt: now } : t,
    ),
  }));
}

type YabGroup = 'optoplex' | 'zeiss';

// A production test belongs to a specific shift (Matin / Après-Midi / Nuit),
// not just to a date — multiple postes share the same calendar day. The key
// is keyed by (date, shift) directly; the poste is recorded inside the test
// header for the printout.
export function prodTestStorageKey(date: string, shiftKey: ShiftKey): string {
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
export function sanitizeTestNo(raw: string | null | undefined): string {
  const digits = String(raw ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return '';
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n) || n < 1) return '';
  return String(Math.min(399, n));
}

export function displayTestNo(raw: string | null | undefined): string {
  const s = sanitizeTestNo(raw);
  return s ? `#${s}` : '';
}

// Whether any measurement has been typed into the sheet — the difference the
// journal's chip shows between "test logged" and "measurements filled in".
export function testHasMeasures(t: Test): boolean {
  const grids = [t.td, ...Object.values(t.optoplex), ...Object.values(t.zeiss), t.stack];
  return grids.some((g) => Object.values(g).some((v) => v && String(v).trim() !== ''));
}

export function emptyTest(): Test {
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
    createdAt: now.getTime(),
    updatedAt: now.getTime(),
  };
}

export function initialProdTestState(date: string, shiftKey: ShiftKey, poste: Poste | null): TestState {
  const v6 = load<TestState | null>(prodTestStorageKey(date, shiftKey), null);
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

// The standalone tab owns its own hook; the unified Logbook page hoists the
// state and renders ProductionTestView directly. Never both at once — App
// mounts one tab at a time — which the sync layer requires: two live hooks on
// the same partition never see each other's writes (see selfWrites in
// lib/sync.ts).
export default function ProductionTest({ poste, shiftMeta }: ProductionTestProps) {
  const { date, shift } = shiftMeta;
  const shiftKey = shift.key;
  const cacheKey = prodTestStorageKey(date, shiftKey);
  const init = useCallback(
    () => initialProdTestState(date, shiftKey, poste),
    [date, shiftKey, poste],
  );
  const [state, setState] = useSyncedState<TestState>(
    cacheKey,
    { domain: 'prodtest', params: { date, shift: shiftKey } },
    init,
    // One test sheet per shift, filled from wherever the measurements are taken.
    { live: true },
  );
  return <ProductionTestView poste={poste} shiftMeta={shiftMeta} state={state} setState={setState} />;
}

interface ProductionTestViewProps extends ProductionTestProps {
  state: TestState;
  setState: TestSetState;
}

export function ProductionTestView({ poste, shiftMeta, state, setState }: ProductionTestViewProps) {
  const toast = useToast();

  const active: Test | undefined = state.tests.find((t) => t.id === state.activeId) ?? state.tests[0];

  function patchActive(updater: (t: Test) => Test) {
    if (!active) return;
    patchTestById(setState, active.id, updater);
  }

  function reset() {
    if (!active) return;
    const snapshot = active;
    setState((s) => ({
      ...s,
      tests: s.tests.map((t) =>
        t.id === snapshot.id ? { ...emptyTest(), id: t.id } : t,
      ),
    }));
    toast.show({
      message: 'Mesures effacées',
      undo: () => {
        setState((s) => ({
          ...s,
          tests: s.tests.map((t) => (t.id === snapshot.id ? snapshot : t)),
        }));
      },
    });
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
    const snapshot = active;
    let removedIndex = -1;
    setState((s) => {
      removedIndex = s.tests.findIndex((t) => t.id === snapshot.id);
      const next = s.tests.filter((t) => t.id !== snapshot.id);
      const fallback = next[Math.min(removedIndex, next.length - 1)]?.id ?? '';
      return { tests: next, activeId: fallback };
    });
    const insertAt = removedIndex;
    const label = displayTestNo(snapshot.header.testNo) || 'Test';
    toast.show({
      message: `${label} supprimé`,
      undo: () => {
        setState((s) => {
          if (s.tests.some((t) => t.id === snapshot.id)) return s;
          const next = [...s.tests];
          next.splice(Math.min(insertAt, next.length), 0, snapshot);
          return { tests: next, activeId: snapshot.id };
        });
      },
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
        </div>
      )}

      {active && (<>
      <div className="print-header print-only">
        <h1>Test · Poste {poste} · {shiftMeta.shift.label}</h1>
        <div className="meta">
          <span><strong>Test n°:</strong> {displayTestNo(active.header.testNo) || '____________'}</span>
          <span><strong>Date:</strong> {shiftMeta.dateLabel} {active.header.hour}</span>
          <span><strong>Opérateur:</strong> {active.header.operator || '____________________'}</span>
        </div>
      </div>

      <TestFields test={active} onPatch={patchActive} />

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
        <button
          className="btn"
          onClick={autofill}
          title="Remplir automatiquement la date et l'heure"
        >
          <span className="lbl-full">↻ Remplir auto date / heure</span>
          <span className="lbl-short">↻ Auto</span>
        </button>
        <button className="btn ghost" onClick={reset} title="Effacer les valeurs saisies">
          <span className="lbl-full">Effacer</span>
          <span className="lbl-short" aria-hidden="true">⌫</span>
        </button>
        <button className="btn ghost" onClick={deleteActive} title="Supprimer ce test">
          <span className="lbl-full">Supprimer</span>
          <span className="lbl-short" aria-hidden="true">🗑</span>
        </button>
        <button className="btn" onClick={() => window.print()} title="Imprimer le test">
          <span className="lbl-full">Imprimer</span>
          <span className="lbl-short" aria-hidden="true">🖨</span>
        </button>
      </div>
      </>)}
    </div>
  );
}

interface TestFieldsProps {
  test: Test;
  onPatch: (updater: (t: Test) => Test) => void;
}

// The whole editable body of one test — header fields plus the measurement
// grids. Shared between the full-page view above and the journal's
// bottom-sheet (TestSheet), so the two can never drift apart. Enter-key
// navigation relies on document-wide data attributes, so only one TestFields
// may be mounted at a time — the page guarantees it.
export function TestFields({ test, onPatch }: TestFieldsProps) {
  function patchHeader<K extends keyof TestHeader>(field: K, value: TestHeader[K]) {
    onPatch((t) => ({ ...t, header: { ...t.header, [field]: value } }));
  }

  function patchTd(code: string, value: string) {
    onPatch((t) => ({ ...t, td: { ...t.td, [code]: value } }));
  }

  function patchYab(group: YabGroup, code: string, axis: YabAxis, value: string) {
    onPatch((t) => ({
      ...t,
      [group]: {
        ...t[group],
        [code]: { ...(t[group][code] || {}), [axis]: value },
      },
    }));
  }

  function patchStack(axis: StackAxis, value: string) {
    onPatch((t) => ({ ...t, stack: { ...t.stack, [axis]: value } }));
  }

  return (
    <>
      <header className="pt-header">
        <Field
          label="Test n°"
          prefix="#"
          inputMode="numeric"
          maxLength={3}
          value={test.header.testNo}
          onChange={(v) => patchHeader('testNo', sanitizeTestNo(v))}
        />
        <Field label="Opérateur" value={test.header.operator} onChange={(v) => patchHeader('operator', v)} />
        <Field label="Date" type="date" value={test.header.date} onChange={(v) => patchHeader('date', v)} auto />
        <Field label="Heure" value={test.header.hour} onChange={(v) => patchHeader('hour', v)} auto />
        <Field label="Produit" value={test.header.product} onChange={(v) => patchHeader('product', v)} />
        <Field label="M3 Lot" value={test.header.m3Lot} onChange={(v) => patchHeader('m3Lot', v)} />
        <Field label="Épaisseur" value={test.header.thickness} onChange={(v) => patchHeader('thickness', v)} />
        <Field label="Origine" value={test.header.origin} onChange={(v) => patchHeader('origin', v)} />
        <Field label="Résistance" value={test.header.resistance} onChange={(v) => patchHeader('resistance', v)} />
        <Field label="Vitesse" value={test.header.speed} onChange={(v) => patchHeader('speed', v)} />
      </header>

      <Section title="Transmissions Digitales">
        <div className="measure-grid" style={{ '--cols': 2 } as React.CSSProperties}>
          {TD_PAIRS.flatMap(([a, b]) => [
            <TdCell key={a} code={a} value={test.td[a] || ''} onChange={(v) => patchTd(a, v)} />,
            <TdCell key={b} code={b} value={test.td[b] || ''} onChange={(v) => patchTd(b, v)} />,
          ])}
        </div>
      </Section>

      <YabSection
        title="Optoplex"
        section="optoplex"
        codes={OPTOPLEX_CODES}
        values={test.optoplex}
        onChange={(code, axis, v) => patchYab('optoplex', code, axis, v)}
      />

      <YabSection
        title="Zeiss"
        section="zeiss"
        codes={ZEISS_CODES}
        values={test.zeiss}
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
                value={test.stack[axis]}
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
            value={test.comments}
            onChange={(e) => {
              const v = e.target.value;
              onPatch((t) => ({ ...t, comments: v }));
            }}
          />
        </div>
      </Section>
    </>
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
