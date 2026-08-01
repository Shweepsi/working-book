import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeToClose } from '../lib/hooks';
import { load, save } from '../lib/storage';
import { useSyncedState } from '../lib/sync';
import { useToast } from '../lib/toast';

// Boîte à idées — shared improvement board reachable from the header on every
// tab. Two rules drive the whole design:
//   · nommées — an idea carries the name of whoever proposed it, and so does
//     every +1. Nothing authenticates here (the whole API is open), so the
//     typed name is the identity: it is remembered locally and reused.
//   · +1 — support is a single toggle per operator per idea. The count is what
//     ranks the board, so it has to mean "how many colleagues back this",
//     which is why an author cannot +1 their own idea.
// The board is one JSON blob in the `ideas` partition, last-write-wins like
// every other partition. Two +1s cast inside the same poll window can cost one
// of them; the board is low-traffic enough that the alternative — a merge
// endpoint of its own — would buy very little.

const STORAGE_KEY = 'wb.ideas.v1';
// The operator's name. Not part of the board: it is this device's identity,
// used to sign what gets posted from here.
const AUTHOR_KEY = 'wb.ideas.author.v1';
// `createdAt` of the newest idea this device has seen, so the header can show a
// dot when a colleague posts something.
const SEEN_KEY = 'wb.ideas.seen.v1';

const MAX_AUTHOR = 40;
const MAX_TITLE = 120;
const MAX_DETAIL = 1000;
// Past this many names the supporters line is summarised — the full list stays
// in its tooltip.
const SUPPORTERS_SHOWN = 5;

interface IdeaVote {
  name: string;
  at: number;
}

interface Idea {
  id: string;
  title: string;
  detail: string;
  author: string;
  createdAt: number;
  updatedAt?: number;
  votes: IdeaVote[];
}

interface IdeasState {
  ideas: Idea[];
}

type SortKey = 'top' | 'recent';

function newId(): string {
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// Display form of a name: trimmed, single-spaced, bounded.
function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_AUTHOR);
}

