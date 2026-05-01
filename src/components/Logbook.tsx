import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { SAMPLE_EVENTS, newId } from '../data/shift';
import { EVENT_TYPES, FLAGS, tintForFlag } from '../data/eventTypes';
import { diffMinutes, fmtDuration, fmtHM } from '../lib/time';
import { load, save } from '../lib/storage';
import EventEditor from './EventEditor';
import type { EventType, FlagKey, LogEvent, Poste, ShiftMeta } from '../types';

const EVENT_TYPE_BY_KEY = new Map<string, EventType>(EVENT_TYPES.map((t) => [t.key, t]));

// Two visual rows of type buttons; `row` on each event type drives placement.
const TYPE_ROWS: EventType[][] = [1, 2].map((r) => EVENT_TYPES.filter((t) => t.row === r));

function storageKey(date: string, poste: Poste | null): string {
  return `wb.logbook.v4.${date}.${poste}`;
}

// Seed the canonical "demo" shift (Poste C, 28-Apr-2026 morning) from the wireframe.
// Other (date, poste) pairs start empty.
function defaultsFor(date: string, poste: Poste | null, shiftKey: string): LogEvent[] {
  if (date === '2026-04-28' && poste === 'C' && shiftKey === 'M') return SAMPLE_EVENTS;
  return [];
}

interface LogbookProps {
  poste: Poste | null;
  shiftMeta: ShiftMeta;
}

interface EditingState {
  event: Partial<LogEvent>;
}

export default function Logbook({ poste, shiftMeta }: LogbookProps) {
  const { date, shift } = shiftMeta;
  const [events, setEvents] = useState<LogEvent[]>(() =>
    load<LogEvent[]>(storageKey(date, poste), defaultsFor(date, poste, shift.key)),
  );
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [showSecondary, setShowSecondary] = useState(false);

  useEffect(() => {
    save(storageKey(date, poste), events);
  }, [events, date, poste]);

  const summary = useMemo(() => computeSummary(events), [events]);

  function openTypedEvent(type: string) {
    const stamp = fmtHM();
    const meta = EVENT_TYPE_BY_KEY.get(type);
    setEditing({
      event: {
        start: stamp,
        end: '',
        type,
        desc: meta?.prefill ? meta.label : '',
        flag: meta?.defaultFlag ?? null,
        notes: meta?.openNote ? [''] : [],
      },
    });
  }

  const openEvent = useCallback((ev: LogEvent) => setEditing({ event: ev }), []);
  const removeEvent = useCallback(
    (id: string) => setEvents((prev) => prev.filter((e) => e.id !== id)),
    [],
  );

  function saveFromEditor(payload: LogEvent) {
    const normalized: LogEvent = { ...payload, end: payload.end || payload.start || null };
    setEvents((prev) =>
      normalized.id
        ? prev.map((e) => (e.id === normalized.id ? { ...e, ...normalized } : e))
        : [...prev, { ...normalized, id: newId() }],
    );
    setEditing(null);
  }

  return (
    <div>
      <PrintHeader poste={poste} shiftMeta={shiftMeta} />

      <div className="type-strip no-print">
        <div className="type-row">
          {TYPE_ROWS[0]!.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => openTypedEvent(t.key)}
              title={`Log ${t.label} starting now`}
            >
              <span className="glyph">＋</span>
              {t.label}
            </button>
          ))}
          <button
            type="button"
            className="type-more"
            onClick={() => setShowSecondary((v) => !v)}
            title={showSecondary ? 'Hide secondary types' : 'Show secondary types'}
            aria-expanded={showSecondary}
            aria-label="Toggle secondary types"
          >
            <span className="chevron" aria-hidden="true">⌄</span>
          </button>
        </div>
        {showSecondary && (
          <div className="type-row">
            {TYPE_ROWS[1]!.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => openTypedEvent(t.key)}
                title={`Log ${t.label} starting now`}
              >
                <span className="glyph">＋</span>
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="evt-list">
        <div className="evt evt-head no-print" aria-hidden="true">
          <div className="time">Time</div>
          <div className="dur">Dur.</div>
          <div className="type-h">Type</div>
          <div className="desc">Description</div>
          <div className="flags-h">Catégorie</div>
        </div>
        {events.map((ev) => (
          <EventRow key={ev.id} ev={ev} onOpen={openEvent} onRemove={removeEvent} />
        ))}
        {events.length === 0 && (
          <div className="evt-empty no-print">
            <div>No events yet for Poste {poste}.</div>
            <div className="faint xsmall">Tap a type above to log one.</div>
          </div>
        )}
        <div className="summary">
          <span><strong>{summary.total}</strong> events</span>
          <span>scheduled <strong>{fmtDuration(summary.scheduledMin)}</strong></span>
          <span>unscheduled <strong>{fmtDuration(summary.unscheduledMin)}</strong></span>
          <span style={{ marginLeft: 'auto' }} className="no-print">
            <button className="btn ghost" onClick={() => window.print()}>Print</button>
          </span>
        </div>
      </div>

      <PrintSignature poste={poste} />

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
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && open()}
    >
      <div className="time">
        {ev.start ? <span className="start">{ev.start}</span> : <span className="faint">—</span>}
        {ev.end && !sameStartEnd ? <span className="end"> → {ev.end}</span> : null}
      </div>
      <div className="dur">{sameStartEnd ? <span className="faint">·</span> : fmtDuration(minutes)}</div>
      <span className="type">{ev.type}</span>
      <div className="desc">
        <span style={{ fontWeight: ev.bold ? 600 : 400 }}>
          {ev.desc || <span className="faint">(no description)</span>}
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
      <div className="row-actions no-print" aria-hidden="true">
        <button
          type="button"
          className="iconbtn"
          title="Delete event"
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm('Delete this event?')) onRemove(ev.id);
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
});

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
