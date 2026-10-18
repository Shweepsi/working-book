// The line's own input, without a spreadsheet (lib/line.ts, lib/lineSync.ts),
// next to the Suivi workbook: the Loading tab (jumbos loaded at the start of
// the line) and the Unloading tab (racks filled at its end, and the scraps).
//
// Both list the shift's colours in the order they started, each with its
// rows. A field is saved when it's left (Entrée moves on to the next one),
// toggles and lists at once; a new row stays on this tablet until something
// is typed in it, and starts with the row above's dimension, thickness and
// the rest of what a jumbo shares with the previous one. A row is checked
// with the bilan's own rules once the operator leaves it: its problems show
// under it, and in the bilan's « À vérifier », which brings it back here.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  COMMON_COLOURS,
  COMMON_DIMS,
  COMMON_EPS,
  DEFECTS,
  ORIGINES,
  POLISHING,
  SENS,
  area,
  dimLabel,
  fmtNum,
  loadingFilled,
  loadingIssues,
  newId,
  normEp,
  parseNumber,
  scrapFilled,
  scrapIssues,
  unloadingFilled,
  unloadingIssues,
  type Colour,
  type LineData,
  type LineRecord,
  type LoadingRow,
  type Scrap,
  type UnloadingRow,
} from '../lib/line';
import { deleteRecords, lineSync, putRecord, putRecords, useLine, useLineSnapshot } from '../lib/lineSync';
import type { Partition } from '../lib/sharedGrid';
import { useToast } from '../lib/toast';

type Side = 'loading' | 'unloading';

