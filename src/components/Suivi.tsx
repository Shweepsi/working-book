import { Fragment, useEffect, useMemo, useState } from 'react';
import { load, save } from '../lib/storage';

const PROCESSES = ['Découpe', 'Trempe', 'Montage', 'Vitrine'] as const;
const STATIONS = ['MA', 'CE', 'WH'] as const;

type Process = (typeof PROCESSES)[number];
type Station = (typeof STATIONS)[number];
type CellState = 'ok' | 'na' | null;

interface ProcessRow {
  stations: Record<Station, CellState>;
  date: string;
}

interface SuiviEntry {
  id: string;
  serial: string;
  color: string;
  testType: string;
  origin: string;
  thickness: string;
  dateProd: string;
  process: Record<Process, ProcessRow>;
  controleur: string;
  dateControle: string;
  comment: string;
}

interface SuiviState {
  entries: SuiviEntry[];
  selectedId: string | null;
}

const STORAGE_KEY = 'wb.suivi.v1';
const COLOR_DEFAULT = 'SG NRG A/R Clear';
const ORIGIN_DEFAULT = 'PILK DE';
const THICKNESS_DEFAULT = '2.1 mm';

function newId(): string {
  return `sv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function emptyProcessRow(): ProcessRow {
  return { stations: { MA: null, CE: null, WH: null }, date: '' };
}

function emptyProcess(): Record<Process, ProcessRow> {
  return {
    'Découpe': emptyProcessRow(),
    'Trempe': emptyProcessRow(),
    'Montage': emptyProcessRow(),
    'Vitrine': emptyProcessRow(),
  };
}

function nextSerial(entries: SuiviEntry[]): string {
  const max = entries.reduce((m, e) => {
    const n = parseInt(e.serial || '', 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return String(max + 1);
}

function emptyEntry(serial = ''): SuiviEntry {
  return {
    id: newId(),
    serial,
    color: COLOR_DEFAULT,
    testType: '',
    origin: ORIGIN_DEFAULT,
    thickness: THICKNESS_DEFAULT,
    dateProd: '',
    process: emptyProcess(),
    controleur: '',
    dateControle: '',
    comment: '',
  };
}

function initialState(): SuiviState {
  const persisted = load<SuiviState | null>(STORAGE_KEY, null);
  if (persisted && Array.isArray(persisted.entries) && persisted.entries.length > 0) {
    return persisted;
  }
  const e = emptyEntry('1');
  return { entries: [e], selectedId: e.id };
}

function cycleCell(state: CellState): CellState {
  if (state === null) return 'ok';
  if (state === 'ok') return 'na';
  return null;
}

function fmtDateProd(iso: string): string {
  if (!iso || iso.length < 10) return '';
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
}

export default function Suivi() {
  const [state, setState] = useState<SuiviState>(initialState);

  useEffect(() => {
    save(STORAGE_KEY, state);
  }, [state]);

  function patchEntry(id: string, mut: (e: SuiviEntry) => SuiviEntry) {
    setState((s) => ({ ...s, entries: s.entries.map((e) => (e.id === id ? mut(e) : e)) }));
  }

  function addEntry() {
    setState((s) => {
      const e = emptyEntry(nextSerial(s.entries));
      return { entries: [...s.entries, e], selectedId: e.id };
    });
  }

  function deleteEntry(id: string) {
    if (!window.confirm('Supprimer cette entrée ?')) return;
    setState((s) => {
      const remaining = s.entries.filter((e) => e.id !== id);
      if (remaining.length === 0) {
        const e = emptyEntry('1');
        return { entries: [e], selectedId: e.id };
      }
      const selected = s.selectedId === id ? remaining[0]!.id : s.selectedId;
      return { entries: remaining, selectedId: selected };
    });
  }

  function selectEntry(id: string) {
    setState((s) => (s.selectedId === id ? s : { ...s, selectedId: id }));
  }

  const total = state.entries.length;
  const yearEnd = useMemo(() => new Date().getFullYear(), []);
  const yearLabel = `SUIVI ${yearEnd - 1} - ${yearEnd}`;

  return (
    <div className="sv">
      <div className="sv-titlebar">
        <h2 className="sv-title">Suivi Cosmétiques et DV</h2>
        <span className="sv-year mono">{yearLabel}</span>
      </div>

      <div className="sv-toolbar no-print">
        <button className="btn primary" onClick={addEntry}>
          <span className="glyph" aria-hidden="true">＋</span> Nouvelle entrée
        </button>
        <span className="faint small">
          {total} entrée{total > 1 ? 's' : ''}
        </span>
        <span className="faint small sv-toolbar-hint">
          Cliquer une cellule MA/CE/WH pour cycler · vide → OK → N/A
        </span>
        <button
          type="button"
          className="btn ghost"
          style={{ marginLeft: 'auto' }}
          onClick={() => window.print()}
          title="Imprimer le suivi"
        >
          Imprimer
        </button>
      </div>

      <div className="sv-table-wrap">
        <div className="sv-table" role="table" aria-label="Suivi Cosmétiques et DV">
          <div className="sv-row sv-suphead" role="row" aria-hidden="true">
            <div className="sv-cell sv-suphead-prod">Production</div>
          </div>
          <div className="sv-row sv-head" role="row">
            <div className="sv-cell sv-c-id" role="columnheader">ID</div>
            <div className="sv-cell sv-c-color" role="columnheader">Couleur</div>
            <div className="sv-cell sv-c-type" role="columnheader">Type de test</div>
            <div className="sv-cell sv-c-origin" role="columnheader">Origine</div>
            <div className="sv-cell sv-c-th" role="columnheader">Ép.</div>
            <div className="sv-cell sv-c-dprod" role="columnheader">Date Prod</div>
            <div className="sv-cell sv-c-proc" role="columnheader">Process</div>
            <div className="sv-cell sv-c-ma" role="columnheader">MA</div>
            <div className="sv-cell sv-c-ce" role="columnheader">CE</div>
            <div className="sv-cell sv-c-wh" role="columnheader">WH</div>
            <div className="sv-cell sv-c-pdate" role="columnheader">Date</div>
            <div className="sv-cell sv-c-ctrl" role="columnheader">Contrôle</div>
            <div className="sv-cell sv-c-comment" role="columnheader">Résultat / Commentaire</div>
          </div>

          {state.entries.map((entry, idx) => (
            <SuiviEntryRow
              key={entry.id}
              entry={entry}
              alt={idx % 2 === 1}
              selected={state.selectedId === entry.id}
              onSelect={() => selectEntry(entry.id)}
              onChange={(mut) => patchEntry(entry.id, mut)}
              onDelete={() => deleteEntry(entry.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface RowProps {
  entry: SuiviEntry;
  alt: boolean;
  selected: boolean;
  onSelect: () => void;
  onChange: (mut: (e: SuiviEntry) => SuiviEntry) => void;
  onDelete: () => void;
}

function SuiviEntryRow({ entry, alt, selected, onSelect, onChange, onDelete }: RowProps) {
  function patchProcess(p: Process, mut: (r: ProcessRow) => ProcessRow) {
    onChange((e) => ({ ...e, process: { ...e.process, [p]: mut(e.process[p]) } }));
  }
  function toggleStation(p: Process, st: Station) {
    onSelect();
    patchProcess(p, (r) => ({
      ...r,
      stations: { ...r.stations, [st]: cycleCell(r.stations[st]) },
    }));
  }
  function patchHeader<K extends keyof SuiviEntry>(key: K, value: SuiviEntry[K]) {
    onChange((e) => ({ ...e, [key]: value }));
  }

  const cls = ['sv-row', 'sv-data'];
  if (alt) cls.push('is-alt');
  if (selected) cls.push('is-selected');

  return (
    <div className={cls.join(' ')} role="row" onMouseDown={onSelect}>
      <div className="sv-cell sv-c-id sv-id-cell">
        <input
          type="text"
          inputMode="numeric"
          className="sv-id-input mono"
          value={entry.serial}
          onChange={(ev) => patchHeader('serial', ev.target.value.replace(/\D/g, '').slice(0, 4))}
          onFocus={onSelect}
          aria-label="ID"
          placeholder="—"
        />
        <button
          type="button"
          className="sv-id-remove no-print"
          onClick={onDelete}
          aria-label="Supprimer cette entrée"
          title="Supprimer cette entrée"
        >
          ✕
        </button>
      </div>

      <input
        className="sv-cell sv-c-color sv-input"
        value={entry.color}
        onChange={(ev) => patchHeader('color', ev.target.value)}
        placeholder="Couleur"
      />
      <input
        className="sv-cell sv-c-type sv-input"
        value={entry.testType}
        onChange={(ev) => patchHeader('testType', ev.target.value)}
        placeholder="Cosmétique …"
      />
      <input
        className="sv-cell sv-c-origin sv-input"
        value={entry.origin}
        onChange={(ev) => patchHeader('origin', ev.target.value)}
        placeholder="Origine"
      />
      <input
        className="sv-cell sv-c-th sv-input"
        value={entry.thickness}
        onChange={(ev) => patchHeader('thickness', ev.target.value)}
        placeholder="Ép."
      />
      <label className="sv-cell sv-c-dprod sv-date-cell">
        <span className="sv-date-display mono" aria-hidden="true">
          {fmtDateProd(entry.dateProd) || <span className="faint">—</span>}
        </span>
        <input
          type="date"
          className="sv-date-input"
          value={entry.dateProd}
          onChange={(ev) => patchHeader('dateProd', ev.target.value)}
          aria-label="Date de production"
        />
      </label>

      {PROCESSES.map((p, i) => (
        <Fragment key={p}>
          <div
            className={`sv-cell sv-c-proc sv-proc-label sv-pr-${i}`}
            role="rowheader"
          >
            {p}
          </div>
          {STATIONS.map((st) => {
            const v = entry.process[p].stations[st];
            return (
              <button
                key={st}
                type="button"
                className={`sv-cell sv-c-${st.toLowerCase()} sv-station sv-st-${v ?? 'empty'} sv-pr-${i}`}
                onClick={() => toggleStation(p, st)}
                aria-label={`${p} · ${st} · ${v === 'ok' ? 'OK' : v === 'na' ? 'N/A' : 'vide'}`}
                title={`${p} · ${st}`}
              >
                {v === 'ok' ? 'OK' : ''}
              </button>
            );
          })}
          <label className={`sv-cell sv-c-pdate sv-date-cell sv-pr-${i}`}>
            <span className="sv-date-display mono" aria-hidden="true">
              {fmtDateProd(entry.process[p].date) || ''}
            </span>
            <input
              type="date"
              className="sv-date-input"
              value={entry.process[p].date}
              onChange={(ev) => patchProcess(p, (r) => ({ ...r, date: ev.target.value }))}
              aria-label={`Date ${p}`}
            />
          </label>
        </Fragment>
      ))}

      <div className="sv-cell sv-c-ctrl sv-ctrl-stack">
        <input
          className="sv-input sv-ctrl-input"
          value={entry.controleur}
          onChange={(ev) => patchHeader('controleur', ev.target.value)}
          placeholder="Contrôleur"
          aria-label="Contrôleur"
        />
        <label className="sv-ctrl-date">
          <span className="sv-date-display mono" aria-hidden="true">
            {fmtDateProd(entry.dateControle) || (
              <span className="faint">Date contrôle</span>
            )}
          </span>
          <input
            type="date"
            className="sv-date-input"
            value={entry.dateControle}
            onChange={(ev) => patchHeader('dateControle', ev.target.value)}
            aria-label="Date contrôle"
          />
        </label>
      </div>

      <textarea
        className="sv-cell sv-c-comment sv-comment-input"
        value={entry.comment}
        onChange={(ev) => patchHeader('comment', ev.target.value)}
        placeholder="Résultat, anomalies, conditions…"
      />
    </div>
  );
}
