import { useEffect, useRef, useState } from 'react';

// Reusable paste sheet. Drives both PMS230 and policy imports.

export interface PastePayload {
  html: string;
  text: string;
}

export type ImportMode = 'replace' | 'append';

// Result must expose at least `warnings` and either `records.length` (PMS230) or
// `count` (policy) so the "ready to import" gate can fire.
export interface PasteImportResult {
  warnings?: string[];
  records?: unknown[];
  count?: number;
}

export interface PasteImportProps<R extends PasteImportResult> {
  parser: (payload: PastePayload) => R;
  describe: (result: R) => string;
  showAppend?: boolean;
  onConfirm: (result: R, mode: ImportMode) => void;
  onClose: () => void;
  title: string;
  hint?: string;
}

export default function PasteImport<R extends PasteImportResult>({
  parser,
  describe,
  showAppend = false,
  onConfirm,
  onClose,
  title,
  hint,
}: PasteImportProps<R>) {
  const [payload, setPayload] = useState<PastePayload>({ html: '', text: '' });
  const [result, setResult] = useState<R | null>(null);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    taRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
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
      setError(err instanceof Error ? err.message : 'Parsing failed');
      setResult(null);
    }
    if (taRef.current) taRef.current.value = text || '(HTML payload)';
  }

  function reparse(rawText: string) {
    setPayload({ html: '', text: rawText });
    setError(null);
    try {
      setResult(parser({ html: '', text: rawText }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Parsing failed');
      setResult(null);
    }
  }

  const hasPayload = payload.html || payload.text;
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