const m2 = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const pct = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %` : '—');
const plural = (n: number, one: string, many = `${one}s`) => `${fmtNum(n)} ${n > 1 ? many : one}`;
const sum = (xs: (number | null)[]) => xs.reduce<number>((n, x) => n + (x ?? 0), 0);
const shortDefect = (d: string) => d.replace(/^([A-Z]\d+) - /, '$1 ');

// The October shifts' most frequent defects, for the quick buttons until the shift has its own.
const FREQUENT_DEFECTS = ['A6 - Flaking', 'C6 - Surplus Special Dimensions', 'A3 - Quality Test', 'A2 - Conditioning/Startup/Color Search'];

/** Entrée: the field is left (and saved), and the next one takes over. */
function onEnter(e: KeyboardEvent<HTMLElement>): void {
  if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
  e.preventDefault();
  const el = e.currentTarget;
  const all = [...(el.closest('.ln')?.querySelectorAll<HTMLElement>('[data-nav]') ?? [])].filter((x) => !(x as HTMLButtonElement).disabled);
  const next = all[all.indexOf(el) + 1];
  el.blur();
  next?.focus();
}

// --- Fields -----------------------------------------------------------------

interface FieldProps {
  label: string;
  /** Laid out by its column (`ln-c-…`). */
  col: string;
  children: ReactNode;
  invalid?: boolean;
  /** Buttons inside (a toggle, a stepper): a group, since a label would press the first one when tapped. */
  group?: boolean;
}

/** A field with its label: the label shows on a phone, where a row is a card; the table's head says it otherwise. */
function Field({ label, col, children, invalid, group }: FieldProps) {
  const cls = `ln-f ln-c-${col}${invalid ? ' is-bad' : ''}`;
  if (group)
    return (
      <div className={cls} role="group" aria-label={label}>
        <span className="ln-f-label" aria-hidden="true">
          {label}
        </span>
        {children}
      </div>
    );
  return (
    <label className={cls}>
      <span className="ln-f-label">{label}</span>
      {children}
    </label>
  );
}

interface TextInputProps {
  value: string;
  onCommit: (text: string) => void;
  label: string;
  numeric?: boolean;
  list?: string;
  placeholder?: string;
  autoFocus?: boolean;
  upper?: boolean;
  invalid?: boolean;
  /** Left, changed or not. */
  onDone?: () => void;
}

/** Typed freely, saved when left — and only if it changed since it was entered, so a peer's
 * edit made meanwhile isn't overwritten by a field nobody touched. */
function TextInput({ value, onCommit, label, numeric, list, placeholder, autoFocus, upper, invalid, onDone }: TextInputProps) {
  const [text, setText] = useState<string | null>(null);
  const initial = useRef('');
  return (
    <input
      className="ln-input"
      data-nav
      value={text ?? value}
      aria-label={label}
      aria-invalid={invalid || undefined}
      inputMode={numeric ? 'decimal' : undefined}
      autoCapitalize={upper ? 'characters' : undefined}
      autoComplete="off"
      spellCheck={false}
      list={list}
      placeholder={placeholder}
      autoFocus={autoFocus}
      maxLength={numeric ? 12 : 200}
      onFocus={() => {
        initial.current = value;
        setText(value);
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== null && text !== initial.current) onCommit(text);
        setText(null);
        onDone?.();
      }}
      onKeyDown={onEnter}
    />
  );
}

const numText = (v: number | null) => (v === null ? '' : fmtNum(v));

function Toggle({ value, options, onPick, label }: { value: string; options: readonly string[]; onPick: (v: string) => void; label: string }) {
  return (
    <span className="ln-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" data-nav className={value === o ? 'active' : ''} aria-pressed={value === o} onClick={() => onPick(value === o ? '' : o)} onKeyDown={onEnter}>
          {o}
        </button>
      ))}
    </span>
  );
}

function Stepper({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) {
  const n = value ?? 0;
  return (
    <span className="ln-stepper">
      <button type="button" onClick={() => onChange(Math.max(0, n - 1) || null)} aria-label={`${label} : un de moins`} disabled={n <= 0}>
        −
      </button>
      <TextInput value={numText(value)} onCommit={(t) => onChange(parseNumber(t))} label={label} numeric />
      <button type="button" onClick={() => onChange(n + 1)} aria-label={`${label} : un de plus`}>
        +
      </button>
    </span>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="ln-remove" onClick={onClick} aria-label={label} title={label}>
      ✕
    </button>
  );
}

function Issues({ issues }: { issues: string[] }) {
  if (!issues.length) return null;
  return (
    <p className="ln-issues" role="note">
      {issues.join(' · ')}
    </p>
  );
}

// --- Rows -------------------------------------------------------------------

interface RowProps<T extends LineRecord> {
  row: T;
  /** On this tablet only, until something is typed in it. */
  draft: boolean;
  onChange: (next: T) => void;
  onRemove: () => void;
}

function LoadingRowView({ row, draft, onChange, onRemove }: RowProps<LoadingRow>) {
  const [commenting, setCommenting] = useState(false);
  const set = (patch: Partial<LoadingRow>) => onChange({ ...row, ...patch });
  const issues = draft ? [] : loadingIssues(row);
  const restantes = row.lites !== null && row.conso !== null ? row.lites - row.conso : null;
  const over = row.lites !== null && row.conso !== null && row.conso > row.lites;
  return (
    <div className={`ln-row ln-loading${draft ? ' is-draft' : ''}${issues.length ? ' has-issues' : ''}`} data-rec={row.id} role="row">
      <Field label="N° TAG" col="tag" invalid={!draft && !!issues.find((x) => x.startsWith('N° TAG'))}>
        <TextInput value={row.tag} onCommit={(t) => set({ tag: t.replace(/\s/g, '') })} label="N° TAG" numeric autoFocus={draft} placeholder="22111809784" />
      </Field>
      <Field label="Lites" col="n">
        <TextInput value={numText(row.lites)} onCommit={(t) => set({ lites: parseNumber(t) })} label="Lites" numeric />
      </Field>
      <Field label="Dimension" col="dim">
        <TextInput value={numText(row.dim)} onCommit={(t) => set({ dim: parseNumber(t) })} label="Dimension (mm)" numeric list="ln-dims" />
      </Field>
      <Field label="Épaisseur" col="ep">
        <TextInput value={row.ep} onCommit={(t) => set({ ep: normEp(t) })} label="Épaisseur" list="ln-eps" upper />
      </Field>
      <Field label="Origine" col="orig">
        <TextInput value={row.origine} onCommit={(t) => set({ origine: t.trim().toUpperCase() })} label="Origine" list="ln-origines" upper />
      </Field>
      <Field label="Sens" col="seg" group>
        <Toggle value={row.sens} options={SENS} onPick={(v) => set({ sens: v })} label="Sens" />
      </Field>
      <Field label="Polishing" col="seg" group>
        <Toggle value={row.polishing} options={POLISHING} onPick={(v) => set({ polishing: v })} label="Polishing" />
      </Field>
      <Field label="Date" col="date">
        <input className="ln-input" data-nav type="date" value={row.date} aria-label="Date du verre" onChange={(e) => set({ date: e.target.value })} onKeyDown={onEnter} />
      </Field>
      <Field label="Consommées" col="conso" invalid={over}>
        <span className="ln-conso">
          <TextInput value={numText(row.conso)} onCommit={(t) => set({ conso: parseNumber(t) })} label="Consommées" numeric invalid={over} />
          <button
            type="button"
            className="ln-all"
            onClick={() => set({ conso: row.lites })}
            disabled={row.lites === null || row.conso === row.lites}
            title="Toutes les lites consommées"
          >
            Tout
          </button>
        </span>
      </Field>
      <span className="ln-f ln-c-rest" title="Restantes : lites − consommées">
        <span className="ln-f-label">Restantes</span>
        <span className={`ln-rest${restantes ? ' has-rest' : ''}`}>{restantes === null ? '—' : fmtNum(restantes)}</span>
      </span>
      <span className="ln-actions">
        <button
          type="button"
          className={`ln-note${row.comment ? ' has-note' : ''}`}
          onClick={() => setCommenting((v) => !v)}
          aria-label={row.comment ? `Commentaire : ${row.comment}` : 'Ajouter un commentaire'}
          aria-expanded={commenting}
          title={row.comment || 'Commentaire'}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
            <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
          </svg>
        </button>
        <RemoveButton label={draft ? 'Abandonner la ligne' : 'Supprimer la ligne'} onClick={onRemove} />
      </span>
      {(commenting || row.comment) && (
        <div className="ln-comment">
          {commenting ? (
            <TextInput value={row.comment} onCommit={(t) => set({ comment: t.trim() })} label="Commentaire" placeholder="Commentaire" autoFocus />
          ) : (
            <button type="button" className="ln-comment-text" onClick={() => setCommenting(true)}>
              {row.comment}
            </button>
          )}
        </div>
      )}
      <Issues issues={issues} />
    </div>
  );
}

function UnloadingRowView({ row, draft, onChange, onRemove }: RowProps<UnloadingRow>) {
  const set = (patch: Partial<UnloadingRow>) => onChange({ ...row, ...patch });
  const issues = draft ? [] : unloadingIssues(row);
  return (
    <div className={`ln-row ln-rack${draft ? ' is-draft' : ''}${issues.length ? ' has-issues' : ''}`} data-rec={row.id} role="row">
      <Field label="N° TAG" col="tag" invalid={!draft && !!issues.find((x) => x.startsWith('N° TAG'))}>
        <TextInput value={row.tag} onCommit={(t) => set({ tag: t.replace(/\s/g, '') })} label="N° TAG" numeric autoFocus={draft} placeholder="22111809784" />
      </Field>
      <Field label="Frame" col="frame">
        <TextInput value={row.frame} onCommit={(t) => set({ frame: t.trim() })} label="Frame" numeric />
      </Field>
      <Field label="Dimension" col="dim">
        <TextInput value={numText(row.dim)} onCommit={(t) => set({ dim: parseNumber(t) })} label="Dimension (mm)" numeric list="ln-dims" />
      </Field>
      <Field label="Épaisseur" col="ep">
        <TextInput value={row.ep} onCommit={(t) => set({ ep: normEp(t) })} label="Épaisseur" list="ln-eps" upper />
      </Field>
      <Field label="Lites" col="n">
        <TextInput value={numText(row.lites)} onCommit={(t) => set({ lites: parseNumber(t) })} label="Lites" numeric />
      </Field>
      <Field label="Commentaire" col="text">
        <TextInput value={row.comment} onCommit={(t) => set({ comment: t.trim() })} label="Commentaire" />
      </Field>
      <span className="ln-actions">
        <RemoveButton label={draft ? 'Abandonner le rack' : 'Supprimer le rack'} onClick={onRemove} />
      </span>
      <Issues issues={issues} />
    </div>
  );
}

function ScrapRowView({ row, draft, onChange, onRemove }: RowProps<Scrap>) {
  const set = (patch: Partial<Scrap>) => onChange({ ...row, ...patch });
  const issues = draft ? [] : scrapIssues(row);
  const known = (DEFECTS as readonly string[]).includes(row.defect);
  return (
    <div className={`ln-row ln-scrap${draft ? ' is-draft' : ''}${issues.length ? ' has-issues' : ''}`} data-rec={row.id} role="row">
      <Field label="Défaut" col="defect" invalid={!draft && !row.defect}>
        <select className="ln-input" data-nav value={row.defect} onChange={(e) => set({ defect: e.target.value })} aria-label="Défaut" autoFocus={draft} onKeyDown={onEnter}>
          <option value="">Choisir le défaut…</option>
          {!known && row.defect && <option value={row.defect}>{row.defect}</option>}
          {DEFECTS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Quantité" col="qty" invalid={!draft && !row.qty} group>
        <Stepper value={row.qty} onChange={(v) => set({ qty: v })} label="Quantité" />
      </Field>
      <Field label="Dimension" col="dim">
        <TextInput value={numText(row.dim)} onCommit={(t) => set({ dim: parseNumber(t) })} label="Dimension (mm)" numeric list="ln-dims" />
      </Field>
      <Field label="Épaisseur" col="ep">
        <TextInput value={row.ep} onCommit={(t) => set({ ep: normEp(t) })} label="Épaisseur" list="ln-eps" upper />
      </Field>
      <Field label="Commentaire" col="text">
        <TextInput value={row.comment} onCommit={(t) => set({ comment: t.trim() })} label="Commentaire" />
      </Field>
      <span className="ln-actions">
        <RemoveButton label={draft ? 'Abandonner le scrap' : 'Supprimer le scrap'} onClick={onRemove} />
      </span>
      <Issues issues={issues} />
    </div>
  );
}

// --- Colours ----------------------------------------------------------------

interface Block {
  /** Null: rows under no colour (or one deleted meanwhile). */
  colour: Colour | null;
  loading: LoadingRow[];
  unloading: UnloadingRow[];
  scraps: Scrap[];
}

/** The shift's colours in order, each with its rows; then the rows under none, when there are some. */
function blocksOf(d: LineData, drafts: LineRecord[]): Block[] {
  const known = new Set(d.colours.map((c) => c.id));
  const ids = new Set<string>();
  const all = { loading: [...d.loading], unloading: [...d.unloading], scraps: [...d.scraps] };
  for (const r of [...d.loading, ...d.unloading, ...d.scraps]) ids.add(r.id);
  for (const r of drafts) {
    if (ids.has(r.id)) continue;
    if (r.kind === 'loading') all.loading.push(r);
    else if (r.kind === 'unloading') all.unloading.push(r);
    else if (r.kind === 'scrap') all.scraps.push(r);
  }
  const of = (id: string | null) => ({
    loading: all.loading.filter((r) => (id ? r.colour === id : !r.colour || !known.has(r.colour))),
    unloading: all.unloading.filter((r) => (id ? r.colour === id : !r.colour || !known.has(r.colour))),
    scraps: all.scraps.filter((r) => (id ? r.colour === id : !r.colour || !known.has(r.colour))),
  });
  const blocks: Block[] = d.colours.map((c) => ({ colour: c, ...of(c.id) }));
  const none = of(null);
  if (none.loading.length || none.unloading.length || none.scraps.length) blocks.push({ colour: null, ...none });
  return blocks;
}

function ColourName({ colour, onRename }: { colour: Colour; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (!editing)
    return (
      <button type="button" className="ln-colour-name" onClick={() => setEditing(true)} title="Renommer la couleur">
        {colour.name || 'Couleur sans nom'}
      </button>
    );
  return (
    <span className="ln-colour-edit">
      <TextInput
        value={colour.name}
        onCommit={(t) => {
          const name = t.trim().toUpperCase();
          if (name) onRename(name);
        }}
        onDone={() => setEditing(false)}
        label="Nom de la couleur"
        list="ln-colours"
        upper
        autoFocus
      />
    </span>
  );
}

function NewColour({ first, onStart }: { first: boolean; onStart: (name: string) => void }) {
  const [name, setName] = useState('');
  const go = () => {
    const n = name.trim().toUpperCase();
    if (!n) return;
    onStart(n);
    setName('');
  };
  return (
    <form
      className={`ln-newcolour${first ? ' is-first' : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <label htmlFor="ln-newcolour">{first ? 'Quelle couleur passe sur la ligne ?' : 'Nouvelle couleur'}</label>
      <span className="ln-newcolour-row">
        <input
          id="ln-newcolour"
          className="ln-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          list="ln-colours"
          placeholder="SNX60HT"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={60}
        />
        <button type="submit" className="btn primary" disabled={!name.trim()}>
          Commencer
        </button>
      </span>
    </form>
  );
}

