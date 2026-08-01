import { memo, useCallback, useId, useMemo, useState } from 'react';
import { newId } from '../data/shift';
import { EVENT_TYPES, FLAGS, tintForFlag } from '../data/eventTypes';
import { diffMinutes, fmtDuration, fmtHM } from '../lib/time';
import { load } from '../lib/storage';
import { useSyncedState } from '../lib/sync';
import { useToast } from '../lib/toast';
import EventEditor from './EventEditor';
import type { EventType, FlagKey, LogEvent, Poste, ShiftMeta } from '../types';

// Order matches the visual order in the filter row; null is implicit when no
// chip is active. Note "normal" is intentionally absent: untagged events are
// caught by the "Sans" pseudo-filter further down.
const FILTER_FLAGS: FlagKey[] = ['ok', 'scheduled', 'unscheduled', 'note'];

const EVENT_TYPE_BY_KEY = new Map<string, EventType>(EVENT_TYPES.map((t) => [t.key, t]));

// Two visual rows of type buttons; `row` on each event type drives placement.
const TYPE_ROWS = [
  EVENT_TYPES.filter((t) => t.row === 1),
  EVENT_TYPES.filter((t) => t.row === 2),
] as const;

function storageKey(date: string, poste: Poste | null): string {
  return `wb.logbook.v4.${date}.${poste}`;
}

interface LogbookProps {
  poste: Poste | null;
  shiftMeta: ShiftMeta;
  onNavigate?: (date: string, poste: Poste) => void;
}

interface OtherMatch {
  ev: LogEvent;
  date: string;
  poste: Poste;
}

const STORAGE_PREFIX = 'wb.logbook.v4.';

// Scan localStorage for matching events outside the current shift. Used to
// expose log entries from other dates/postes that the operator may be looking
// for — e.g. searching for "#375" finds the plate across every shift.
function searchOtherShifts(
  currentDate: string,
  currentPoste: Poste | null,
  query: string,
  activeFlags: Set<FlagKey>,
): OtherMatch[] {
  if (typeof window === 'undefined') return [];
  if (!query.trim() && activeFlags.size === 0) return [];
  const q = query.trim().toLowerCase();
  const results: OtherMatch[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
    const tail = key.slice(STORAGE_PREFIX.length);
    const dot = tail.lastIndexOf('.');
    if (dot < 0) continue;
    const date = tail.slice(0, dot);
    const poste = tail.slice(dot + 1) as Poste;
    if (date === currentDate && poste === currentPoste) continue;
    let events: LogEvent[];
    try {
      const raw = window.localStorage.getItem(key);
      events = raw ? (JSON.parse(raw) as LogEvent[]) : [];
    } catch {
      continue;
    }
    for (const ev of events) {
      if (activeFlags.size > 0 && (!ev.flag || !activeFlags.has(ev.flag))) continue;
      if (q) {
        const haystack = [ev.desc, ev.type, ...(ev.notes || [])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) continue;
      }
      results.push({ ev, date, poste });
    }
  }
  results.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return a.poste.localeCompare(b.poste);
  });
  return results;
}

function fmtShortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

interface EditingState {
  event: Partial<LogEvent>;
}

