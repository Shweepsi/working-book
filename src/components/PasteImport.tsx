import { useEffect, useRef, useState } from 'react';
import { useEscapeToClose } from '../lib/hooks';

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
  const [result, setResult] = useState<R | null>(null);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEscapeToClose(onClose);
  useEffect(() => {
    taRef.current?.focus();
  }, []);

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (!html && !text) return;
    e.preventDefault();
    setError(null);
    try {
      setResult(parser({ html, text }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de l’analyse');
      setResult(null);
    }
    if (taRef.current) taRef.current.value = text || '(HTML payload)';
  }

  function reparse(rawText: string) {
    setError(null);
    try {
      setResult(parser({ html: '', text: rawText }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de l’analyse');
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
          <button className="btn ghost icon" onClick={onClose} aria-label="Fermer">✕</button>
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
            <summary>{warnings.length} avertissement{warnings.length > 1 ? 's' : ''}</summary>
            <ul>
              {warnings.slice(0, 30).map((w, i) => (
                <li key={i} className="small">{w}</li>
              ))}
              {warnings.length > 30 && (
                <li className="small faint">…et {warnings.length - 30} de plus</li>
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
            onClick={() => {
              if (!result) return;
              if (showAppend) {
                const ok = window.confirm(
                  'Remplacer écrase toutes les données déjà importées. Continuer ?',
                );
                if (!ok) return;
              }
              onConfirm(result, 'replace');
            }}
          >
            {showAppend ? 'Remplacer' : 'Importer'}
          </button>
        </div>
      </div>
    </>
  );
}
