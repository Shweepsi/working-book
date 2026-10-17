// The Suivi assistant's sheet (lib/assist.ts): Claude fills cells from what
// the operator types or dictates, and writes the shift's summary. Saisir
// writes what Claude understood at once, as this tablet's own edits, and the
// toast takes it back. Bilan shows the summary with a tab per colour.

import { useEffect, useRef, useState } from 'react';
import { askAssistant, cellKey, reportAssistant, type AssistBilan, type AssistBilanCouleur, type AssistItem, type AssistMode, type AssistReply } from '../lib/assist';
import { sharedGrid as grid, type Partition } from '../lib/sharedGrid';
import { useToast } from '../lib/toast';

interface GridAssistantProps {
  part: Partition;
  onClose: () => void;
}

type Tab = AssistMode;

const MODES: { key: Tab; label: string; busy: string }[] = [
  { key: 'saisie', label: 'Saisir', busy: 'Claude prépare la saisie…' },
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
  const [mode, setMode] = useState<Tab>('saisie');
  const [text, setText] = useState('');
  // Claude asked something about the request: the answer goes with both.
  const [asked, setAsked] = useState<{ request: string; question: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<AssistReply | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  function switchMode(m: Tab) {
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
      return;
    }
    setAsked(null);
    if (!(r.changes ?? []).length) return;
    // Written at once: the toast takes it back. Only what couldn't be written stays on screen.
    if (!write(r, r.changes ?? [], r.undo ?? [], r.text)) return;
    const refused = (r.items ?? []).filter((i) => !i.ok);
    if (!refused.length) {
      onClose();
      return;
    }
    setText('');
    setReply({ ...r, text: `Écrit : ${r.text ?? 'la saisie'}. Pas écrit :`, items: refused, changes: [], undo: [] });
  }

  /** Writes cells as this tablet's own edits, with a toast to take them back. */
  function write(r: AssistReply, changes: AssistReply['changes'] & object, undo: AssistReply['undo'] & object, summary?: string): boolean {
    if (!grid.write(part, changes)) {
      setError('Le classeur n’est pas prêt : réessaie quand il est chargé.');
      return false;
    }
    const n = changes.length;
    reportAssistant(part, r.id, 'valide', changes.map(cellKey));
    toast.show({
      message: summary ?? `${n} cellule${n > 1 ? 's' : ''} corrigée${n > 1 ? 's' : ''} par l’assistant`,
      undo: () => {
        grid.write(part, undo);
        reportAssistant(part, r.id, 'annule');
      },
    });
    return true;
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
                placeholder={asked ? 'Ta réponse…' : 'Ex. : ligne 14 fin de ligne, 3 flaking et 2 scratches (écrit aussitôt)'}
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
                  {listening ? (
                    '■'
                  ) : (
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="9" y="3" width="6" height="11" rx="3" />
                      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                    </svg>
                  )}
                </button>
              )}
            </div>
            <div className="gca-actions">
              <button type="button" className="btn primary" disabled={busy || !text.trim()} onClick={() => void propose()}>
                Saisir
              </button>
            </div>
          </div>
        )}

        {mode === 'bilan' && !reply && !busy && (
          <div className="gca-start">
            <p className="gca-hint">Claude rédige le résumé du poste pour l’équipe suivante, couleur par couleur, à partir des chiffres du Rapport.</p>
            <button type="button" className="btn primary" onClick={() => void ask('bilan', '')}>
              Rédiger le bilan
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
            {reply.bilan ? <Bilan b={reply.bilan} /> : <p className="gca-bilan">{reply.text}</p>}
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

        {reply && mode === 'saisie' && !asked && (
          <div className="gca-result">
            {reply.text && <p className="gca-summary">{reply.text}</p>}
            {items.length > 0 && (
              <ul className="gca-items">
                {items.map((it) => (
                  <Item key={`${it.cell}-${it.label}`} item={it} />
                ))}
              </ul>
            )}
          </div>
        )}

      </div>
    </>
  );
}

const num = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 3 });

const delta = (v: number) => <td className={v ? 'is-bad' : ''}>{num(v)}</td>;