// --- The tabs ---------------------------------------------------------------

/** What the tab offers in its lists: the shift's own values first, then October's most used. */
function useLists(d: LineData | null) {
  return useMemo(() => {
    const uniq = <T,>(xs: T[]) => [...new Set(xs)];
    const rows = d ? [...d.loading, ...d.unloading, ...d.scraps] : [];
    return {
      dims: uniq([...rows.map((r) => r.dim).filter((x): x is number => x !== null), ...COMMON_DIMS]),
      eps: uniq([...rows.map((r) => r.ep).filter(Boolean), ...COMMON_EPS]),
      origines: uniq([...(d?.loading.map((r) => r.origine).filter(Boolean) ?? []), ...ORIGINES]),
      colours: uniq([...(d?.colours.map((c) => c.name) ?? []), ...COMMON_COLOURS]),
    };
  }, [d]);
}

function Lists({ d }: { d: LineData | null }) {
  const l = useLists(d);
  return (
    <>
      <datalist id="ln-dims">
        {l.dims.map((x) => (
          <option key={x} value={fmtNum(x)} />
        ))}
      </datalist>
      <datalist id="ln-eps">
        {l.eps.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
      <datalist id="ln-origines">
        {l.origines.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
      <datalist id="ln-colours">
        {l.colours.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
    </>
  );
}

/** The four defects the quick buttons offer: the shift's most used, then October's. */
function frequentDefects(scraps: Scrap[]): string[] {
  const count = new Map<string, number>();
  for (const s of scraps) if (s.defect) count.set(s.defect, (count.get(s.defect) ?? 0) + (s.qty ?? 0));
  const mine = [...count].sort((a, b) => b[1] - a[1]).map(([d]) => d);
  return [...new Set([...mine, ...FREQUENT_DEFECTS])].slice(0, 4);
}

export default function LineTab({ part, side }: { part: Partition | null; side: Side }) {
  const data = useLine(part, true);
  const snap = useLineSnapshot();
  const toast = useToast();
  const root = useRef<HTMLDivElement>(null);
  const [drafts, setDrafts] = useState<LineRecord[]>([]);
  const partKey = part ? `${part.date}.${part.poste}` : '';

  // A new shift: whatever was started on the previous one stays there.
  useEffect(() => setDrafts([]), [partKey]);
  // A draft typed in is a record now.
  useEffect(() => {
    if (!data || !drafts.length) return;
    const ids = new Set([...data.loading, ...data.unloading, ...data.scraps].map((r) => r.id));
    if (drafts.some((r) => ids.has(r.id))) setDrafts((ds) => ds.filter((r) => !ids.has(r.id)));
  }, [data, drafts]);

  // A row the bilan pointed at: brought into view, and flashed.
  useEffect(() => {
    if (!part || !data) return;
    const id = lineSync.takeFocus(part);
    if (!id) return;
    requestAnimationFrame(() => {
      const el = root.current?.querySelector<HTMLElement>(`[data-rec="${id}"]`);
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('is-flash');
      setTimeout(() => el.classList.remove('is-flash'), 2200);
      el.querySelector<HTMLElement>('[data-nav]')?.focus({ preventScroll: true });
    });
  }, [part, data, snap]);

  if (!part) return <div className="ln ln-empty no-print">Choisis un shift dans l’en-tête : chaque poste a ses saisies.</div>;
  if (!data)
    return (
      <div className="ln ln-empty no-print" role="status">
        {snap.status === 'offline'
          ? 'Hors ligne : ce poste n’a jamais été ouvert sur cette tablette. Il s’ouvrira au retour du réseau.'
          : snap.status === 'error'
            ? `Le poste ne se lit pas (${snap.error ?? 'erreur'}). Nouvel essai dans quelques secondes.`
            : 'Chargement du poste…'}
      </div>
    );

  const save = (r: LineRecord) => putRecord(part, r);
  const isDraft = (r: LineRecord) => drafts.some((d) => d.id === r.id);
  const remove = (r: LineRecord, message: string) => {
    if (isDraft(r)) {
      setDrafts((ds) => ds.filter((d) => d.id !== r.id));
      return;
    }
    deleteRecords(part, [r]);
    toast.show({ message, undo: () => putRecord(part, r) });
  };
  const blocks = blocksOf(data, drafts);
  const colours = data.colours;

  const startColour = (name: string) => {
    const same = colours.find((c) => c.name.trim().toUpperCase() === name);
    if (same) {
      root.current?.querySelector(`[data-colour="${same.id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    const c: Colour = { id: newId('c'), kind: 'colour', at: Date.now(), name };
    save(c);
    requestAnimationFrame(() => root.current?.querySelector(`[data-colour="${c.id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };

  // A new row starts from the block's last one: what a jumbo or a rack shares with the previous.
  const addLoading = (colour: Colour) => {
    const prev = [...data.loading, ...drafts].filter((r): r is LoadingRow => r.kind === 'loading' && r.colour === colour.id).pop();
    const row: LoadingRow = {
      id: newId('l'),
      kind: 'loading',
      at: Date.now(),
      colour: colour.id,
      tag: '',
      lites: null,
      dim: prev?.dim ?? null,
      ep: prev?.ep ?? '',
      origine: prev?.origine ?? '',
      sens: prev?.sens ?? '',
      polishing: prev?.polishing ?? '',
      date: prev?.date ?? '',
      conso: null,
      comment: '',
    };
    setDrafts((ds) => [...ds, row]);
  };
  const lastDims = (colour: Colour) => {
    const prev = [...data.unloading, ...data.scraps, ...drafts]
      .filter((r): r is UnloadingRow | Scrap => (r.kind === 'unloading' || r.kind === 'scrap') && r.colour === colour.id && (r.dim !== null || !!r.ep))
      .sort((a, b) => a.at - b.at)
      .pop();
    return { dim: prev?.dim ?? null, ep: prev?.ep ?? '' };
  };
  const addRack = (colour: Colour) => {
    const row: UnloadingRow = { id: newId('u'), kind: 'unloading', at: Date.now(), colour: colour.id, tag: '', frame: '', lites: null, comment: '', ...lastDims(colour) };
    setDrafts((ds) => [...ds, row]);
  };
  const addScrap = (colour: Colour, defect = '') => {
    const row: Scrap = { id: newId('s'), kind: 'scrap', at: Date.now(), colour: colour.id, defect, qty: 1, comment: '', ...lastDims(colour) };
    setDrafts((ds) => [...ds, row]);
  };
  // A quick button: one more of that defect at the colour's current dimension.
  const quickScrap = (colour: Colour, defect: string) => {
    const { dim, ep } = lastDims(colour);
    if (dim === null || !ep) {
      addScrap(colour, defect);
      return;
    }
    const same = data.scraps.filter((s) => s.colour === colour.id && s.defect === defect && s.dim === dim && s.ep === ep).pop();
    const next: Scrap = same
      ? { ...same, qty: (same.qty ?? 0) + 1 }
      : { id: newId('s'), kind: 'scrap', at: Date.now(), colour: colour.id, defect, qty: 1, dim, ep, comment: '' };
    save(next);
    toast.show({ message: `${shortDefect(defect)} · ${dimLabel(dim, ep)} : ${fmtNum(next.qty ?? 0)}`, undo: () => (same ? save(same) : deleteRecords(part, [next])) });
  };
  const moveTo = (rows: LineRecord[], colourId: string) =>
    putRecords(
      part,
      rows.filter((r): r is LoadingRow | UnloadingRow | Scrap => r.kind !== 'colour' && !isDraft(r)).map((r) => ({ ...r, colour: colourId })),
    );

  const filled = side === 'loading' ? data.loading.filter(loadingFilled) : data.unloading.filter(unloadingFilled);
  const scrapsFilled = data.scraps.filter(scrapFilled);
  const issuesCount =
    side === 'loading'
      ? filled.filter((r) => loadingIssues(r as LoadingRow).length).length
      : filled.filter((r) => unloadingIssues(r as UnloadingRow).length).length + scrapsFilled.filter((s) => scrapIssues(s).length).length;

  return (
    <div className={`ln ln-${side} no-print`} ref={root}>
      <Lists d={data} />
      <div className="ln-bar">
        <h2>{side === 'loading' ? 'Loading' : 'Unloading'}</h2>
        <span className="ln-bar-sum">
          {side === 'loading' ? (
            <>
              {plural(filled.length, 'jumbo')} · <strong>{fmtNum(sum((filled as LoadingRow[]).map((r) => r.conso)))}</strong> consommées
            </>
          ) : (
            <>
              {plural(filled.length, 'rack')} · <strong>{fmtNum(sum((filled as UnloadingRow[]).map((r) => r.lites)))}</strong> lites ·{' '}
              <strong>{fmtNum(sum(scrapsFilled.map((s) => s.qty)))}</strong> scraps (
              {pct(sum(scrapsFilled.map((s) => s.qty)), sum((filled as UnloadingRow[]).map((r) => r.lites)) + sum(scrapsFilled.map((s) => s.qty)))})
            </>
          )}
          {issuesCount > 0 && <span className="ln-bar-issues"> · {plural(issuesCount, 'ligne')} à compléter</span>}
        </span>
        {snap.pending > 0 && (
          <span className="ln-bar-sync" role="status">
            {snap.status === 'offline' ? `${plural(snap.pending, 'saisie')} en attente du réseau` : 'envoi…'}
          </span>
        )}
      </div>

      {!colours.length && !blocks.length ? (
        <NewColour first onStart={startColour} />
      ) : (
        <>
          {blocks.map((b) => (
            <section key={b.colour?.id ?? 'none'} className={`ln-block${b.colour ? '' : ' is-none'}`} data-colour={b.colour?.id ?? 'none'}>
              <BlockHead
                block={b}
                side={side}
                colours={colours}
                onRename={(name) => b.colour && save({ ...b.colour, name })}
                onRemove={() => {
                  if (!b.colour) return;
                  const c = b.colour;
                  deleteRecords(part, [c]);
                  toast.show({ message: `Couleur ${c.name} retirée`, undo: () => save(c) });
                }}
                onMove={(id) => moveTo([...b.loading, ...b.unloading, ...b.scraps], id)}
                empty={!b.loading.length && !b.unloading.length && !b.scraps.length}
              />
              {side === 'loading' ? (
                <>
                  {b.loading.length > 0 && <TableHead side="loading" />}
                  {b.loading.map((r) => (
                    <LoadingRowView key={r.id} row={r} draft={isDraft(r)} onChange={save} onRemove={() => remove(r, 'Jumbo supprimé')} />
                  ))}
                  {b.colour && (
                    <div className="ln-add">
                      <button type="button" className="btn ghost mini" onClick={() => addLoading(b.colour as Colour)}>
                        + Jumbo
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {b.unloading.length > 0 && <TableHead side="unloading" />}
                  {b.unloading.map((r) => (
                    <UnloadingRowView key={r.id} row={r} draft={isDraft(r)} onChange={save} onRemove={() => remove(r, 'Rack supprimé')} />
                  ))}
                  {b.colour && (
                    <div className="ln-add">
                      <button type="button" className="btn ghost mini" onClick={() => addRack(b.colour as Colour)}>
                        + Rack
                      </button>
                    </div>
                  )}
                  <div className="ln-scraps">
                    <h4>
                      Scraps
                      {b.scraps.length > 0 && <span className="ln-count">{fmtNum(sum(b.scraps.map((s) => s.qty)))}</span>}
                    </h4>
                    {b.scraps.length > 0 && <TableHead side="scrap" />}
                    {b.scraps.map((s) => (
                      <ScrapRowView key={s.id} row={s} draft={isDraft(s)} onChange={save} onRemove={() => remove(s, 'Scrap supprimé')} />
                    ))}
                    {b.colour && <QuickScraps colour={b.colour} dims={lastDims(b.colour)} defects={frequentDefects(data.scraps)} onAdd={addScrap} onQuick={quickScrap} />}
                  </div>
                </>
              )}
            </section>
          ))}
          <NewColour first={!colours.length} onStart={startColour} />
        </>
      )}
    </div>
  );
}

interface QuickScrapsProps {
  colour: Colour;
  /** The colour's current dimension: its last rack's (or scrap's). */
  dims: { dim: number | null; ep: string };
  defects: string[];
  onAdd: (colour: Colour, defect?: string) => void;
  onQuick: (colour: Colour, defect: string) => void;
}

/** « + Scrap », and a button per frequent defect: one more of it, at the colour's current dimension. */
function QuickScraps({ colour, dims, defects, onAdd, onQuick }: QuickScrapsProps) {
  const at = dims.dim !== null && dims.ep ? ` en ${dimLabel(dims.dim, dims.ep)}` : '';
  return (
    <div className="ln-add ln-quick">
      <button type="button" className="btn ghost mini" onClick={() => onAdd(colour)}>
        + Scrap
      </button>
      {defects.map((d) => (
        <button key={d} type="button" className="ln-quick-defect" onClick={() => onQuick(colour, d)} title={`Un scrap de plus : ${d}${at}`}>
          +1 {shortDefect(d)}
        </button>
      ))}
    </div>
  );
}

function TableHead({ side }: { side: Side | 'scrap' }) {
  const cols =
    side === 'loading'
      ? [
          ['tag', 'N° TAG'],
          ['n', 'Lites'],
          ['dim', 'Dimension'],
          ['ep', 'Épaisseur'],
          ['orig', 'Origine'],
          ['seg', 'Sens'],
          ['seg', 'Polishing'],
          ['date', 'Date'],
          ['conso', 'Consommées'],
          ['rest', 'Rest.'],
        ]
      : side === 'unloading'
        ? [
            ['tag', 'N° TAG'],
            ['frame', 'Frame'],
            ['dim', 'Dimension'],
            ['ep', 'Épaisseur'],
            ['n', 'Lites'],
            ['text', 'Commentaire'],
          ]
        : [
            ['defect', 'Défaut'],
            ['qty', 'Quantité'],
            ['dim', 'Dimension'],
            ['ep', 'Épaisseur'],
            ['text', 'Commentaire'],
          ];
  return (
    <div className={`ln-row ln-head ${side === 'loading' ? 'ln-loading' : side === 'unloading' ? 'ln-rack' : 'ln-scrap'}`} aria-hidden="true">
      {cols.map(([c, label], i) => (
        <span key={i} className={`ln-c-${c}`}>
          {label}
        </span>
      ))}
    </div>
  );
}

interface BlockHeadProps {
  block: Block;
  side: Side;
  colours: Colour[];
  onRename: (name: string) => void;
  onRemove: () => void;
  onMove: (colourId: string) => void;
  /** Nothing under it on either tab: it can go. */
  empty: boolean;
}

function BlockHead({ block, side, colours, onRename, onRemove, onMove, empty }: BlockHeadProps) {
  const loading = block.loading.filter(loadingFilled);
  const racks = block.unloading.filter(unloadingFilled);
  const scraps = block.scraps.filter(scrapFilled);
  const lites = sum(racks.map((r) => r.lites));
  const scrapped = sum(scraps.map((s) => s.qty));
  const summary =
    side === 'loading'
      ? `${plural(loading.length, 'jumbo')} · ${fmtNum(sum(loading.map((r) => r.conso)))} consommées · ${m2(loading.reduce((n, r) => n + area(r.dim, r.conso), 0))} m²`
      : `${plural(racks.length, 'rack')} · ${fmtNum(lites)} lites · ${fmtNum(scrapped)} scraps (${pct(scrapped, lites + scrapped)})`;
  return (
    <header className="ln-block-head">
      {block.colour ? <ColourName colour={block.colour} onRename={onRename} /> : <span className="ln-colour-name is-none">Sans couleur</span>}
      <span className="ln-block-sum">{summary}</span>
      <span className="gc-spacer" />
      {!block.colour && colours.length > 0 && (
        <select
          className="ln-move"
          value=""
          onChange={(e) => e.target.value && onMove(e.target.value)}
          aria-label="Ranger ces lignes dans une couleur"
        >
          <option value="">Ranger dans…</option>
          {colours.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {block.colour && empty && <RemoveButton label={`Retirer la couleur ${block.colour.name}`} onClick={onRemove} />}
    </header>
  );
}
