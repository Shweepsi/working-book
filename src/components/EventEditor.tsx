import { useEffect, useMemo, useState } from 'react';
import { EVENT_TYPES, FLAGS } from '../data/eventTypes';
import { useEscapeToClose } from '../lib/hooks';
import { fmtHM } from '../lib/time';
import type { LogEvent } from '../types';

type Draft = Omit<LogEvent, 'id'> & { id?: string };

const EMPTY: Draft = {
  start: '', end: '', type: '', desc: '', flag: null, notes: [], bold: false, danger: false,
};

interface EventEditorProps {
  event: Partial<LogEvent> | null;
  onSave: (event: LogEvent) => void;
  onDelete: () => void;
  onClose: () => void;
}

// Force "HH:MM" shape as user types: strip non-digits, cap at 4 digits, splice colon.
// Empty stays empty so a "no-time" event is still acceptable.
function maskTime(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

export default function EventEditor({ event, onSave, onDelete, onClose }: EventEditorProps) {
  const isNew = !event?.id;
  const [draft, setDraft] = useState<Draft>(() => ({ ...EMPTY, ...(event || {}) }));

  useEffect(() => {
    setDraft({ ...EMPTY, ...(event || {}) });
  }, [event]);

  useEscapeToClose(onClose);

  // The header summary line shows "10:42 → maintenant · Production · Planifié",
  // so the operator can verify the auto-filled values without expanding.
  const summary = useMemo(() => {
    const parts: string[] = [];
    if (draft.start) {
      parts.push(draft.end && draft.end !== draft.start ? `${draft.start} → ${draft.end}` : draft.start);
    }
    if (draft.type) parts.push(draft.type);
    if (draft.flag) parts.push(FLAGS[draft.flag].label);
    return parts.join(' · ');
  }, [draft.start, draft.end, draft.type, draft.flag]);

  function save() {
    if (!draft.type && !draft.desc.trim()) return;
    const fallbackFlag = EVENT_TYPES.find((t) => t.key === draft.type)?.defaultFlag ?? null;
    onSave({
      id: draft.id ?? '',
      ...draft,
      start: draft.start || null,
      end: draft.end || draft.start || null,
      type: draft.type || 'Note',
      desc: draft.desc.trim(),
      flag: draft.flag || fallbackFlag,
      bold: !!draft.bold,
      danger: !!draft.danger,
    });
  }

  function update<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [field]: value }));
  }

  function setNote(i: number, value: string) {
    setDraft((d) => {
      const notes = [...(d.notes || [])];
      notes[i] = value;
      return { ...d, notes };
    });
  }

  function addNote() {
    setDraft((d) => ({ ...d, notes: [...(d.notes || []), ''] }));
  }

  function removeNote(i: number) {
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
          <div className="sheet-head-titles">
            <h3>{isNew ? 'Nouvel événement' : 'Modifier l’événement'}</h3>
            {summary && <div className="sheet-head-sub mono">{summary}</div>}
          </div>
          <button className="btn ghost icon" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        <div className="form-grid">
          <div className="form-section">
            <label className="section-label">Catégorie</label>
            <div className="flag-pick">
              {Object.values(FLAGS).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`flag ${draft.flag === f.key ? `flag-active ${f.key}` : 'flag-empty'}`}
                  onClick={() => update('flag', draft.flag === f.key ? null : f.key)}
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
              placeholder="Description"
              value={draft.desc || ''}
              onChange={(e) => update('desc', e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              autoFocus={isNew}
            />
          </div>

          <div className="form-row form-row-when-type">
            <div className="form-section">
              <label className="section-label">Quand</label>
              <div className="time-range">
                <div className="time-input-group">
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
                    title="Définir le début à maintenant"
                    aria-label="Définir le début à maintenant"
                  >
                    ◷
                  </button>
                </div>
                <span className="arrow">→</span>
                <div className="time-input-group">
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
                    title="Définir la fin à maintenant"
                    aria-label="Définir la fin à maintenant"
                  >
                    ◷
                  </button>
                </div>
              </div>
            </div>

            <div className="form-section">
              <label className="section-label">Type</label>
              <select
                className="type-select"
                value={draft.type || ''}
                onChange={(e) => update('type', e.target.value)}
              >
                <option value="">Sélectionner…</option>
                {EVENT_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-section">
            <label className="section-label">
              Notes
              <button className="btn ghost mini" type="button" onClick={addNote}>+ ajouter</button>
            </label>
            {(draft.notes || []).length === 0 && (
              <span className="faint small">Aucune note.</span>
            )}
            {(draft.notes || []).map((n, i) => (
              <div key={i} className="note-row">
                <input
                  type="text"
                  placeholder="ex: #123"
                  value={n}
                  onChange={(e) => setNote(i, e.target.value)}
                />
                <button
                  className="btn ghost icon"
                  type="button"
                  onClick={() => removeNote(i)}
                  aria-label="Supprimer la note"
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
              Supprimer
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn ghost" type="button" onClick={onClose}>Annuler</button>
          <button className="btn primary" type="button" onClick={save}>
            Enregistrer
          </button>
        </div>
      </div>
    </>
  );
}
