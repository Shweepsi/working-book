// Envoyer à Claude: files (a logbook .xlsm, a photo, a PDF) or a plain note,
// stored by the Worker for Claude to read back. Opened from Réglages. The app
// only sends, lists and takes back; reading the bytes needs a key the app
// never holds (see /api/uploads/file in the Worker).

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { ApiError, apiDelete, apiGet, apiUpload } from '../lib/api';
import { fmtStamp } from '../lib/format';
import { useToast } from '../lib/toast';

interface UploadMeta {
  id: string;
  name: string;
  type: string;
  size: number;
  note: string | null;
  created_at: number;
}

// Same ceilings as the Worker. Checked here first so a 40 MB file is refused
// before it spends a minute on the plant's network to be refused there.
const MAX_BYTES = 25 * 1024 * 1024;
// The note travels in the query string next to its file. Past this it goes as
// a text file of its own, where its length doesn't matter.
const NOTE_PARAM_MAX = 1000;
// Le temps d'un « Annuler » avant que la suppression parte au Worker.
const DELETE_DELAY_MS = 6_000;

interface Progress {
  index: number;
  total: number;
  name: string;
  loaded: number;
  size: number;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ko`;
  return `${(bytes / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
}

function errorText(err: unknown): string {
  const code = err instanceof ApiError ? err.message : '';
  if (code === 'payload_too_large') return 'Fichier trop lourd : 25 Mo au plus.';
  if (code === 'storage_full') return 'Stockage plein : supprime d’anciens envois.';
  if (code === 'network_error') return 'L’envoi n’a pas abouti : réseau coupé, ou bloqué en route.';
  return `L’envoi a échoué${err instanceof ApiError && err.status ? ` (${err.status})` : ''}.`;
}

/** « note-2026-10-18-0642.txt » — a note sent on its own needs a file name. */
function noteFileName(now = new Date()): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `note-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}.txt`;
}

export default function EnvoiClaude({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<UploadMeta[] | null>(null);
  const [listError, setListError] = useState(false);
  const [dragging, setDragging] = useState(false);
  const sending = progress !== null;

  async function refresh() {
    try {
      const res = await apiGet<UploadMeta[]>('/api/uploads');
      setSent(res?.data ?? []);
      setListError(false);
    } catch {
      setListError(true);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, sending]);

  function addFiles(list: FileList | File[]) {
    const picked = Array.from(list);
    if (picked.length === 0) return;
    setError(null);
    setFiles((prev) => [...prev, ...picked]);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (!sending) addFiles(e.dataTransfer.files);
  }

  // A screenshot pasted into the note joins the files instead of vanishing.
  function onPaste(e: ClipboardEvent) {
    if (e.clipboardData.files.length > 0) {
      e.preventDefault();
      addFiles(e.clipboardData.files);
    }
  }

  async function send() {
    const text = note.trim();
    const tooBig = files.find((f) => f.size > MAX_BYTES);
    if (tooBig) {
      setError(`« ${tooBig.name} » pèse ${fmtSize(tooBig.size)} : 25 Mo au plus.`);
      return;
    }

    const queue: Array<{ body: Blob; name: string; note: string }> = files.map((f) => ({
      body: f,
      name: f.name,
      note: text.length <= NOTE_PARAM_MAX ? text : '',
    }));
    if (text && (files.length === 0 || text.length > NOTE_PARAM_MAX)) {
      queue.push({ body: new Blob([text], { type: 'text/plain;charset=utf-8' }), name: noteFileName(), note: '' });
    }
    if (queue.length === 0) return;

    setError(null);
    let done = 0;
    try {
      for (const [index, item] of queue.entries()) {
        setProgress({ index, total: queue.length, name: item.name, loaded: 0, size: item.body.size });
        const qs = new URLSearchParams({ name: item.name });
        if (item.note) qs.set('note', item.note);
        await apiUpload(`/api/uploads?${qs}`, item.body, (loaded, size) =>
          setProgress({ index, total: queue.length, name: item.name, loaded, size }),
        );
        done++;
      }
      setFiles([]);
      setNote('');
      toast.show({ message: queue.length > 1 ? `${queue.length} envois reçus pour Claude` : 'Envoi reçu pour Claude' });
    } catch (err) {
      // What already went through stays sent; only the rest is left to retry.
      setFiles((prev) => prev.slice(Math.min(done, prev.length)));
      setError(errorText(err));
    } finally {
      setProgress(null);
      void refresh();
    }
  }

  function remove(item: UploadMeta) {
    setSent((prev) => prev?.filter((u) => u.id !== item.id) ?? prev);
    const timer = setTimeout(() => {
      apiDelete(`/api/uploads?id=${encodeURIComponent(item.id)}`).catch(() => {
        toast.show({ message: `« ${item.name} » n’a pas pu être supprimé`, variant: 'danger' });
        void refresh();
      });
    }, DELETE_DELAY_MS);
    toast.show({
      message: `« ${item.name} » supprimé`,
      ttl: DELETE_DELAY_MS,
      undo: () => {
        clearTimeout(timer);
        void refresh();
      },
    });
  }

  const canSend = !sending && (files.length > 0 || note.trim() !== '');
  const pct = progress && progress.size > 0 ? Math.round((progress.loaded / progress.size) * 100) : 0;

  return (
    <>
      <div className="sheet-backdrop" onClick={sending ? undefined : onClose} />
      <div className="sheet ec-sheet" role="dialog" aria-modal="true" aria-label="Envoyer à Claude">
        <div className="grabber" />
        <div className="sheet-head">
          <div className="sheet-head-titles">
            <h3>Envoyer à Claude</h3>
            <span className="sheet-head-sub">Fichiers et notes que Claude pourra lire ensuite</span>
          </div>
          <button type="button" className="btn ghost icon" onClick={onClose} disabled={sending} aria-label="Fermer">
            ✕
          </button>
        </div>

        <div
          className={`ec-drop${dragging ? ' is-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <button type="button" className="btn" onClick={() => inputRef.current?.click()} disabled={sending}>
            Choisir des fichiers
          </button>
          <span className="faint small">ou les déposer ici · 25 Mo au plus par fichier</span>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {files.length > 0 && (
          <ul className="ec-list">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="ec-item">
                <span className="ec-name">{f.name}</span>
                <span className="ec-meta faint">{fmtSize(f.size)}</span>
                <button
                  type="button"
                  className="btn ghost icon"
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  disabled={sending}
                  aria-label={`Retirer ${f.name}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className="ec-note">
          <span className="sc-label">Note pour Claude (facultatif)</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onPaste={onPaste}
            rows={3}
            disabled={sending}
            placeholder="Ex. : logbook du poste B, 16/10 — à importer dans working-book"
          />
        </label>

        {progress && (
          <div className="ec-progress" aria-live="polite">
            <div className="ec-bar">
              <span style={{ width: `${pct}%` }} />
            </div>
            <span className="small">
              {progress.total > 1 && `${progress.index + 1}/${progress.total} · `}
              {progress.name} · {pct} %
            </span>
          </div>
        )}
        {error && <div className="sch-import-status sch-error">⚠ {error}</div>}

        <div className="ec-actions">
          <button type="button" className="btn primary" onClick={() => void send()} disabled={!canSend}>
            {sending ? 'Envoi…' : 'Envoyer'}
          </button>
        </div>

        <section className="ec-sent">
          <h4>Déjà envoyés</h4>
          {listError ? (
            <p className="faint small">Liste indisponible — réseau ?</p>
          ) : sent === null ? (
            <p className="faint small">Chargement…</p>
          ) : sent.length === 0 ? (
            <p className="faint small">Rien pour l’instant.</p>
          ) : (
            <ul className="ec-list">
              {sent.map((u) => (
                <li key={u.id} className="ec-item">
                  <span className="ec-name">{u.name}</span>
                  <span className="ec-meta faint">
                    {fmtSize(u.size)} · {fmtStamp(u.created_at)}
                  </span>
                  <button
                    type="button"
                    className="btn ghost icon"
                    onClick={() => remove(u)}
                    aria-label={`Supprimer ${u.name}`}
                    title="Supprimer"
                  >
                    ✕
                  </button>
                  {u.note && <span className="ec-item-note faint small">{u.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
