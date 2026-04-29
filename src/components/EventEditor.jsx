import { useEffect, useState } from 'react';
import { EVENT_TYPES, FLAGS } from '../data/eventTypes.js';
import { fmtHM } from '../lib/time.js';

const EMPTY = { start: '', end: '', type: '', desc: '', flag: '', notes: [] };

export default function EventEditor({ event, now, onSave, onDelete, onClose }) {
  const isNew = !event?.id;
  const [draft, setDraft] = useState(() => ({ ...EMPTY, ...(event || {}) }));

  useEffect(() => {
    setDraft({ ...EMPTY, ...(event || {}) });
  }, [event]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function save() {
    if (!draft.type && !draft.desc.trim()) return;
    const start = draft.start || (draft.type ? fmtHM(now) : null);
    onSave({
      ...draft,
      start: draft.start || start,
      end: draft.end || null,
      type: draft.type || 'Note',
      desc: draft.desc.trim(),
      flag:
        draft.flag ||
        EVENT_TYPES.find((t) => t.key === draft.type)?.defaultFlag ||
        null,
    });
  }

  function update(field, value) {
    setDraft((d) => ({ ...d, [field]: value }));
  }

  function setNote(i, value) {
    setDraft((d) => {
      const notes = [...(d.notes || [])];
      notes[i] = value;
      return { ...d, notes };
    });
  }

  function addNote() {
    setDraft((d) => ({ ...d, notes: [...(d.notes || []), ''] }));
  }

  function removeNote(i) {
    setDraft((d) => {
      const notes = [...(d.notes || [])];
      notes.splice(i, 1);
      return { ...d, notes };
    });
  }

  function handleEnd() {
    update('end', fmtHM(now));
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="grabber" />
        <div className="sheet-head">
          <h3>{isNew ? 'Log event' : 'Edit event'}</h3>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="field-row">
          <label>Start</label>
          <input
            type="text"
            placeholder="HH:MM"
            value={draft.start || ''}
            onChange={(e) => update('start', e.target.value)}
          />
          <button className="btn" onClick={() => update('start', fmtHM(now))} type="button">
            now
          </button>
        </div>

        <div className="field-row">
          <label>End</label>
          <input
            type="text"
            placeholder="HH:MM"
            value={draft.end || ''}
            onChange={(e) => update('end', e.target.value)}
          />
          <button className="btn" onClick={handleEnd} type="button">now</button>
        </div>

        <div className="field-row">
          <label>Type</label>
          <select value={draft.type || ''} onChange={(e) => update('type', e.target.value)}>
            <option value="">Select…</option>
            {EVENT_TYPES.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
        </div>

        <div className="field-row">
          <label>Flag</label>
          <div className="flag-pick">
            {Object.values(FLAGS).map((f) => (
              <button
                key={f.key}
                type="button"
                className={`flag ${draft.flag === f.key ? f.key : ''}`}
                style={{ opacity: draft.flag === f.key ? 1 : 0.5 }}
                onClick={() => update('flag', draft.flag === f.key ? '' : f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field-row">
          <label>Description</label>
          <input
            type="text"
            placeholder="Description (#plates work too)"
            value={draft.desc || ''}
            onChange={(e) => update('desc', e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            autoFocus={isNew}
          />
        </div>

        <div className="field-row col">
          <label>Notes / sub-events</label>
          {(draft.notes || []).map((n, i) => (
            <div key={i} className="row gap-2 ai-c" style={{ width: '100%' }}>
              <input
                type="text"
                placeholder="e.g. Première plaque #375 à 06:35"
                value={n}
                onChange={(e) => setNote(i, e.target.value)}
                style={{ flex: 1 }}
              />
              <button className="btn ghost" type="button" onClick={() => removeNote(i)}>✕</button>
            </div>
          ))}
          <button className="btn" type="button" onClick={addNote} style={{ alignSelf: 'flex-start' }}>
            + Add note
          </button>
        </div>

        <div className="actions">
          {!isNew && (
            <button
              className="btn ghost"
              type="button"
              style={{ color: 'var(--accent)' }}
              onClick={() => {
                onDelete();
                onClose();
              }}
            >
              Delete
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn primary" type="button" onClick={save}>
            {isNew ? 'Log' : 'Save'}
          </button>
        </div>
      </div>
    </>
  );
}
