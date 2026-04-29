import { useEffect, useMemo, useState } from 'react';
import { SAMPLE_EVENTS, SAMPLE_SHIFT, newId } from '../data/shift.js';
import { EVENT_TYPES, FLAGS, tintForFlag } from '../data/eventTypes.js';
import { diffMinutes, fmtDuration, fmtHM, liveDurationSince } from '../lib/time.js';
import { load, save } from '../lib/storage.js';

const STORAGE_KEY = 'wb.logbook.v1';

export default function Logbook({ now }) {
  const [events, setEvents] = useState(() => load(STORAGE_KEY, SAMPLE_EVENTS));
  const [draft, setDraft] = useState(() => emptyDraft());

  useEffect(() => {
    save(STORAGE_KEY, events);
  }, [events]);

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

  function commitDraft() {
    if (!draft.desc.trim() && !draft.start && !draft.type) return;
    const start = draft.start || fmtHM(now);
    setEvents((prev) => [
      ...prev,
      {
        id: newId(),
        start: draft.start || (draft.type ? start : null),
        end: draft.end || null,
        type: draft.type || 'Note',
        desc: draft.desc.trim(),
        flag: draft.flag || EVENT_TYPES.find((t) => t.key === draft.type)?.defaultFlag || null,
      },
    ]);
    setDraft(emptyDraft());
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
    if (!window.confirm('Reset to sample shift data? Local edits will be lost.')) return;
    setEvents(SAMPLE_EVENTS);
  }

  return (
    <div>
      <div className="now-bar">
        {running ? (
          <RunningStrip ev={running} now={now} onEnd={endRunning} />
        ) : (
          <IdleStrip />
        )}
        <div className="quickadd">
          <label>Quick log →</label>
          <input
            type="text"
            placeholder="HH:MM"
            value={draft.start}
            onChange={(e) => setDraft({ ...draft, start: e.target.value })}
            style={{ width: 64 }}
          />
          <span className="faint">→</span>
          <input
            type="text"
            placeholder="HH:MM"
            value={draft.end}
            onChange={(e) => setDraft({ ...draft, end: e.target.value })}
            style={{ width: 64 }}
          />
          <select
            value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value })}
          >
            <option value="">Type…</option>
            {EVENT_TYPES.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
          <input
            type="text"
            className="desc-input"
            placeholder="Description (#plates work too)"
            value={draft.desc}
            onChange={(e) => setDraft({ ...draft, desc: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && commitDraft()}
          />
          <select
            value={draft.flag}
            onChange={(e) => setDraft({ ...draft, flag: e.target.value })}
          >
            <option value="">Flag…</option>
            {Object.values(FLAGS).map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
          <button className="btn primary" onClick={commitDraft}>Log ⏎</button>
        </div>
      </div>

      <div className="evt-list">
        {events.map((ev) => (
          <EventRow
            key={ev.id}
            ev={ev}
            now={now}
            onPatch={(changes) => patch(ev.id, changes)}
            onRemove={() => remove(ev.id)}
          />
        ))}
        <div className="summary">
          <span><strong>{summary.total}</strong> events</span>
          <span><strong>{summary.imprevus}</strong> imprévus</span>
          <span>planned <strong>{fmtDuration(summary.plannedMin)}</strong></span>
          <span>unplanned <strong>{fmtDuration(summary.unplannedMin)}</strong></span>
          <span style={{ marginLeft: 'auto' }}>
            <button className="btn ghost" onClick={reset}>Reset sample data</button>
          </span>
        </div>
      </div>
    </div>
  );
}

function emptyDraft() {
  return { start: '', end: '', type: '', desc: '', flag: '' };
}

function RunningStrip({ ev, now, onEnd }) {
  const min = liveDurationSince(ev.start, now);
  const variant = ev.flag === 'unplan' ? 'alarm' : 'running';
  return (
    <div className={`live ${variant}`}>
      <span className="pulse" />
      <div className="text">
        <div className="title">{ev.type} — {ev.desc || 'in progress'}</div>
        <div className="muted xsmall">started {ev.start}</div>
      </div>
      <span className="timer">{fmtDuration(min)}</span>
      <button className="btn" style={{ marginLeft: 12 }} onClick={onEnd}>End now</button>
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

function EventRow({ ev, now, onPatch, onRemove }) {
  const tint = tintForFlag(ev.flag);
  const live = ev.start && !ev.end ? liveDurationSince(ev.start, now) : null;
  const minutes = ev.start && ev.end ? diffMinutes(ev.start, ev.end) : live;
  const refs = (ev.desc || '').match(/#\d+/g) || [];
  const typeMeta = EVENT_TYPES.find((t) => t.key === ev.type);

  return (
    <div className={`evt ${tint ? `tint-${tint}` : ''}`}>
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
        <span style={{ fontWeight: typeMeta?.bold ? 600 : 400 }}>{ev.desc || <span className="faint">(no description)</span>}</span>
        {refs.length > 0 && <span className="refs">{refs.join(' · ')}</span>}
        {(ev.notes || []).map((n, i) => (
          <span key={i} className="sub">{n}</span>
        ))}
      </div>
      <div className="flags">
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
      </div>
      <div className="row-actions">
        {!ev.end && ev.start && (
          <button
            className="btn ghost xsmall"
            onClick={() => onPatch({ end: fmtHM(now) })}
            style={{ fontSize: 10, padding: '2px 6px' }}
          >
            End
          </button>
        )}
        <button
          className="btn ghost xsmall"
          onClick={onRemove}
          style={{ fontSize: 10, padding: '2px 6px' }}
        >
          ✕
        </button>
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
