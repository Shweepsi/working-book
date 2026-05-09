import { useEffect, useMemo, useRef, useState } from 'react';
import { load } from '../lib/storage';
import { useSyncedState } from '../lib/sync';
import { useEscapeToClose } from '../lib/hooks';
import { useToast } from '../lib/toast';
import { todayISO } from '../lib/shiftCalendar';

const PROCESSES = ['Découpe', 'Trempe', 'Montage', 'Vitrine'] as const;
const STATIONS = ['MA', 'CE', 'WH'] as const;
const TAGS = ['Production', 'Process', 'Développement', 'Réclamation'] as const;
const TEST_TYPES = ['Cosmétique', 'Contrôle Couleur'] as const;

type Process = (typeof PROCESSES)[number];
type Station = (typeof STATIONS)[number];
type Tag = (typeof TAGS)[number];
type CellState = 'ok' | 'nok' | 'na' | null;
type StageStatus = 'complete' | 'fail' | 'na' | 'empty';

interface ProcessRow {
  stations: Record<Station, CellState>;
}

interface SuiviEntry {
  id: string;
  serial: string;
  color: string;
  testType: string;
  origin: string;
  thickness: string;
  dateProd: string;
  tag: Tag | null;
  process: Record<Process, ProcessRow>;
  controleur: string;
  dateControle: string;
  comment: string;
  // Audit timestamps (epoch ms). Optional for legacy compatibility.
  createdAt?: number;
  updatedAt?: number;
}

interface SuiviState {
  entries: SuiviEntry[];
}

const STORAGE_KEY = 'wb.suivi.v1';
const COLOR_DEFAULT = 'SG NRG A/R Clear';
const ORIGIN_DEFAULT = 'PILK DE';
const THICKNESS_DEFAULT = '2.1 mm';

const STAGE_LETTER: Record<Process, string> = {
  'Découpe': 'D',
  'Trempe': 'T',
  'Montage': 'M',
  'Vitrine': 'V',
};

const TAG_SLUG: Record<Tag, string> = {
  'Production': 'production',
  'Process': 'process',
  'Développement': 'dev',
  'Réclamation': 'rec',
};

