// The Suivi assistant's sheet (lib/assist.ts): Claude fills cells from what
// the operator types or dictates, checks the shift before the handover, and
// writes its summary. Nothing reaches the workbook until the operator accepts
// the cells it proposes; they are then written as this tablet's own edits, and
// the toast takes them back.

import { useEffect, useRef, useState } from 'react';
import { askAssistant, cellKey, type AssistItem, type AssistMode, type AssistReply } from '../lib/assist';
import { sharedGrid as grid, type Partition } from '../lib/sharedGrid';
import { useToast } from '../lib/toast';

interface GridAssistantProps {
  part: Partition;
  onClose: () => void;
}

const MODES: { key: AssistMode; label: string; busy: string }[] = [
  { key: 'saisie', label: 'Saisir', busy: 'Claude prépare la saisie…' },
  { key: 'controle', label: 'Vérifier', busy: 'Claude relit le poste…' },
  { key: 'bilan', label: 'Bilan', busy: 'Claude rédige le bilan…' },
];

// The Web Speech API: Chrome on Android tablets has it (prefixed), Firefox not.
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
const Speech = ((window as unknown as Record<string, unknown>).SpeechRecognition ??
  (window as unknown as Record<string, unknown>).webkitSpeechRecognition) as (new () => Recognition) | undefined;

const dayLabel = (iso: string) => iso.split('-').reverse().join('/');

