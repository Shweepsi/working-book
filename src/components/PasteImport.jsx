import { useEffect, useRef, useState } from 'react';

// Reusable paste sheet. Drives both PMS230 and policy imports.
//
// Props:
//   parser(payload: { html, text }) -> result   // pure parser
//   describe(result) -> string                  // success preview, e.g. "✓ 49 records across 4 schedules"
//   showAppend                                  // when true, expose Replace + Append actions
//   onConfirm(result, mode: 'replace' | 'append')
//   onClose
//   title, hint
export default function PasteImport({
  parser,
  describe,
  showAppend = false,
  onConfirm,
  onClose,
  title,
  hint,
}) {
  const [payload, setPayload] = useState({ html: '', text: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const taRef = useRef(null);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    taRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function handlePaste(e) {
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (!html && !text) return;
    e.preventDefault();
    setPayload({ html, text });
    setError(null);
    try {
      const parsed = parser({ html, text });
      setResult(parsed);
    } catch (err) {
      setError(err?.message ?? 'Parsing failed');
      setResult(null);
    }
    if (taRef.current) taRef.current.value = text || '(HTML payload)';
  }

  function reparse(rawText) {
    setPayload({ html: '', text: rawText });
    setError(null);
    try {
      setResult(parser({ html: '', text: rawText }));
    } catch (err) {
      setError(err?.message ?? 'Parsing failed');
      setResult(null);
    }
  }

  const hasPayload = payload.html || payload.text;
  const summary = result ? describe(result) : null;
  const warnings = result?.warnings ?? [];
  const ready = result && (result.records?.length || result.count) > 0;

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet sch-import" role="dialog" aria-modal="true">
        <div className="grabber" />
        <div className="sheet-head">
          <h3>{title}</h3>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {hint && <p className="faint small sch-import-hint">{hint}</p>}

        <textarea
          ref={taRef}
          className="sch-import-area mono"
          placeholder="Coller ici (Ctrl+V)…"
          onPaste={handlePaste}
          onChange={(e) => reparse(e.target.value)}
          spellCheck={false}
          rows={8}
        />

        {error && (
          <div className="sch-import-status sch-error">⚠ {error}</div>
        )}
        {summary && (
          <div className="sch-import-status sch-ok">{summary}</div>
        )}
        {warnings.length > 0 && (
          <details className="sch-import-warnings">
            <summary>{warnings.length} warning{warnings.length > 1 ? 's' : ''}</summary>
            <ul>
              {warnings.slice(0, 30).map((w, i) => (
                <li key={i} className="small">{w}</li>
              ))}
              {warnings.length > 30 && (
                <li className="small faint">…and {warnings.length - 30} more</li>
              )}
            </ul>
          </details>
        )}

        <div className="actions">
          <span style={{ flex: 1 }} />
          <button className="btn ghost" type="button" onClick={onClose}>Annuler</button>
          {showAppend && (
            <button
              className="btn"
              type="button"
              disabled={!ready}
              onClick={() => onConfirm(result, 'append')}
              title="Fusionner avec les données existantes (dédup sur schedule|MO)"
            >
              Ajouter
            </button>
          )}
          <button
            className="btn primary"
            type="button"
            disabled={!ready}
            onClick={() => onConfirm(result, 'replace')}
          >
            {showAppend ? 'Remplacer' : 'Importer'}
          </button>
        </div>
      </div>
    </>
  );
}