function newId(): string {
  return `sv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function emptyProcessRow(): ProcessRow {
  return { stations: { MA: null, CE: null, WH: null } };
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
  const now = Date.now();
  return {
    id: newId(),
    serial,
    color: COLOR_DEFAULT,
    testType: '',
    origin: ORIGIN_DEFAULT,
    thickness: THICKNESS_DEFAULT,
    dateProd: '',
    tag: null,
    process: emptyProcess(),
    controleur: '',
    dateControle: '',
    comment: '',
    createdAt: now,
    updatedAt: now,
  };
}

function initialState(): SuiviState {
  const persisted = load<SuiviState | null>(STORAGE_KEY, null);
  if (persisted && Array.isArray(persisted.entries)) return persisted;
  return { entries: [] };
}

function cycleCell(state: CellState): CellState {
  if (state === null) return 'ok';
  if (state === 'ok') return 'nok';
  if (state === 'nok') return 'na';
  return null;
}

function fmtDateShort(iso: string): string {
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

// Stage rolls up the three stations into one of four states. NOK on any
// station wins (red); otherwise any OK promotes to complete (green).
// We deliberately don't render an 'in progress' / yellow state — the
// strip is binary green/red plus neutral N/A and empty.
function stageStatus(row: ProcessRow): StageStatus {
  const states = STATIONS.map((s) => row.stations[s]);
  if (states.some((s) => s === 'nok')) return 'fail';
  if (states.some((s) => s === 'ok')) return 'complete';
  if (states.some((s) => s === 'na')) return 'na';
  return 'empty';
}

function labelForStatus(s: StageStatus): string {
  if (s === 'complete') return 'conforme';
  if (s === 'fail') return 'NOK';
  if (s === 'na') return 'non applicable';
  return 'à faire';
}

function labelForCell(v: CellState): string {
  if (v === 'ok') return 'conforme';
  if (v === 'nok') return 'NOK';
  if (v === 'na') return 'non applicable';
  return 'à faire';
}

export default function Suivi() {
  const [state, setState] = useSyncedState<SuiviState>(
    STORAGE_KEY,
    { domain: 'suivi', params: {} },
    initialState,
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [activeTags, setActiveTags] = useState<Set<Tag>>(() => new Set());
  const wantOpenRef = useRef<string | null>(null);
  const toast = useToast();

  // Open the entry queued by addAndOpen once it actually exists in state.
  // Survives React 18 strict-mode double-invocation of state updaters.
  useEffect(() => {
    const wanted = wantOpenRef.current;
    if (wanted && state.entries.some((e) => e.id === wanted)) {
      setOpenId(wanted);
      wantOpenRef.current = null;
    }
  }, [state.entries]);

  const open = useMemo(
    () => state.entries.find((e) => e.id === openId) ?? null,
    [state.entries, openId],
  );

  const filtered = useMemo(() => {
    if (activeTags.size === 0) return state.entries;
    return state.entries.filter((e) => e.tag !== null && activeTags.has(e.tag));
  }, [state.entries, activeTags]);

  function patchEntry(id: string, mut: (e: SuiviEntry) => SuiviEntry) {
    const now = Date.now();
    setState((s) => ({
      ...s,
      entries: s.entries.map((e) =>
        e.id === id
          ? { ...mut(e), createdAt: e.createdAt ?? now, updatedAt: now }
          : e,
      ),
    }));
  }

  function addAndOpen() {
    setState((s) => {
      const entry = emptyEntry(nextSerial(s.entries));
      wantOpenRef.current = entry.id;
      return { ...s, entries: [...s.entries, entry] };
    });
  }

  function deleteEntry(id: string) {
    let removed: SuiviEntry | undefined;
    let removedIndex = -1;
    setState((s) => {
      removedIndex = s.entries.findIndex((e) => e.id === id);
      if (removedIndex < 0) return s;
      removed = s.entries[removedIndex];
      return { ...s, entries: s.entries.filter((e) => e.id !== id) };
    });
    if (openId === id) setOpenId(null);
    if (!removed) return;
    const restored = removed;
    const insertAt = removedIndex;
    toast.show({
      message: `Entrée #${restored.serial || '—'} supprimée`,
      undo: () => {
        setState((s) => {
          if (s.entries.some((e) => e.id === restored.id)) return s;
          const next = [...s.entries];
          next.splice(Math.min(insertAt, next.length), 0, restored);
          return { ...s, entries: next };
        });
      },
    });
  }

  function toggleFilter(t: Tag) {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  const filterActive = activeTags.size > 0;
  const visibleCount = filtered.length;

  return (
    <div className="sv">
      <div className="sv-toolbar">
        <div className="sv-toolbar-lead">
          <h2 className="sv-title">Suivi Cosmétiques</h2>
        </div>
        <div className="sv-tag-row sv-filter-row" role="group" aria-label="Filtrer par tag">
          {TAGS.map((t) => {
            const isOn = activeTags.has(t);
            const cls = ['sv-tag', `sv-tag-${TAG_SLUG[t]}`];
            if (filterActive) cls.push(isOn ? 'is-on' : 'is-off');
            return (
              <button
                key={t}
                type="button"
                className={cls.join(' ')}
                onClick={() => toggleFilter(t)}
                aria-pressed={isOn}
                title={isOn ? `Retirer le filtre ${t}` : `Filtrer sur ${t}`}
              >
                {t}
              </button>
            );
          })}
        </div>
        <button className="btn primary sv-new-btn" onClick={addAndOpen}>
          + Nouveau
        </button>
      </div>

      {visibleCount === 0 ? (
        <div className="sv-empty">
          <h3>{filterActive ? 'Aucune entrée pour ce filtre' : 'Aucune entrée'}</h3>
          {filterActive && (
            <button
              type="button"
              className="btn ghost mini"
              onClick={() => setActiveTags(new Set())}
            >
              Effacer les filtres
            </button>
          )}
        </div>
      ) : (
        <div className="sv-table" role="table" aria-label="Suivi Cosmétiques">
          <div className="sv-row sv-head" role="row">
            <div className="sv-cell sv-c-id" role="columnheader">ID</div>
            <div className="sv-cell sv-c-tag" role="columnheader">Tag</div>
            <div className="sv-cell sv-c-color" role="columnheader">Couleur</div>
            <div className="sv-cell sv-c-type" role="columnheader">Type de test</div>
            <div className="sv-cell sv-c-origin" role="columnheader">Origine</div>
            <div className="sv-cell sv-c-th" role="columnheader">Ép.</div>
            <div className="sv-cell sv-c-dprod" role="columnheader">Date Prod</div>
            <div className="sv-cell sv-c-prog" role="columnheader">Production</div>
            <div className="sv-cell sv-c-ctrl" role="columnheader">Contrôleur</div>
            <div className="sv-cell sv-c-cmt" role="columnheader" aria-label="Commentaire"></div>
          </div>
          {filtered.map((entry) => (
            <SuiviRow key={entry.id} entry={entry} onOpen={() => setOpenId(entry.id)} />
          ))}
        </div>
      )}

      {open && (
        <SuiviSheet
          entry={open}
          onClose={() => setOpenId(null)}
          onChange={(mut) => patchEntry(open.id, mut)}
          onDelete={() => deleteEntry(open.id)}
        />
      )}
    </div>
  );
}