export default function Logbook({ poste, shiftMeta, onNavigate }: LogbookProps) {
  const { date } = shiftMeta;
  const cacheKey = storageKey(date, poste);
  const init = useCallback(() => load<LogEvent[]>(cacheKey, []), [cacheKey]);
  const [events, setEvents] = useSyncedState<LogEvent[]>(
    cacheKey,
    poste ? { domain: 'logbook', params: { date, poste } } : null,
    init,
    // The shift's log is written from whichever device is at hand — the office
    // PC and the tablet on the line both open the same date and poste.
    { live: true },
  );
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [showSecondary, setShowSecondary] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeFlags, setActiveFlags] = useState<Set<FlagKey>>(() => new Set());
  const queryInputId = useId();
  const toast = useToast();

  const filteredEvents = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((e) => {
      if (activeFlags.size > 0 && (!e.flag || !activeFlags.has(e.flag))) return false;
      if (!q) return true;
      const haystack = [e.desc, e.type, ...(e.notes || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [events, query, activeFlags]);

  const summary = useMemo(() => computeSummary(filteredEvents), [filteredEvents]);
  const filteringActive = query.trim() !== '' || activeFlags.size > 0;
  const hiddenCount = events.length - filteredEvents.length;

  // Cross-shift / cross-date results live alongside the current shift's list
  // so the operator never has to navigate to find a past entry.
  const otherMatches = useMemo(
    () => (filteringActive ? searchOtherShifts(date, poste, query, activeFlags) : []),
    [filteringActive, date, poste, query, activeFlags],
  );

  function toggleFlagFilter(f: FlagKey) {
    setActiveFlags((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }

  function clearFilters() {
    setQuery('');
    setActiveFlags(new Set());
  }

  function openTypedEvent(type: string) {
    const stamp = fmtHM();
    const meta = EVENT_TYPE_BY_KEY.get(type);
    setEditing({
      event: {
        start: stamp,
        end: '',
        type,
        desc: typeof meta?.prefill === 'string' ? meta.prefill : meta?.prefill ? meta.label : '',
        flag: meta?.defaultFlag ?? null,
        notes: meta?.openNote ? [''] : [],
      },
    });
    setFabOpen(false);
  }

  const openEvent = useCallback((ev: LogEvent) => setEditing({ event: ev }), []);
  const removeEvent = useCallback(
    (id: string) => {
      let removed: LogEvent | undefined;
      let removedIndex = -1;
      setEvents((prev) => {
        removedIndex = prev.findIndex((e) => e.id === id);
        if (removedIndex < 0) return prev;
        removed = prev[removedIndex];
        return prev.filter((e) => e.id !== id);
      });
      if (!removed) return;
      const restored = removed;
      const insertAt = removedIndex;
      toast.show({
        message: 'Événement supprimé',
        undo: () => {
          setEvents((prev) => {
            if (prev.some((e) => e.id === restored.id)) return prev;
            const next = [...prev];
            next.splice(Math.min(insertAt, next.length), 0, restored);
            return next;
          });
        },
      });
    },
    [setEvents, toast],
  );

  function saveFromEditor(payload: LogEvent) {
    const now = Date.now();
    const normalized: LogEvent = { ...payload, end: payload.end || payload.start || null };
    setEvents((prev) =>
      normalized.id
        ? prev.map((e) =>
            e.id === normalized.id
              ? { ...e, ...normalized, createdAt: e.createdAt ?? now, updatedAt: now }
              : e,
          )
        : [...prev, { ...normalized, id: newId(), createdAt: now, updatedAt: now }],
    );
    setEditing(null);
  }

  return (
    <div>
      <PrintHeader poste={poste} shiftMeta={shiftMeta} />

      <div className="type-strip no-print">
        <div className="type-row">
          {TYPE_ROWS[0].map((t) => (
            <button
              key={t.key}
              type="button"
              className={t.key === 'Nouveau' ? 'type-add' : ''}
              onClick={() => openTypedEvent(t.key)}
              title={`Enregistrer ${t.label} maintenant`}
            >
              <span className="glyph">＋</span>
              {t.label}
            </button>
          ))}
          <button
            type="button"
            className="type-more"
            onClick={() => setShowSecondary((v) => !v)}
            title={showSecondary ? 'Masquer les types secondaires' : 'Afficher les types secondaires'}
            aria-expanded={showSecondary}
            aria-label="Basculer les types secondaires"
          >
            <span className="chevron" aria-hidden="true">⌄</span>
          </button>
        </div>
        {showSecondary && (
          <div className="type-row">
            {TYPE_ROWS[1].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => openTypedEvent(t.key)}
                title={`Enregistrer ${t.label} maintenant`}
              >
                <span className="glyph">＋</span>
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="evt-filterbar no-print" role="search">
        <label htmlFor={queryInputId} className="evt-filterbar-label">
          <span className="evt-filterbar-glyph" aria-hidden="true">⌕</span>
          <input
            id={queryInputId}
            type="search"
            className="evt-filterbar-input"
            placeholder="Rechercher description, notes, type…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="evt-filterbar-flags" role="group" aria-label="Filtrer par catégorie">
          {FILTER_FLAGS.map((f) => {
            const meta = FLAGS[f];
            const on = activeFlags.has(f);
            const cls = ['flag', 'flag-filter', 'flag-active', f];
            if (activeFlags.size > 0) cls.push(on ? 'is-on' : 'is-off');
            return (
              <button
                key={f}
                type="button"
                className={cls.join(' ')}
                onClick={() => toggleFlagFilter(f)}
                aria-pressed={on}
                title={on ? `Retirer le filtre ${meta.label}` : `Filtrer sur ${meta.label}`}
              >
                {meta.label}
              </button>
            );
          })}
          {filteringActive && (
            <button
              type="button"
              className="btn ghost mini evt-filterbar-clear"
              onClick={clearFilters}
            >
              Effacer
            </button>
          )}
        </div>
      </div>

      <div className="evt-list">
        <div className="evt evt-head no-print" aria-hidden="true">
          <div className="time">Heure</div>
          <div className="dur">Durée</div>
          <div className="type-h">Type</div>
          <div className="desc">Description</div>
          <div className="flags-h">Catégorie</div>
        </div>
        {filteredEvents.map((ev) => (
          <EventRow key={ev.id} ev={ev} onOpen={openEvent} onRemove={removeEvent} />
        ))}
        {filteredEvents.length === 0 && events.length === 0 && !filteringActive && (
          <div className="evt-empty no-print">
            <div>Aucun événement pour Poste {poste}.</div>
          </div>
        )}
        {filteredEvents.length === 0 && filteringActive && (
          <div className="evt-empty no-print">
            <div>
              {events.length > 0
                ? 'Aucun résultat dans ce shift.'
                : 'Aucun résultat pour ce shift.'}
            </div>
            {otherMatches.length === 0 && (
              <button type="button" className="btn ghost mini" onClick={clearFilters}>
                Effacer les filtres
              </button>
            )}
          </div>
        )}
        {otherMatches.length > 0 && (
          <div className="evt-other-matches no-print">
            <div className="evt-other-head">
              <span className="evt-other-title">
                <span className="evt-other-icon" aria-hidden="true">⤴</span>
                Autres shifts
              </span>
              <span className="evt-other-count">
                {otherMatches.length} résultat{otherMatches.length > 1 ? 's' : ''}
              </span>
            </div>
            {otherMatches.slice(0, 50).map((m) => (
              <OtherMatchRow
                key={`${m.date}.${m.poste}.${m.ev.id}`}
                match={m}
                onNavigate={onNavigate}
              />
            ))}
            {otherMatches.length > 50 && (
              <div className="evt-other-more faint small">
                + {otherMatches.length - 50} autres — affinez la recherche pour les voir.
              </div>
            )}
          </div>
        )}
        <div className="summary">
          <span><strong>{summary.total}</strong> événements</span>
          <span>planifié <strong>{fmtDuration(summary.scheduledMin)}</strong></span>
          <span>non planifié <strong>{fmtDuration(summary.unscheduledMin)}</strong></span>
          {filteringActive && hiddenCount > 0 && (
            <span className="faint no-print">{hiddenCount} masqué{hiddenCount > 1 ? 's' : ''}</span>
          )}
          <span style={{ marginLeft: 'auto' }} className="no-print">
            <button className="btn ghost" onClick={() => window.print()}>Imprimer</button>
          </span>
        </div>
      </div>

      <PrintSignature poste={poste} />

      <button
        type="button"
        className="fab no-print"
        onClick={() => setFabOpen(true)}
        aria-label="Nouvel événement"
        title="Nouvel événement"
      >
        <span className="fab-glyph" aria-hidden="true">＋</span>
      </button>

      {fabOpen && (
        <FabTypeSheet
          onPick={openTypedEvent}
          onClose={() => setFabOpen(false)}
        />
      )}

      {editing && (
        <EventEditor
          event={editing.event}
          onSave={saveFromEditor}
          onDelete={() => editing.event?.id && removeEvent(editing.event.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface FabTypeSheetProps {
  onPick: (type: string) => void;
  onClose: () => void;
}

function FabTypeSheet({ onPick, onClose }: FabTypeSheetProps) {
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet fab-sheet" role="dialog" aria-modal="true" aria-label="Choisir un type d'événement">
        <div className="grabber" />
        <div className="sheet-head">
          <h3>Nouvel événement</h3>
          <button className="btn ghost icon" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="fab-sheet-grid">
          {EVENT_TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`fab-type-btn ${t.key === 'Nouveau' ? 'is-add' : ''}`}
              onClick={() => onPick(t.key)}
            >
              <span className="glyph" aria-hidden="true">＋</span>
              <span className="fab-type-label">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

interface EventRowProps {
  ev: LogEvent;
  onOpen: (ev: LogEvent) => void;
  onRemove: (id: string) => void;
}

const EventRow = memo(function EventRow({ ev, onOpen, onRemove }: EventRowProps) {
  const tint = tintForFlag(ev.flag);
  const minutes = diffMinutes(ev.start, ev.end);
  const sameStartEnd = ev.start && ev.end && ev.start === ev.end;
  const notes = (ev.notes || []).filter((n) => n && n.trim());

  const open = () => onOpen(ev);

  return (
    <div
      className={`evt ${tint ? `tint-${tint}` : ''} ${ev.danger ? 'is-danger' : ''}`}
      onClick={open}
      role="button"
      tabIndex={0}
      aria-label={`${ev.start || 'Événement'} ${ev.type} ${ev.desc || ''}`.trim()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
    >
      <div className="time">
        {ev.start ? <span className="start">{ev.start}</span> : <span className="faint">—</span>}
        {ev.end && !sameStartEnd ? <span className="end"> → {ev.end}</span> : null}
      </div>
      <div className="dur">{sameStartEnd ? <span className="faint">·</span> : fmtDuration(minutes)}</div>
      <span className="type">{ev.type}</span>
      <div className="desc">
        <span style={{ fontWeight: ev.bold ? 600 : 400 }}>
          {ev.desc || <span className="faint">(sans description)</span>}
        </span>
        {notes.map((n, i) => (
          <span key={i} className="sub">{n}</span>
        ))}
      </div>
      <div className="flags">
        {ev.flag ? (
          <span className={`flag flag-active ${ev.flag}`}>{FLAGS[ev.flag].label}</span>
        ) : (
          <span className="flag flag-empty muted">—</span>
        )}
      </div>
      <div className="row-actions no-print">
        <button
          type="button"
          className="btn ghost icon"
          title="Supprimer l’événement"
          aria-label="Supprimer l’événement"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(ev.id);
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
});

interface OtherMatchRowProps {
  match: OtherMatch;
  onNavigate?: (date: string, poste: Poste) => void;
}

function OtherMatchRow({ match, onNavigate }: OtherMatchRowProps) {
  const { ev, date, poste } = match;
  const tint = tintForFlag(ev.flag);
  const minutes = diffMinutes(ev.start, ev.end);
  const sameStartEnd = ev.start && ev.end && ev.start === ev.end;
  const navigable = !!onNavigate;
  const go = () => onNavigate?.(date, poste);

  return (
    <div
      className={`evt evt-other ${tint ? `tint-${tint}` : ''} ${ev.danger ? 'is-danger' : ''} ${navigable ? 'is-clickable' : ''}`}
      onClick={navigable ? go : undefined}
      role={navigable ? 'button' : undefined}
      tabIndex={navigable ? 0 : undefined}
      aria-label={`Voir ${fmtShortDate(date)} Poste ${poste}`}
      onKeyDown={
        navigable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                go();
              }
            }
          : undefined
      }
    >
      <div className="time">
        {ev.start ? <span className="start">{ev.start}</span> : <span className="faint">—</span>}
        {ev.end && !sameStartEnd ? <span className="end"> → {ev.end}</span> : null}
      </div>
      <div className="dur">{sameStartEnd ? <span className="faint">·</span> : fmtDuration(minutes)}</div>
      <span className="type">{ev.type}</span>
      <div className="desc">
        <span className="evt-other-tag mono">{fmtShortDate(date)} · Poste {poste}</span>
        <span style={{ fontWeight: ev.bold ? 600 : 400 }}>
          {ev.desc || <span className="faint">(sans description)</span>}
        </span>
      </div>
      <div className="flags">
        {ev.flag ? (
          <span className={`flag flag-active ${ev.flag}`}>{FLAGS[ev.flag].label}</span>
        ) : (
          <span className="flag flag-empty muted">—</span>
        )}
      </div>
    </div>
  );
}

interface PrintHeaderProps {
  poste: Poste | null;
  shiftMeta: ShiftMeta;
}

function PrintHeader({ poste, shiftMeta }: PrintHeaderProps) {
  return (
    <div className="print-header print-only">
      <h1>Logbook · Poste {poste} · {shiftMeta.shift.label}</h1>
      <div className="meta">
        <span><strong>Date:</strong> {shiftMeta.dateLabel}</span>
        <span><strong>Horaires:</strong> {shiftMeta.shift.hours}</span>
        <span><strong>Opérateur:</strong> ____________________</span>
      </div>
    </div>
  );
}

function PrintSignature({ poste }: { poste: Poste | null }) {
  return (
    <div className="print-signature print-only">
      <div className="sig-row">
        <div>
          <div className="sig-line" />
          <div className="sig-label">Signature opérateur · Poste {poste}</div>
        </div>
        <div>
          <div className="sig-line" />
          <div className="sig-label">Visa chef d'équipe</div>
        </div>
      </div>
    </div>
  );
}

interface SummaryResult {
  total: number;
  scheduledMin: number;
  unscheduledMin: number;
}

function computeSummary(events: LogEvent[]): SummaryResult {
  let scheduledMin = 0;
  let unscheduledMin = 0;
  for (const e of events) {
    const m = diffMinutes(e.start, e.end);
    if (m == null || m === 0) continue;
    if (e.flag === 'scheduled') scheduledMin += m;
    if (e.flag === 'unscheduled') unscheduledMin += m;
  }
  return { total: events.length, scheduledMin, unscheduledMin };
}