export default function GridAssistant({ part, onClose }: GridAssistantProps) {
  const toast = useToast();
  const [mode, setMode] = useState<AssistMode>('saisie');
  const [text, setText] = useState('');
  // Claude asked something about the request: the answer goes with both.
  const [asked, setAsked] = useState<{ request: string; question: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<AssistReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [listening, setListening] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      recRef.current?.stop();
    },
    [],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function switchMode(m: AssistMode) {
    if (busy || m === mode) return;
    setMode(m);
    setReply(null);
    setError(null);
    setAsked(null);
  }

  async function ask(m: AssistMode, input: string): Promise<AssistReply | null> {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy(true);
    setReply(null);
    setError(null);
    try {
      const r = await askAssistant(part, m, input, ctl.signal);
      if (!r.ok) {
        setError(r.error ?? 'L’assistant n’a pas pu répondre.');
        return null;
      }
      setReply(r);
      setPicked(new Set((r.items ?? []).filter((i) => i.ok).map((i) => i.cell)));
      return r;
    } catch {
      return null; // Closed or asked again meanwhile.
    } finally {
      if (abortRef.current === ctl) setBusy(false);
    }
  }

  async function propose() {
    const said = text.trim();
    if (!said || busy) return;
    recRef.current?.stop();
    const request = asked ? `${asked.request}\nQuestion de l'assistant : ${asked.question}\nRéponse de l'opérateur : ${said}` : said;
    const r = await ask('saisie', request);
    if (!r) return;
    if (r.question && !(r.items ?? []).length) {
      setAsked({ request, question: r.question });
      setText('');
      areaRef.current?.focus();
    } else {
      setAsked(null);
    }
  }

  function accept() {
    if (!reply) return;
    const changes = (reply.changes ?? []).filter((c) => picked.has(cellKey(c)));
    const undo = (reply.undo ?? []).filter((c) => picked.has(cellKey(c)));
    if (!changes.length) return;
    if (!grid.write(part, changes)) {
      setError('Le classeur n’est pas prêt : réessaie quand il est chargé.');
      return;
    }
    const n = changes.length;
    const done = mode === 'controle' ? 'corrigée' : 'saisie';
    toast.show({ message: `${n} cellule${n > 1 ? 's' : ''} ${done}${n > 1 ? 's' : ''} par l’assistant`, undo: () => grid.write(part, undo) });
    onClose();
  }

  function dictate() {
    if (!Speech) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new Speech();
    rec.lang = 'fr-FR';
    rec.interimResults = true;
    rec.continuous = false;
    const base = text.trim() ? `${text.trimEnd()} ` : '';
    rec.onresult = (e) => {
      let said = '';
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript;
      setText(base + said);
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
    };
    rec.onerror = () => undefined;
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  function toggle(cell: string) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(cell)) next.delete(cell);
      else next.add(cell);
      return next;
    });
  }

  async function copy(t: string) {
    try {
      await navigator.clipboard.writeText(t);
      toast.show({ message: 'Bilan copié' });
    } catch {
      setError('Copie impossible ici : sélectionne le texte à la main.');
    }
  }

  const current = MODES.find((m) => m.key === mode) ?? MODES[0];
  const items = reply?.items ?? [];
  const writable = items.filter((i) => i.ok && picked.has(i.cell)).length;

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet gca" role="dialog" aria-modal="true" aria-label="Assistant du Suivi">
        <div className="grabber" />
        <div className="sheet-head">
          <div className="sheet-head-titles">
            <h3>Assistant</h3>
            <span className="sheet-head-sub">
              Poste {part.poste} du {dayLabel(part.date)} · Claude
            </span>
          </div>
          <button type="button" className="btn ghost icon" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>

        <div className="seg" role="group" aria-label="Que faire ?">
          {MODES.map((m) => (
            <button key={m.key} type="button" className={m.key === mode ? 'active' : ''} aria-pressed={m.key === mode} onClick={() => switchMode(m.key)}>
              {m.label}
            </button>
          ))}
        </div>

        {mode === 'saisie' && (
          <div className="gca-ask">
            {asked && <p className="gca-question">{asked.question}</p>}
            <div className="gca-input">
              <textarea
                ref={areaRef}
                autoFocus
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void propose();
                  }
                }}
                placeholder={asked ? 'Ta réponse…' : 'Ex. : ligne 14 fin de ligne, 3 flaking et 2 scratches'}
                aria-label="Ce qu’il faut saisir"
              />
              {Speech && (
                <button
                  type="button"
                  className={`btn ghost gca-mic${listening ? ' is-on' : ''}`}
                  onClick={dictate}
                  aria-pressed={listening}
                  aria-label={listening ? 'Arrêter la dictée' : 'Dicter'}
                  title={listening ? 'Arrêter la dictée' : 'Dicter'}
                >
                  {listening ? '■' : '🎤'}
                </button>
              )}
            </div>
            <div className="gca-actions">
              <button type="button" className="btn primary" disabled={busy || !text.trim()} onClick={() => void propose()}>
                Proposer
              </button>
            </div>
          </div>
        )}

        {mode !== 'saisie' && !reply && !busy && (
          <div className="gca-start">
            <p className="gca-hint">
              {mode === 'controle'
                ? 'Claude relit le poste et signale ce qui cloche avant la relève : dates tapées en texte, défauts sans quantité, écarts entre début et fin de ligne…'
                : 'Claude rédige le résumé du poste pour l’équipe suivante, à partir des chiffres du Rapport.'}
            </p>
            <button type="button" className="btn primary" onClick={() => void ask(mode, '')}>
              {mode === 'controle' ? 'Vérifier le poste' : 'Rédiger le bilan'}
            </button>
          </div>
        )}

        {busy && (
          <div className="gca-busy" role="status">
            <span className="gc-loading-glyph" aria-hidden="true">
              ↻
            </span>
            {current.busy}
          </div>
        )}

        {error && <p className="gca-error">⚠ {error}</p>}

        {reply && mode === 'bilan' && reply.text && (
          <div className="gca-result">
            <p className="gca-bilan">{reply.text}</p>
            <div className="gca-actions">
              <button type="button" className="btn ghost" onClick={() => void ask('bilan', '')} disabled={busy}>
                Refaire
              </button>
              <button type="button" className="btn primary" onClick={() => void copy(reply.text ?? '')}>
                Copier
              </button>
            </div>
          </div>
        )}

        {reply && mode !== 'bilan' && !(mode === 'saisie' && asked) && (
          <div className="gca-result">
            {reply.text && <p className="gca-summary">{reply.text}</p>}
            {items.length > 0 ? (
              <ul className="gca-items">
                {items.map((it) => (
                  <Item key={`${it.cell}-${it.label}`} item={it} picked={picked.has(it.cell)} onToggle={() => toggle(it.cell)} />
                ))}
              </ul>
            ) : (
              mode === 'controle' && <p className="gca-hint">Rien à signaler.</p>
            )}
            <div className="gca-actions">
              {mode === 'controle' && (
                <button type="button" className="btn ghost" onClick={() => void ask('controle', '')} disabled={busy}>
                  Revérifier
                </button>
              )}
              {(reply.changes ?? []).length > 0 && (
                <button type="button" className="btn primary" disabled={!writable} onClick={accept}>
                  {mode === 'controle' ? `Corriger (${writable})` : `Valider (${writable})`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Item({ item, picked, onToggle }: { item: AssistItem; picked: boolean; onToggle: () => void }) {
  const remark = item.after === null;
  return (
    <li className={`gca-item${item.ok ? '' : ' is-off'}${remark ? ' is-remark' : ''}`}>
      {item.ok ? (
        <input type="checkbox" checked={picked} onChange={onToggle} aria-label={`Écrire ${item.label}`} />
      ) : (
        <span className="gca-item-glyph" aria-hidden="true">
          {remark ? '⚠' : '–'}
        </span>
      )}
      <div className="gca-item-body">
        <span className="gca-item-label">{item.label}</span>
        <span className="gca-item-values">
          {remark ? (
            item.before && <span>{item.before}</span>
          ) : (
            <>
              {item.before && item.before !== item.after && (
                <>
                  <s className="gca-before">{item.before}</s>
                  <span aria-hidden="true"> → </span>
                </>
              )}
              <strong className="gca-after">{item.after || '(vide)'}</strong>
            </>
          )}
        </span>
        {item.note && <span className="gca-item-note">{item.note}</span>}
      </div>
    </li>
  );
}