// Identity key. Two spellings are the same operator once case and accents are
// set aside — "Loïc" and "loic" have to collapse, or the same person could +1
// twice from two devices.
function nameKey(raw: string): string {
  return cleanName(raw)
    .toLocaleLowerCase('fr')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

// Entries written by an older version — or by a client mid-deploy — may be
// missing the array. Reading through this keeps every caller from guarding.
function votesOf(idea: Idea): IdeaVote[] {
  return Array.isArray(idea.votes) ? idea.votes : [];
}

function hasVoted(idea: Idea, key: string): boolean {
  return key !== '' && votesOf(idea).some((v) => nameKey(v.name) === key);
}

function initialState(): IdeasState {
  const persisted = load<IdeasState | null>(STORAGE_KEY, null);
  if (persisted && Array.isArray(persisted.ideas)) return persisted;
  return { ideas: [] };
}

function fmtWhen(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' });
}

export default function Ideas() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useSyncedState<IdeasState>(
    STORAGE_KEY,
    { domain: 'ideas', params: {} },
    initialState,
    // One board for the whole line: an idea posted from the tablet has to reach
    // the planning room without a reload, and so does a +1.
    { live: true },
  );
  const [author, setAuthor] = useState<string>(() => cleanName(load<string>(AUTHOR_KEY, '')));
  const [seenAt, setSeenAt] = useState<number>(() => load<number>(SEEN_KEY, 0));
  const toast = useToast();

  useEffect(() => { save(AUTHOR_KEY, cleanName(author)); }, [author]);
  useEffect(() => { save(SEEN_KEY, seenAt); }, [seenAt]);

  const meKey = nameKey(author);
  const ideas = state.ideas;

  // Everything on screen counts as seen — including whatever lands while the
  // sheet is open. The mark is the newest `createdAt` we can actually see
  // rather than `Date.now()`: the timestamps come from other operators' clocks,
  // and comparing them against ours would flag or hide ideas by clock drift.
  useEffect(() => {
    if (!open) return;
    const newest = ideas.reduce((m, i) => Math.max(m, i.createdAt ?? 0), 0);
    setSeenAt((prev) => (newest > prev ? newest : prev));
  }, [open, ideas]);

  const unseen = useMemo(
    () => ideas.filter((i) => (i.createdAt ?? 0) > seenAt && nameKey(i.author) !== meKey).length,
    [ideas, seenAt, meKey],
  );

  function addIdea(title: string, detail: string) {
    const who = cleanName(author);
    if (!who || !title) return;
    const now = Date.now();
    const idea: Idea = {
      id: newId(),
      title,
      detail,
      author: who,
      createdAt: now,
      updatedAt: now,
      votes: [],
    };
    setState((s) => ({ ...s, ideas: [...s.ideas, idea] }));
    // The board is shared, so the confirmation is worth showing: the operator
    // has no other cue that their idea left the device.
    toast.show({ message: 'Idée proposée — vos collègues peuvent la soutenir' });
  }

  function updateIdea(id: string, title: string, detail: string) {
    if (!title) return;
    setState((s) => ({
      ...s,
      ideas: s.ideas.map((i) => (i.id === id ? { ...i, title, detail, updatedAt: Date.now() } : i)),
    }));
  }

  function deleteIdea(id: string) {
    let removed: Idea | undefined;
    let removedIndex = -1;
    setState((s) => {
      removedIndex = s.ideas.findIndex((i) => i.id === id);
      if (removedIndex < 0) return s;
      removed = s.ideas[removedIndex];
      return { ...s, ideas: s.ideas.filter((i) => i.id !== id) };
    });
    if (!removed) return;
    const restored = removed;
    const insertAt = removedIndex;
    toast.show({
      message: 'Idée supprimée',
      undo: () => {
        setState((s) => {
          if (s.ideas.some((i) => i.id === restored.id)) return s;
          const next = [...s.ideas];
          next.splice(Math.min(insertAt, next.length), 0, restored);
          return { ...s, ideas: next };
        });
      },
    });
  }

  function toggleVote(id: string) {
    const who = cleanName(author);
    if (!who) return;
    const key = nameKey(who);
    const now = Date.now();
    setState((s) => ({
      ...s,
      ideas: s.ideas.map((i) => {
        if (i.id !== id) return i;
        const votes = votesOf(i);
        return {
          ...i,
          votes: hasVoted(i, key)
            ? votes.filter((v) => nameKey(v.name) !== key)
            : [...votes, { name: who, at: now }],
        };
      }),
    }));
  }

  return (
    <>
      <button
        type="button"
        className={`btn ghost icon ideas-trigger ${open ? 'is-on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={unseen > 0 ? `Idées d’amélioration — ${unseen} nouvelle${unseen > 1 ? 's' : ''}` : 'Idées d’amélioration'}
        title="Idées d’amélioration — proposer, soutenir (+1)"
      >
        <span className="ideas-icon" aria-hidden="true" />
        {unseen > 0 && <span className="ideas-dot" aria-hidden="true" />}
      </button>

      {open && (
        <IdeasSheet
          ideas={ideas}
          author={author}
          meKey={meKey}
          onAuthorChange={setAuthor}
          onAdd={addIdea}
          onUpdate={updateIdea}
          onDelete={deleteIdea}
          onVote={toggleVote}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

interface SheetProps {
  ideas: Idea[];
  author: string;
  meKey: string;
  onAuthorChange: (v: string) => void;
  onAdd: (title: string, detail: string) => void;
  onUpdate: (id: string, title: string, detail: string) => void;
  onDelete: (id: string) => void;
  onVote: (id: string) => void;
  onClose: () => void;
}

function IdeasSheet({
  ideas,
  author,
  meKey,
  onAuthorChange,
  onAdd,
  onUpdate,
  onDelete,
  onVote,
  onClose,
}: SheetProps) {
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('top');
  const authorRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEscapeToClose(onClose);

  // Nobody types their name twice: once it is known the caret goes straight to
  // the idea itself.
  useEffect(() => {
    if (meKey) titleRef.current?.focus();
    else authorRef.current?.focus();
  }, []);

  const sorted = useMemo(() => {
    const list = [...ideas];
    if (sort === 'top') {
      list.sort(
        (a, b) => votesOf(b).length - votesOf(a).length || (b.createdAt ?? 0) - (a.createdAt ?? 0),
      );
    } else {
      list.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    }
    return list;
  }, [ideas, sort]);

  const totalVotes = useMemo(() => ideas.reduce((n, i) => n + votesOf(i).length, 0), [ideas]);

  const cleanTitle = title.trim();
  const canSubmit = cleanName(author).length > 0 && cleanTitle.length > 0;

  function resetForm() {
    setTitle('');
    setDetail('');
    setEditingId(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const body = detail.trim();
    if (editingId) onUpdate(editingId, cleanTitle, body);
    else onAdd(cleanTitle, body);
    resetForm();
  }

  function startEdit(idea: Idea) {
    setEditingId(idea.id);
    setTitle(idea.title);
    setDetail(idea.detail);
    titleRef.current?.focus();
  }

  function handleVote(idea: Idea) {
    if (!meKey) {
      toast.show({ message: 'Indiquez votre nom pour soutenir une idée' });
      authorRef.current?.focus();
      return;
    }
    onVote(idea.id);
  }

  function handleDelete(idea: Idea) {
    if (editingId === idea.id) resetForm();
    onDelete(idea.id);
  }

  // Portalled out of the header. `.app-header` carries a backdrop-filter, and
  // that makes it the containing block for any fixed-position descendant — the
  // sheet would be centered on the header strip instead of the viewport, and
  // its backdrop would only cover the header.
  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div
        className="sheet ideas-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Idées d’amélioration"
      >
        <div className="grabber" />
        <div className="sheet-head">
          <div className="sheet-head-titles">
            <h3>Idées d’amélioration</h3>
            <span className="sheet-head-sub">
              {ideas.length === 0
                ? 'Le tableau est vide — lancez-le'
                : `${ideas.length} idée${ideas.length > 1 ? 's' : ''} · ${totalVotes} +1`}
            </span>
          </div>
          <button className="btn ghost icon" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>

        <form className="ideas-form" onSubmit={handleSubmit}>
          <div className="ideas-form-grid">
            <label className="ideas-field ideas-field-author">
              <span className="field-label">Votre nom</span>
              <input
                ref={authorRef}
                value={author}
                onChange={(e) => onAuthorChange(e.target.value)}
                placeholder="Prénom"
                maxLength={MAX_AUTHOR}
                autoComplete="name"
                spellCheck={false}
              />
            </label>
            <label className="ideas-field ideas-field-title">
              <span className="field-label">{editingId ? 'Modifier l’idée' : 'L’idée'}</span>
              <input
                ref={titleRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ce qu’on pourrait améliorer, en une ligne"
                maxLength={MAX_TITLE}
              />
            </label>
          </div>
          <textarea
            className="ideas-detail-input"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="Détail, contexte, gain attendu… (facultatif)"
            maxLength={MAX_DETAIL}
            rows={2}
          />
          <div className="ideas-form-actions">
            <span className="ideas-form-hint">
              Les idées sont signées : votre nom apparaît sur le tableau et sur vos +1.
            </span>
            {editingId && (
              <button type="button" className="btn ghost mini ideas-cancel" onClick={resetForm}>
                Annuler
              </button>
            )}
            <button type="submit" className="btn primary" disabled={!canSubmit}>
              {editingId ? 'Enregistrer' : 'Proposer'}
            </button>
          </div>
        </form>

        {ideas.length > 1 && (
          <div className="seg ideas-sort" role="group" aria-label="Trier les idées">
            <button
              type="button"
              className={sort === 'top' ? 'active' : ''}
              onClick={() => setSort('top')}
              aria-pressed={sort === 'top'}
            >
              Les plus soutenues
            </button>
            <button
              type="button"
              className={sort === 'recent' ? 'active' : ''}
              onClick={() => setSort('recent')}
              aria-pressed={sort === 'recent'}
            >
              Récentes
            </button>
          </div>
        )}

        {ideas.length === 0 ? (
          <div className="ideas-empty">
            <h4>Aucune idée pour l’instant</h4>
            <p>
              Une manip qui fait perdre du temps, un réglage à revoir, un outil qui manque —
              proposez-la ci-dessus. Les collègues la soutiennent d’un +1.
            </p>
          </div>
        ) : (
          <ul className="ideas-list">
            {sorted.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                meKey={meKey}
                isEditing={editingId === idea.id}
                onVote={() => handleVote(idea)}
                onEdit={() => startEdit(idea)}
                onDelete={() => handleDelete(idea)}
              />
            ))}
          </ul>
        )}
      </div>
    </>,
    document.body,
  );
}

interface CardProps {
  idea: Idea;
  meKey: string;
  isEditing: boolean;
  onVote: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function IdeaCard({ idea, meKey, isEditing, onVote, onEdit, onDelete }: CardProps) {
  const votes = votesOf(idea);
  const mine = meKey !== '' && nameKey(idea.author) === meKey;
  const voted = hasVoted(idea, meKey);
  const supporters = votes.map((v) => v.name);
  const shown = supporters.slice(0, SUPPORTERS_SHOWN).join(', ');
  const extra = supporters.length - SUPPORTERS_SHOWN;
  const edited = !!idea.updatedAt && idea.updatedAt - (idea.createdAt ?? 0) > 60_000;

  let voteTitle: string;
  if (mine) voteTitle = 'Votre idée — les +1 viennent de vos collègues';
  else if (voted) voteTitle = 'Retirer votre +1';
  else voteTitle = 'Soutenir cette idée';

  return (
    <li className={`idea ${mine ? 'is-mine' : ''} ${isEditing ? 'is-editing' : ''}`}>
      <button
        type="button"
        className={`idea-vote ${voted ? 'is-on' : ''}`}
        onClick={onVote}
        disabled={mine}
        aria-pressed={voted}
        aria-label={`${voteTitle} · ${votes.length} +1`}
        title={voteTitle}
      >
        <span className="idea-vote-count mono">{votes.length}</span>
        <span className="idea-vote-label">+1</span>
      </button>

      <div className="idea-body">
        <div className="idea-title">{idea.title}</div>
        {idea.detail && <p className="idea-detail">{idea.detail}</p>}
        <div className="idea-meta">
          <span className="idea-author">{idea.author || 'Anonyme'}</span>
          {mine && <span className="idea-badge">vous</span>}
          <span className="idea-sep" aria-hidden="true">·</span>
          <span className="faint">{fmtWhen(idea.createdAt)}</span>
          {edited && <span className="faint idea-edited">· modifiée</span>}
          {mine && (
            <span className="idea-actions">
              <button type="button" className="btn ghost mini" onClick={onEdit}>
                Modifier
              </button>
              <button type="button" className="btn ghost mini idea-delete" onClick={onDelete}>
                Supprimer
              </button>
            </span>
          )}
        </div>
        {supporters.length > 0 && (
          <div className="idea-supporters" title={supporters.join(', ')}>
            Soutenue par {shown}
            {extra > 0 && ` +${extra}`}
          </div>
        )}
      </div>
    </li>
  );
}
