import { useEffect, useState } from 'react';
import { EVENT_TYPES, FLAGS } from '../data/eventTypes.js';
import { fmtHM } from '../lib/time.js';

const EMPTY = { start: '', end: '', type: '', desc: '', flag: '', notes: [], bold: false, danger: false };

// Force "HH:MM" shape as user types: strip non-digits, cap at 4 digits, splice colon.
// Empty stays empty so a "no-time" event is still acceptable.
function maskTime(raw) {
  const digits = (raw || '').replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

export default function EventEditor({ event, onSave, onDelete, onClose }) {
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
    onSave({
      ...draft,
      start: draft.start || null,
      end: draft.end || draft.start || null,
      type: draft.type || 'Note',
      desc: draft.desc.trim(),
      flag:
        draft.flag ||
        EVENT_TYPES.find((t) => t.key === draft.type)?.defaultFlag ||
        null,
      bold: !!draft.bold,
      danger: !!draft.danger,
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

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="grabber" />
        <div className="sheet-head">
          <h3>{isNew ? 'Log event' : 'Edit event'}</h3>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="form-grid">
          <div className="form-section">
            <label className="section-label">When</label>
            <div className="time-range">
              <input
                type="text"
                className="time-input"
                placeholder="HH:MM"
                value={draft.start || ''}
                onChange={(e) => update('start', maskTime(e.target.value))}
                inputMode="numeric"
                maxLength={5}
              />
              <button
                type="button"
                className="now-btn"
                onClick={() => update('start', fmtHM())}
                title="Set start to now"
                aria-label="Set start to now"
              >
                ◷
              </button>
              <span className="arrow">→</span>
              <input
                type="text"
                className="time-input"
                placeholder="HH:MM"
                value={draft.end || ''}
                onChange={(e) => update('end', maskTime(e.target.value))}
                inputMode="numeric"
                maxLength={5}
              />
              <button
                type="button"
                className="now-btn"
                onClick={() => update('end', fmtHM())}
                title="Set end to now"
                aria-label="Set end to now"
              >
                ◷
              </button>
            </div>
          </div>

          <div className="form-section">
            <label className="section-label">Type</label>
            <select
              className="type-select"
              value={draft.type || ''}
              onChange={(e) => update('type', e.target.value)}
            >
              <option value="">Select…</option>
              {EVENT_TYPES.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className="form-section">
            <label className="section-label">Catégorie</label>
            <div className="flag-pick">
              {Object.values(FLAGS).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`flag ${draft.flag === f.key ? `flag-active ${f.key}` : 'flag-empty'}`}
                  onClick={() => update('flag', draft.flag === f.key ? '' : f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="form-section">
            <label className="section-label">
              Description
              <span className="mep-controls">
                <button
                  type="button"
                  className={`mep-toggle ${draft.bold ? 'active' : ''}`}
                  onClick={() => update('bold', !draft.bold)}
                  title="Mise en page : mettre la description en gras"
                  aria-pressed={!!draft.bold}
                >
                  <strong>B</strong>
                </button>
                <button
                  type="button"
                  className={`mep-toggle is-danger ${draft.danger ? 'active' : ''}`}
                  onClick={() => update('danger', !draft.danger)}
                  title="Mise en page : marquer comme consigne / danger"
                  aria-pressed={!!draft.danger}
                >
                  ⚠
                </button>
              </span>
            </label>
            <input
              type="text"
              className={`text-input ${draft.bold ? 'is-bold' : ''} ${draft.danger ? 'is-danger' : ''}`}
              placeholder="Description (#plates work too)"
              value={draft.desc || ''}
              onChange={(e) => update('desc', e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              autoFocus={isNew}
            />
          </div>

          <div className="form-section">
            <label className="section-label">
              Notes
              <button className="btn ghost mini" type="button" onClick={addNote}>+ add</button>
            </label>
            {(draft.notes || []).length === 0 && (
              <span className="faint small">No notes yet.</span>
            )}
            {(draft.notes || []).map((n, i) => (
              <div key={i} className="note-row">
                <input
                  type="text"
                  placeholder="e.g. Première plaque #375 à 06:35"
                  value={n}
                  onChange={(e) => setNote(i, e.target.value)}
                />
                <button
                  className="btn ghost icon"
                  type="button"
                  onClick={() => removeNote(i)}
                  aria-label="Remove note"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="actions">
          {!isNew && (
            <button
              className="btn ghost danger"
              type="button"
              onClick={() => {
                onDelete();
                onClose();
              }}
            >
              Delete
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <button className="btn primary" type="button" onClick={save}>
            {isNew ? 'Log' : 'Save'}
          </button>
        </div>
      </div>
    </>
  );
}
