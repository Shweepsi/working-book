import { useEffect, useMemo, useState } from 'react';
import { SAMPLE_EVENTS, newId } from '../data/shift.js';
import { EVENT_TYPES, FLAGS, tintForFlag } from '../data/eventTypes.js';
import { diffMinutes, fmtDuration, fmtHM } from '../lib/time.js';
import { load, save } from '../lib/storage.js';
import EventEditor from './EventEditor.jsx';

function storageKey(date, poste) {
  return `wb.logbook.v4.${date}.${poste}`;
}

function defaultsFor(date, poste, shiftKey) {
  // Seed sample data once for the canonical "demo" shift: Poste C on 28-Apr-2026
  // (matches the original wireframe context). Other (date, poste) pairs start empty.
  if (date === '2026-04-28' && poste === 'C' && shiftKey === 'M') return SAMPLE_EVENTS;
  return [];
}

export default function Logbook({ now, poste, shiftMeta }) {
  const { date, shift } = shiftMeta;
  const [events, setEvents] = useState(() =>
    load(storageKey(date, poste), defaultsFor(date, poste, shift.key)),
  );
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    setEvents(load(storageKey(date, poste), defaultsFor(date, poste, shift.key)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, poste]);

  useEffect(() => {
    save(storageKey(date, poste), events);
  }, [events, date, poste]);

  const summary = useMemo(() => computeSummary(events), [events]);

  function openTypedEvent(type) {
    const stamp = fmtHM(now);
    const flag = EVENT_TYPES.find((t) => t.key === type)?.defaultFlag ?? null;
    setEditing({
      event: { start: stamp, end: stamp, type, desc: '', flag, notes: [] },
    });
  }

  function patch(id, changes) {
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...changes } : e)));
  }

  function remove(id) {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }

  function reset() {
    if (!window.confirm(`Clear logbook for Poste ${poste} on ${date}?`)) return;
    setEvents(defaultsFor(date, poste, shift.key));
  }

  function openNewEvent() {
    setEditing({
      event: { start: fmtHM(now), end: fmtHM(now), type: '', desc: '', flag: '', notes: [] },
    });
  }

  function saveFromEditor(payload) {
    const normalized = {
      ...payload,
      end: payload.end || payload.start || null,
    };
    if (normalized.id) {
      patch(normalized.id, normalized);
    } else {
      setEvents((prev) => [...prev, { ...normalized, id: newId() }]);
    }
    setEditing(null);
  }

  return (
    <div>
      <PrintHeader poste={poste} shiftMeta={shiftMeta} />

      <div className="logbook-toolbar no-print">
        <div className="toolbar-left">
          <span className="muted small">Quick log →</span>
          <button className="btn primary" onClick={openNewEvent}>＋ New event</button>
          <span className="faint small">or pick a type</span>
        </div>
        <div className="toolbar-right small muted">
          {summary.total} events logged
        </div>
      </div>

      <div className="type-strip no-print">
        {EVENT_TYPES.map((t) => (
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

      <div className="evt-list">
        <div className="evt evt-head no-print" aria-hidden="true">
          <div className="time">Time</div>
          <div className="dur">Dur.</div>
          <div className="type-h">Type</div>
          <div className="desc">Description</div>
          <div className="flags-h">Catégorie</div>
        </div>
        {events.map((ev) => (
          <EventRow
            key={ev.id}
            ev={ev}
            onPatch={(changes) => patch(ev.id, changes)}
            onOpen={() => setEditing({ event: ev })}
          />
        ))}
        {events.length === 0 && (
          <div className="evt-empty">
            <div>No events yet for Poste {poste}.</div>
            <button className="btn primary" onClick={openNewEvent} style={{ marginTop: 10 }}>
              ＋ Log first event
            </button>
          </div>
        )}
        <div className="summary">
          <span><strong>{summary.total}</strong> events</span>
          <span><strong>{summary.unscheduledCount}</strong> unscheduled</span>
          <span>scheduled <strong>{fmtDuration(summary.scheduledMin)}</strong></span>
          <span>unscheduled <strong>{fmtDuration(summary.unscheduledMin)}</strong></span>
          <span style={{ marginLeft: 'auto' }} className="no-print">
            <button className="btn ghost" onClick={() => window.print()}>Print</button>
            <button className="btn ghost" onClick={reset}>Reset</button>
          </span>
        </div>
      </div>

      <PrintSignature poste={poste} />

      <button
        className="fab no-print"
        type="button"
        onClick={openNewEvent}
        aria-label="Log new event"
      >
        +
      </button>

      {editing && (
        <EventEditor
          event={editing.event}
          now={now}
          onSave={saveFromEditor}
          onDelete={() => editing.event?.id && remove(editing.event.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function EventRow({ ev, onPatch, onOpen }) {
  const tint = tintForFlag(ev.flag);
  const minutes = diffMinutes(ev.start, ev.end);
  const refs = (ev.desc || '').match(/#\d+/g) || [];
  const typeMeta = EVENT_TYPES.find((t) => t.key === ev.type);
  const sameStartEnd = ev.start && ev.end && ev.start === ev.end;

  return (
    <div
      className={`evt ${tint ? `tint-${tint}` : ''}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}
    >
      <div className="time">
        {ev.start ? <span className="start">{ev.start}</span> : <span className="faint">—</span>}
        {ev.end && !sameStartEnd ? <span className="end"> → {ev.end}</span> : null}
      </div>
      <div className="dur">{sameStartEnd ? <span className="faint">·</span> : fmtDuration(minutes)}</div>
      <span className="type">{ev.type}</span>
      <div className="desc">
        <span style={{ fontWeight: typeMeta?.bold ? 600 : 400 }}>
          {ev.desc || <span className="faint">(no description)</span>}
        </span>
        {refs.length > 0 && <span className="refs">{refs.join(' · ')}</span>}
        {(ev.notes || []).map((n, i) => (
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
    </div>
  );
}

function PrintHeader({ poste, shiftMeta }) {
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

function PrintSignature({ poste }) {
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

function computeSummary(events) {
  let scheduledMin = 0;
  let unscheduledMin = 0;
  let unscheduledCount = 0;
  for (const e of events) {
    if (e.flag === 'unscheduled') unscheduledCount += 1;
    const m = diffMinutes(e.start, e.end);
    if (m == null || m === 0) continue;
    if (e.flag === 'scheduled') scheduledMin += m;
    if (e.flag === 'unscheduled') unscheduledMin += m;
  }
  return { total: events.length, unscheduledCount, scheduledMin, unscheduledMin };
}