interface RowProps {
  entry: SuiviEntry;
  onOpen: () => void;
}

function SuiviRow({ entry, onOpen }: RowProps) {
  return (
    <button
      type="button"
      className="sv-row sv-data as-row"
      onClick={onOpen}
      aria-label={`Entrée ${entry.serial || ''} ${entry.color || ''}`.trim()}
    >
      <span className="sv-cell sv-c-id mono">
        {entry.serial ? (
          <strong>
            <span className="sv-id-hash">#</span>
            {entry.serial}
          </strong>
        ) : (
          <span className="faint">—</span>
        )}
      </span>
      <span className="sv-cell sv-c-tag">
        {entry.tag ? (
          <span className={`sv-tag sv-tag-${TAG_SLUG[entry.tag]}`}>{entry.tag}</span>
        ) : (
          <span className="faint">—</span>
        )}
      </span>
      <span className="sv-cell sv-c-color">{entry.color || <span className="faint">—</span>}</span>
      <span className="sv-cell sv-c-type" title={entry.testType}>
        {entry.testType || <span className="faint sv-placeholder">sans type</span>}
      </span>
      <span className="sv-cell sv-c-origin mono">{entry.origin || <span className="faint">—</span>}</span>
      <span className="sv-cell sv-c-th mono">{entry.thickness || ''}</span>
      <span className="sv-cell sv-c-dprod mono">
        {fmtDateShort(entry.dateProd) || <span className="faint">—</span>}
      </span>
      <span className="sv-cell sv-c-prog">
        <span className="sv-stages" aria-label="Avancement production">
          {PROCESSES.map((p) => {
            const status = stageStatus(entry.process[p]);
            return (
              <span
                key={p}
                className={`sv-stage sv-st-${status}`}
                title={`${p} · ${labelForStatus(status)}`}
              >
                {STAGE_LETTER[p]}
              </span>
            );
          })}
        </span>
      </span>
      <span className="sv-cell sv-c-ctrl">
        {entry.controleur || entry.dateControle ? (
          <span className="sv-ctrl-summary">
            {entry.controleur && <span>{entry.controleur}</span>}
            {entry.dateControle && (
              <span className="faint mono small">{fmtDateShort(entry.dateControle)}</span>
            )}
          </span>
        ) : (
          <span className="faint">—</span>
        )}
      </span>
      <span className="sv-cell sv-c-cmt">
        {entry.comment ? (
          <span
            className="sv-cmt-dot"
            aria-label="Commentaire présent"
            title={entry.comment}
          />
        ) : null}
      </span>
    </button>
  );
}

interface SheetProps {
  entry: SuiviEntry;
  onClose: () => void;
  onChange: (mut: (e: SuiviEntry) => SuiviEntry) => void;
  onDelete: () => void;
}

