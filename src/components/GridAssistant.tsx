// The Suivi assistant's sheet (lib/assist.ts): Claude fills cells from what
// the operator types or dictates, checks the shift before the handover, and
// writes its summary. Nothing reaches the workbook until the operator accepts
// the cells it proposes; they are then written as this tablet's own edits, and
// the toast takes them back. Where the template can be edited, a fourth tab
// manages the workshop's vocabulary: the rules Claude proposed wait there
// until someone validates them.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addRule,
  askAssistant,
  cellKey,
  listRules,
  reportAssistant,
  updateRule,
  type AssistItem,
  type AssistMode,
  type AssistReply,
  type Rule,
} from '../lib/assist';
import { CAN_EDIT_TEMPLATE } from '../lib/gridEditor';
import { sharedGrid as grid, type Partition } from '../lib/sharedGrid';
import { useToast } from '../lib/toast';

interface GridAssistantProps {
  part: Partition;
  onClose: () => void;
}

type Tab = AssistMode | 'lexique';

const MODES: { key: Tab; label: string; busy: string }[] = [
  { key: 'saisie', label: 'Saisir', busy: 'Claude prépare la saisie…' },
  { key: 'controle', label: 'Vérifier', busy: 'Claude relit le poste…' },
  { key: 'bilan', label: 'Bilan', busy: 'Claude rédige le bilan…' },
  ...(CAN_EDIT_TEMPLATE ? [{ key: 'lexique' as const, label: 'Lexique', busy: '' }] : []),
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
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [listening, setListening] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  // The vocabulary, where it can be managed: its pending rules show on the tab.
  const [rules, setRules] = useState<Rule[] | null>(null);
  const loadRules = useCallback(() => {
    if (CAN_EDIT_TEMPLATE) listRules().then(setRules, () => undefined);
  }, []);
  useEffect(loadRules, [loadRules]);

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
      setPicked(new Set((r.items ?? []).filter((i) => i.ok).map((i) => i.cell)));
      if (r.rule) loadRules();
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
    const kept = changes.map(cellKey);
    reportAssistant(part, reply.id, 'valide', kept);
    toast.show({
      message: `${n} cellule${n > 1 ? 's' : ''} ${done}${n > 1 ? 's' : ''} par l’assistant`,
      undo: () => {
        grid.write(part, undo);
        reportAssistant(part, reply.id, 'annule');
      },
    });
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
  const pending = rules?.filter((r) => r.status === 'pending').length ?? 0;

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
              {m.key === 'lexique' && pending > 0 && <span className="gca-count">{pending}</span>}
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
                Proposer
              </button>
            </div>
          </div>
        )}

        {(mode === 'controle' || mode === 'bilan') && !reply && !busy && (
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

        {reply && (mode === 'saisie' || mode === 'controle') && !(mode === 'saisie' && asked) && (
          <div className="gca-result">
            {reply.text && <p className="gca-summary">{reply.text}</p>}
            {reply.rule && (
              <p className="gca-rule">
                Règle proposée pour le lexique : « {reply.rule} ». Elle servira une fois validée{CAN_EDIT_TEMPLATE ? ', dans le volet Lexique' : ''}.
              </p>
            )}
            {items.length > 0 ? (
              <ul className="gca-items">
                {items.map((it) => (
                  <Item key={`${it.cell}-${it.label}`} item={it} picked={picked.has(it.cell)} onToggle={() => toggle(it.cell)} />
                ))}
              </ul>
            ) : (
              mode === 'controle' && !reply.text && <p className="gca-hint">Rien à signaler.</p>
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

        {mode === 'lexique' && <LexiconPanel rules={rules} reload={loadRules} />}
      </div>
    </>
  );
}

/** The workshop's vocabulary: rules Claude proposed (to validate, reword or refuse) and the ones in use. */
function LexiconPanel({ rules, reload }: { rules: Rule[] | null; reload: () => void }) {
  const [draft, setDraft] = useState('');
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(job: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await job();
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!rules) return <p className="gca-hint">Chargement du lexique…</p>;
  const pending = rules.filter((r) => r.status === 'pending');
  const active = rules.filter((r) => r.status === 'active');
  return (
    <div className="gca-lexicon">
      <p className="gca-hint">Les règles validées servent à l’assistant sur toutes les tablettes. Celles que Claude propose attendent ici.</p>
      {error && <p className="gca-error">⚠ {error}</p>}
      {pending.length > 0 && (
        <section>
          <h4 className="section-label">À valider ({pending.length})</h4>
          <ul className="gca-items">
            {pending.map((r) => (
              <li key={r.id} className="gca-item gca-rule-item">
                <div className="gca-item-body">
                  <input
                    className="gca-rule-input"
                    value={edits[r.id] ?? r.rule}
                    onChange={(e) => setEdits((x) => ({ ...x, [r.id]: e.target.value }))}
                    aria-label="Règle proposée"
                  />
                  {r.source && <span className="gca-item-note">D’après « {r.source.length > 140 ? `…${r.source.slice(-140)}` : r.source} »</span>}
                </div>
                <div className="gca-rule-actions">
                  <button type="button" className="btn ghost mini" disabled={busy} onClick={() => void run(() => updateRule(r.id, { status: 'rejected' }))}>
                    Refuser
                  </button>
                  <button
                    type="button"
                    className="btn primary mini"
                    disabled={busy}
                    onClick={() => void run(() => updateRule(r.id, { status: 'active', ...(edits[r.id] && edits[r.id] !== r.rule ? { rule: edits[r.id] } : {}) }))}
                  >
                    Valider
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h4 className="section-label">En service ({active.length})</h4>
        {active.length ? (
          <ul className="gca-items">
            {active.map((r) => (
              <li key={r.id} className="gca-item gca-rule-item">
                <div className="gca-item-body">
                  <span>{r.rule}</span>
                </div>
                <div className="gca-rule-actions">
                  <button type="button" className="btn ghost mini" disabled={busy} onClick={() => void run(() => updateRule(r.id, { status: 'rejected' }))}>
                    Retirer
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="gca-hint">Aucune règle pour l’instant.</p>
        )}
      </section>
      <form
        className="gca-input"
        onSubmit={(e) => {
          e.preventDefault();
          const rule = draft.trim();
          if (rule)
            void run(async () => {
              await addRule(rule);
              setDraft('');
            });
        }}
      >
        <input className="gca-rule-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ajouter une règle, ex. : « chariot » désigne la colonne Frame (FL)." aria-label="Nouvelle règle" />
        <button type="submit" className="btn primary" disabled={busy || !draft.trim()}>
          Ajouter
        </button>
      </form>
    </div>
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
