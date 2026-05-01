import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import type { PastePayload } from '../types.ts';

// Reusable paste sheet. Drives both PMS230 and policy imports.
//
// Generic R is the parser's result shape. We constrain it lightly so we can
// surface a row count for the import button without forcing every parser to
// expose the same field names.
export interface ImportResultLike {
  records?: unknown[];
  count?: number;
  warnings?: string[];
}

interface Props<R extends ImportResultLike> {
  parser: (payload: PastePayload) => R;
  describe: (result: R) => string;
  showAppend?: boolean;
  onConfirm: (result: R, mode: 'replace' | 'append') => void;
  onClose: () => void;
  title: string;
  hint?: string;
}

export default function PasteImport<R extends ImportResultLike>({
  parser,
  describe,
  showAppend = false,
  onConfirm,
  onClose,
  title,
  hint,
}: Props<R>) {
  const [result, setResult] = useState<R | null>(null);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    taRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (!html && !text) return;
    e.preventDefault();
    setError(null);
    try {
      const parsed = parser({ html, text });
      setResult(parsed);
    } catch (err) {
      setError((err as Error)?.message ?? 'Parsing failed');
      setResult(null);
    }
    if (taRef.current) taRef.current.value = text || '(HTML payload)';
  }

  function reparse(rawText: string) {
    setError(null);
    try {
      setResult(parser({ html: '', text: rawText }));
    } catch (err) {
      setError((err as Error)?.message ?? 'Parsing failed');
      setResult(null);
    }
  }

  const summary = result ? describe(result) : null;
  const warnings = result?.warnings ?? [];
  const ready = !!result && ((result.records?.length ?? 0) > 0 || (result.count ?? 0) > 0);

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
              onClick={() => result && onConfirm(result, 'append')}
              title="Fusionner avec les données existantes (dédup sur schedule|MO)"
            >
              Ajouter
            </button>
          )}
          <button
            className="btn primary"
            type="button"
            disabled={!ready}
            onClick={() => result && onConfirm(result, 'replace')}
          >
            {showAppend ? 'Remplacer' : 'Importer'}
          </button>
        </div>
      </div>
    </>
  );
}