function SuiviSheet({ entry, onClose, onChange, onDelete }: SheetProps) {
  useEscapeToClose(onClose);

  function patchHeader<K extends keyof SuiviEntry>(key: K, value: SuiviEntry[K]) {
    onChange((e) => ({ ...e, [key]: value }));
  }
  function patchProcess(p: Process, mut: (r: ProcessRow) => ProcessRow) {
    onChange((e) => ({ ...e, process: { ...e.process, [p]: mut(e.process[p]) } }));
  }
  function toggleStation(p: Process, st: Station) {
    patchProcess(p, (r) => ({
      ...r,
      stations: { ...r.stations, [st]: cycleCell(r.stations[st]) },
    }));
  }
  function toggleTag(t: Tag) {
    patchHeader('tag', entry.tag === t ? null : t);
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet sv-sheet" role="dialog" aria-modal="true" aria-label="Éditer l'entrée">
        <div className="grabber" />
        <div className="sheet-head">
          <div className="sv-sheet-title">
            <span className="sv-sheet-id mono">#{entry.serial || '—'}</span>
            <h3>Suivi cosmétique</h3>
          </div>
          <button className="btn ghost icon" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        <div className="sv-sheet-grid">
          <Field
            label="ID"
            value={entry.serial}
            onChange={(v) => patchHeader('serial', v.replace(/\D/g, '').slice(0, 4))}
            mono
            inputMode="numeric"
          />
          <Field
            label="Date Prod"
            type="date"
            value={entry.dateProd}
            onChange={(v) => patchHeader('dateProd', v)}
            mono
            today
          />
          <div className="sv-field sv-field-tag">
            <span className="sv-field-label"><span>Tag</span></span>
            <div className="sv-tag-row" role="radiogroup" aria-label="Tag">
              {TAGS.map((t) => {
                const on = entry.tag === t;
                return (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={`sv-tag sv-tag-${TAG_SLUG[t]} ${on ? 'is-on' : 'is-off'}`}
                    onClick={() => toggleTag(t)}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
          <Field
            label="Couleur"
            value={entry.color}
            onChange={(v) => patchHeader('color', v)}
          />
          <div className="sv-field sv-field-test-type">
            <span className="sv-field-label"><span>Type de test</span></span>
            <div className="seg sv-test-type" role="group" aria-label="Type de test">
              {TEST_TYPES.map((t) => {
                const on = entry.testType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    className={on ? 'active' : ''}
                    onClick={() => patchHeader('testType', on ? '' : t)}
                    aria-pressed={on}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
          <Field
            label="Origine"
            value={entry.origin}
            onChange={(v) => patchHeader('origin', v)}
          />
          <Field
            label="Épaisseur"
            value={entry.thickness}
            onChange={(v) => patchHeader('thickness', v)}
          />
        </div>

        <div className="sv-sheet-section">
          <div className="sv-sheet-section-title">Production</div>
          <div className="sv-stages-grid">
            {PROCESSES.map((p) => (
              <StageCard
                key={p}
                process={p}
                row={entry.process[p]}
                onToggle={(st) => toggleStation(p, st)}
              />
            ))}
          </div>
        </div>

        <div className="sv-sheet-section">
          <div className="sv-sheet-grid">
            <Field
              label="Contrôleur"
              value={entry.controleur}
              onChange={(v) => patchHeader('controleur', v)}
            />
            <Field
              label="Date contrôle"
              type="date"
              value={entry.dateControle}
              onChange={(v) => patchHeader('dateControle', v)}
              mono
              today
            />
          </div>
        </div>

        <div className="sv-sheet-section">
          <div className="sv-sheet-section-title">Commentaires</div>
          <textarea
            className="sv-sheet-textarea"
            value={entry.comment}
            onChange={(e) => patchHeader('comment', e.target.value)}
            placeholder="Résultat, anomalies, conditions…"
            rows={3}
          />
        </div>

        <div className="sv-sheet-actions">
          <button className="btn destructive" onClick={onDelete}>Supprimer</button>
          {entry.updatedAt && (
            <span className="faint small mono sv-sheet-meta">
              Modifié {new Date(entry.updatedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
          )}
          <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </>
  );
}

interface StageCardProps {
  process: Process;
  row: ProcessRow;
  onToggle: (st: Station) => void;
}

function StageCard({ process, row, onToggle }: StageCardProps) {
  const status = stageStatus(row);
  return (
    <div className={`sv-stage-card sv-st-${status}`}>
      <div className="sv-stage-card-name">{process}</div>
      <div className="sv-stage-stations">
        {STATIONS.map((st) => {
          const v = row.stations[st];
          return (
            <button
              key={st}
              type="button"
              className={`sv-station-btn sv-st-${v ?? 'empty'}`}
              onClick={() => onToggle(st)}
              aria-label={`${st} · ${labelForCell(v)}`}
              title={`${st} · ${labelForCell(v)}`}
            >
              <span className="sv-station-btn-label">{st}</span>
              <span className="sv-station-btn-state mono">
                {v === 'ok' ? 'OK' : v === 'nok' ? 'NOK' : v === 'na' ? 'N/A' : '—'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  mono?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  today?: boolean;
}

function Field({ label, value, onChange, type = 'text', mono, inputMode, today }: FieldProps) {
  return (
    <label className="sv-field">
      <span className="sv-field-label">
        <span>{label}</span>
        {today && (
          <button
            type="button"
            className="sv-field-today"
            onClick={(e) => {
              e.preventDefault();
              onChange(todayISO());
            }}
            title="Mettre à la date du jour"
          >
            Aujourd'hui
          </button>
        )}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={inputMode}
        className={mono ? 'mono' : ''}
      />
    </label>
  );
}
