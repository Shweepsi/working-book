// Editing the Suivi template, for the device that holds the editor's key (see
// lib/gridEditor.ts). The template opens in its own GridCraft frame, full
// ribbon and not shared: nothing reaches the operators until it is published.
// GridCraft's Save (Ctrl+S, File › Save) publishes it as a new template, and an
// .xlsx made in Excel can be published the same way. Shifts not started yet
// take the newest template; the shift on screen can be moved to it at once.

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchTemplate, moveToTemplate, uploadTemplate } from '../lib/gridEditor';
import type { GridTheme, TemplateInfo } from '../lib/sharedGrid';
import type { Poste } from '../types';

interface TemplateEditorProps {
  template: TemplateInfo;
  date: string;
  dateLabel: string;
  poste: Poste | null;
  theme: GridTheme;
  /** Closes the editor; `published` when a new template was stored. */
  onClose: (published: boolean) => void;
}

export default function TemplateEditor({ template, date, dateLabel, poste, theme, onClose }: TemplateEditorProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [src] = useState(() => `/gridcraft/?host=parent&titlebar=0&theme=${theme}`);
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [published, setPublished] = useState(false);
  const frameReady = useRef(false);

  const post = useCallback((msg: unknown, transfer: Transferable[] = []) => {
    frameRef.current?.contentWindow?.postMessage(msg, window.location.origin, transfer);
  }, []);

  const show = useCallback(
    (data: ArrayBuffer) => {
      const copy = data.slice(0);
      post({ type: 'gridcraft:open', name: template.name, bytes: copy }, [copy]);
    },
    [post, template.name],
  );

  useEffect(() => {
    let cancelled = false;
    fetchTemplate(template.id)
      .then((b) => !cancelled && setBytes(b))
      .catch((e: unknown) => !cancelled && setNotice(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [template.id]);

  // The template goes to the frame once both are there.
  useEffect(() => {
    if (bytes && frameReady.current) show(bytes);
  }, [bytes, show]);

  const publish = useCallback(
    async (data: Blob) => {
      if (
        !window.confirm(
          `Publier ce modèle ?\n\nLes postes pas encore commencés partiront de cette version. Ceux déjà ouverts gardent la leur.`,
        )
      ) {
        return;
      }
      setBusy(true);
      setNotice(null);
      try {
        const id = await uploadTemplate(data, template.name);
        let moved = false;
        if (
          poste &&
          window.confirm(
            `Basculer aussi le poste ${poste} du ${dateLabel} sur cette version ?\n\nLes cellules déjà saisies restent aux mêmes adresses.`,
          )
        ) {
          await moveToTemplate({ date, poste }, id);
          moved = true;
        }
        setPublished(true);
        setDirty(false);
        setNotice(moved ? `Modèle publié, poste ${poste} basculé.` : 'Modèle publié pour les prochains postes.');
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [date, dateLabel, poste, template.name],
  );

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin || !frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const data = e.data as { type?: string; bytes?: ArrayBuffer; dirty?: boolean; error?: string };
      switch (data?.type) {
        case 'gridcraft:ready':
          frameReady.current = true;
          if (bytes) show(bytes);
          break;
        case 'gridcraft:dirty':
          setDirty(!!data.dirty);
          break;
        case 'gridcraft:save':
          if (data.bytes) void publish(new Blob([data.bytes]));
          break;
        case 'gridcraft:failed':
          setNotice(data.error ?? 'GridCraft n’a pas démarré');
          break;
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [bytes, show, publish]);

  async function onImport(file: File) {
    await publish(file);
    // What was published is what the editor shows from now on.
    const data = await file.arrayBuffer();
    setBytes(data);
  }

  function close() {
    if (dirty && !window.confirm('Fermer sans publier ? Les modifications du modèle seront perdues.')) return;
    onClose(published);
  }

  return (
    <div className="gc gc-editing">
      <div className="gc-editor-bar no-print">
        <span className="gc-editor-title">
          Modèle <strong>{template.name}</strong> — en édition, pas encore visible des postes
        </span>
        <span className="gc-editor-hint">Ctrl+S ou Fichier › Enregistrer publie le modèle</span>
        {notice && <span className="gc-notice">{notice}</span>}
        <span className="gc-spacer" />
        <button type="button" className="btn ghost mini" onClick={() => fileRef.current?.click()} disabled={busy}>
          Importer un .xlsx…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void onImport(f);
          }}
        />
        <button type="button" className="btn mini" onClick={close} disabled={busy}>
          Fermer
        </button>
      </div>
      <iframe
        ref={frameRef}
        src={src}
        title={`Modèle ${template.name} — édition`}
        allow="fullscreen; clipboard-read; clipboard-write"
        allowFullScreen
      />
    </div>
  );
}