/** The summary, laid out the same way every time: the shift's totals, then a tab per colour. */
function Bilan({ b }: { b: AssistBilan }) {
  const [tab, setTab] = useState(0);
  const p = b.poste;
  const current = b.couleurs[Math.min(tab, b.couleurs.length - 1)];
  return (
    <div className="gca-bilan-view" aria-label="Bilan du poste">
      <p className="gca-bilan-resume">{b.resume}</p>

      <h4>Production du poste</h4>
      <table className="gca-bilan-table">
        <thead>
          <tr>
            <th />
            <th>Début de ligne</th>
            <th>Fin de ligne</th>
            <th>Rejets</th>
            <th>Delta</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Lites</th>
            <td>{num(p.dl_lites)}</td>
            <td>{num(p.fl_lites)}</td>
            <td>{num(p.rejets_lites)}</td>
            {delta(p.delta_lites)}
          </tr>
          <tr>
            <th>m²</th>
            <td>{num(p.dl_m2)}</td>
            <td>{num(p.fl_m2)}</td>
            <td>{num(p.rejets_m2)}</td>
            {delta(p.delta_m2)}
          </tr>
        </tbody>
      </table>

      {b.general.length > 0 && (
        <ul className="gca-bilan-list">
          {b.general.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}

      {current ? (
        <>
          <div className="gca-bilan-tabs" role="tablist" aria-label="Couleurs">
            {b.couleurs.map((c, i) => (
              <button
                key={c.couleur}
                type="button"
                role="tab"
                aria-selected={c === current}
                className={`${c === current ? 'active' : ''}${c.delta_lites ? ' is-bad' : ''}`}
                onClick={() => setTab(i)}
              >
                {c.couleur}
              </button>
            ))}
          </div>
          <BilanCouleur key={current.couleur} c={current} />
        </>
      ) : (
        <p className="gca-bilan-none">Aucune production.</p>
      )}
    </div>
  );
}

/** One colour's tab: its line of the COULEUR table, its rejects per defect, then the lists. */
function BilanCouleur({ c }: { c: AssistBilanCouleur }) {
  return (
    <div role="tabpanel" className="gca-bilan-panel" aria-label={c.couleur}>
      <table className="gca-bilan-table">
        <thead>
          <tr>
            <th>Lites</th>
            <th>Début de ligne</th>
            <th>Fin de ligne</th>
            <th>Rejets</th>
            <th>Delta</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>{c.couleur}</th>
            <td>{num(c.dl_lites)}</td>
            <td>{num(c.fl_lites)}</td>
            <td>{num(c.rejets_lites)}</td>
            {delta(c.delta_lites)}
          </tr>
        </tbody>
      </table>

      <h4>Rejets par défaut</h4>
      {c.defauts.length ? (
        <ul className="gca-bilan-defauts">
          {c.defauts.map((d) => (
            <li key={d.defaut}>
              <span>{d.defaut}</span>
              <strong>{num(d.lites)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="gca-bilan-none">Aucun rejet.</p>
      )}

      <BilanList title="Anomalies" items={c.anomalies} none="Aucune." />
      <BilanList title="Lignes incomplètes" items={c.incompletes} none="Aucune." />
      <BilanList title="Restes en début de ligne" items={c.restes} none="Aucun." />
      <BilanList title="À surveiller" items={c.surveiller} none="Rien de particulier." />
    </div>
  );
}

function BilanList({ title, items, none }: { title: string; items: string[]; none: string }) {
  return (
    <>
      <h4>{title}</h4>
      {items.length ? (
        <ul className="gca-bilan-list">
          {items.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      ) : (
        <p className="gca-bilan-none">{none}</p>
      )}
    </>
  );
}

/** A cell of the saisie that couldn't be written, with why. */
function Item({ item }: { item: AssistItem }) {
  const remark = item.after === null;
  return (
    <li className={`gca-item${item.ok ? '' : ' is-off'}${remark ? ' is-remark' : ''}`}>
      <span className="gca-item-glyph" aria-hidden="true">
        {remark ? '⚠' : '–'}
      </span>
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
