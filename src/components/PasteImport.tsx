import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  // Extra controls rendered to the left of the close button in the sheet
  // header — used by the PMS230 importer to expose the MTO policy cog.
  headerActions?: ReactNode;
}

export default function PasteImport<R extends PasteImportResult>({
  parser,
  describe,
  showAppend = false,
  onConfirm,
  onClose,
  title,
  hint,
  headerActions,
}: PasteImportProps<R>) {
  const [result, setResult] = useState<R | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const canReadClipboard =
    typeof navigator !== 'undefined' && !!navigator.clipboard?.readText;

  useEscapeToClose(onClose);
  useEffect(() => {
    taRef.current?.focus();
  }, []);

  function applyParse(payload: PastePayload) {
    setError(null);
    try {
      setResult(parser(payload));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de l’analyse');
      setResult(null);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const html = e.clipboardData.getData('text/html');
    const txt = e.clipboardData.getData('text/plain');
    if (!html && !txt) return;
    e.preventDefault();
    const display = txt || '(HTML uniquement)';
    setText(display);
    applyParse({ html, text: txt });
  }

  function reparse(rawText: string) {
    setText(rawText);
    if (!rawText.trim()) {
      setResult(null);
      setError(null);
      return;
    }
    applyParse({ html: '', text: rawText });
  }

  async function pasteFromClipboard() {
    if (!canReadClipboard || busy) return;
    setBusy(true);
    try {
      const txt = await navigator.clipboard.readText();
      if (!txt) {
        setError('Presse-papiers vide.');
        return;
      }
      setText(txt);
      applyParse({ html: '', text: txt });
      taRef.current?.focus();
    } catch {
      setError('Accès au presse-papiers refusé. Utilisez Ctrl+V.');
    } finally {
      setBusy(false);
    }
  }

  function clearAll() {
    setText('');
    setResult(null);
    setError(null);
    taRef.current?.focus();
  }

  const summary = result ? describe(result) : null;
  const warnings = result?.warnings ?? [];
  const ready = !!result && ((result.records?.length ?? 0) > 0 || (result.count ?? 0) > 0);
  const lineCount = text ? text.split(/\r?\n/).filter((l) => l.trim()).length : 0;

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet sch-import" role="dialog" aria-modal="true">
        <div className="grabber" />
        <div className="sheet-head">
          <h3>{title}</h3>
          <div className="sheet-head-actions">
            {headerActions}
            <button className="btn ghost icon" onClick={onClose} aria-label="Fermer">✕</button>
          </div>
        </div>

        {hint && <p className="faint small sch-import-hint">{hint}</p>}

        <div className="sch-import-toolbar">
          {canReadClipboard && (
            <button
              type="button"
              className="btn"
              onClick={pasteFromClipboard}
              disabled={busy}
              title="Coller depuis le presse-papiers"
            >
              ⎘ Coller
            </button>
          )}
          {text && (
            <button
              type="button"
              className="btn ghost mini"
              onClick={clearAll}
              title="Vider la zone"
            >
              Vider
            </button>
          )}
          <span className="sch-import-stats faint small" aria-live="polite">
            {lineCount > 0
              ? `${lineCount} ligne${lineCount > 1 ? 's' : ''}`
              : 'Aucun contenu'}
          </span>
        </div>

        <textarea
          ref={taRef}
          className="sch-import-area mono"
          placeholder={
            canReadClipboard
              ? 'Coller ici (Ctrl+V) ou cliquer ⎘ Coller…'
              : 'Coller ici (Ctrl+V)…'
          }
          value={text}
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
