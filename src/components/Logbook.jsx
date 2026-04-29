import { useEffect, useMemo, useState } from 'react';
import { SAMPLE_EVENTS, newId } from '../data/shift.js';
import { EVENT_TYPES, FLAGS, tintForFlag } from '../data/eventTypes.js';
import { diffMinutes, fmtDuration, fmtHM, liveDurationSince } from '../lib/time.js';
import { load, save } from '../lib/storage.js';
import EventEditor from './EventEditor.jsx';

function storageKey(poste) {
  return `wb.logbook.v2.${poste}`;
}

function defaultsForPoste(poste) {
  return poste === 'C' ? SAMPLE_EVENTS : [];
}

export default function Logbook({ now, poste, shiftMeta }) {
  const [events, setEvents] = useState(() =>
    load(storageKey(poste), defaultsForPoste(poste)),
  );
  const [editing, setEditing] = useState(null); // { event } | { event: { id: null, ...defaults } } | null

  useEffect(() => {
    setEvents(load(storageKey(poste), defaultsForPoste(poste)));
  }, [poste]);

  useEffect(() => {
    save(storageKey(poste), events);
  }, [events, poste]);

  const running = useMemo(() => events.find((e) => e.start && !e.end), [events]);
  const summary = useMemo(() => computeSummary(events), [events]);

  function startEvent(type) {
    const start = fmtHM(now);
    if (running && running.type === type) return;
    setEvents((prev) => {
      const closed = running
        ? prev.map((e) => (e.id === running.id ? { ...e, end: start } : e))
        : prev;
      return [
        ...closed,
        {
          id: newId(),
          start,
          end: null,
          type,
          desc: '',
          flag: EVENT_TYPES.find((t) => t.key === type)?.defaultFlag ?? null,
        },
      ];
    });
  }

  function patch(id, changes) {
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...changes } : e)));
  }

  function remove(id) {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }

  function endRunning() {
    if (!running) return;
    patch(running.id, { end: fmtHM(now) });
  }

  function reset() {
    if (!window.confirm(`Reset Poste ${poste} to ${poste === 'C' ? 'sample' : 'empty'} data?`)) return;
    setEvents(defaultsForPoste(poste));
  }

  function openNewEvent() {
    setEditing({ event: { start: fmtHM(now), end: '', type: '', desc: '', flag: '', notes: [] } });
  }

  function saveFromEditor(payload) {
    if (payload.id) {
      patch(payload.id, payload);
    } else {
      setEvents((prev) => [...prev, { ...payload, id: newId() }]);
    }
    setEditing(null);
  }

  return (
    <div>
      <PrintHeader poste={poste} shiftMeta={shiftMeta} />

      <div className="now-bar no-print">
        {running ? (
          <RunningStrip ev={running} now={now} onEnd={endRunning} onClick={() => setEditing({ event: running })} />
        ) : (
          <IdleStrip />
        )}
        <div className="quickadd">
          <label>Quick log →</label>
          <button className="btn primary" onClick={openNewEvent}>＋ New event</button>
          <span className="faint" style={{ fontSize: 11 }}>or pick a type below</span>
        </div>
      </div>

      <div className="type-strip no-print">
        {EVENT_TYPES.filter((t) => t.key !== 'Note').map((t) => {
          const isLive = running?.type === t.key;
          return (
            <button
              key={t.key}
              type="button"
              className={isLive ? 'live' : ''}
              onClick={() => startEvent(t.key)}
              title={isLive ? 'Currently running' : `Start ${t.label} now`}
            >
              <span className="glyph">{isLive ? '●' : '＋'}</span>
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="evt-list">
        <div className="evt evt-head no-print" aria-hidden="true">
          <div className="time">Time</div>
          <div className="dur">Dur.</div>
          <div className="type-h">Type</div>
          <div className="desc">Description</div>
          <div className="flags-h">Flags</div>
        </div>
        {events.map((ev) => (
          <EventRow
            key={ev.id}
            ev={ev}
            now={now}
            onPatch={(changes) => patch(ev.id, changes)}
            onRemove={() => remove(ev.id)}
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
          <span><strong>{summary.imprevus}</strong> imprévus</span>
          <span>planned <strong>{fmtDuration(summary.plannedMin)}</strong></span>
          <span>unplanned <strong>{fmtDuration(summary.unplannedMin)}</strong></span>
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

function RunningStrip({ ev, now, onEnd, onClick }) {
  const min = liveDurationSince(ev.start, now);
  const variant = ev.flag === 'unplan' ? 'alarm' : 'running';
  return (
    <div className={`live ${variant}`} onClick={onClick} role="button">
      <span className="pulse" />
      <div className="text">
        <div className="title">{ev.type} — {ev.desc || 'in progress'}</div>
        <div className="muted xsmall">started {ev.start} · tap to edit</div>
      </div>
      <span className="timer">{fmtDuration(min)}</span>
      <button
        className="btn"
        style={{ marginLeft: 12 }}
        onClick={(e) => { e.stopPropagation(); onEnd(); }}
      >
        End now
      </button>
    </div>
  );
}

function IdleStrip() {
  return (
    <div className="live idle">
      <span className="pulse" />
      <div className="text">
        <div className="title">No event running</div>
        <div className="muted xsmall">tap a type below to start one</div>
      </div>
    </div>
  );
}

function EventRow({ ev, now, onPatch, onRemove, onOpen }) {
  const tint = tintForFlag(ev.flag);
  const live = ev.start && !ev.end ? liveDurationSince(ev.start, now) : null;
  const minutes = ev.start && ev.end ? diffMinutes(ev.start, ev.end) : live;
  const refs = (ev.desc || '').match(/#\d+/g) || [];
  const typeMeta = EVENT_TYPES.find((t) => t.key === ev.type);

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
        {' '}
        <span className="end">
          {live != null ? '· running' : ev.end ? `→ ${ev.end}` : ''}
        </span>
      </div>
      <div className="dur">{fmtDuration(minutes)}</div>
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
      <div className="flags" onClick={(e) => e.stopPropagation()}>
        {Object.values(FLAGS).map((f) => (
          <button
            key={f.key}
            type="button"
            title={f.label}
            className={`flag ${ev.flag === f.key ? f.key : ''}`}
            style={{ opacity: ev.flag === f.key ? 1 : 0.45 }}
            onClick={() => onPatch({ flag: ev.flag === f.key ? null : f.key })}
          >
            {f.label}
          </button>
        ))}
        {!ev.end && ev.start && (
          <button
            className="btn ghost row-action"
            onClick={(e) => { e.stopPropagation(); onPatch({ end: fmtHM(now) }); }}
            style={{ fontSize: 11, padding: '4px 8px' }}
          >
            End
          </button>
        )}
      </div>
    </div>
  );
}

function PrintHeader({ poste, shiftMeta }) {
  return (
    <div className="print-header print-only">
      <h1>Logbook · Poste {poste}</h1>
      <div className="meta">
        <span><strong>Date:</strong> {shiftMeta.date}</span>
        <span><strong>Horaires:</strong> {shiftMeta.hours}</span>
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
  let plannedMin = 0;
  let unplannedMin = 0;
  let imprevus = 0;
  for (const e of events) {
    if (e.flag === 'unplan') imprevus += 1;
    const m = diffMinutes(e.start, e.end);
    if (m == null) continue;
    if (e.flag === 'planned') plannedMin += m;
    if (e.flag === 'unplan') unplannedMin += m;
  }
  return { total: events.length, imprevus, plannedMin, unplannedMin };
}
