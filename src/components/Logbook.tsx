import { memo, useCallback, useId, useMemo, useState } from 'react';
import { newId } from '../data/shift';
import { EVENT_TYPES, FLAGS, tintForFlag } from '../data/eventTypes';
import { diffMinutes, fmtDuration, fmtHM } from '../lib/time';
import EventEditor from './EventEditor';
import { sanitizeTestNo, testHasMeasures, type Test } from './ProductionTest';
import { PROCESSES, STAGE_LETTER, stageStatus, type StageStatus, type SuiviEntry } from './Suivi';
import type { EventType, FlagKey, LogEvent, Poste, ShiftMeta } from '../types';

// Order matches the visual order in the filter row; null is implicit when no
// chip is active. Note "normal" is intentionally absent: untagged events are
// caught by the "Sans" pseudo-filter further down.
const FILTER_FLAGS: FlagKey[] = ['ok', 'scheduled', 'unscheduled', 'note'];

const EVENT_TYPE_BY_KEY = new Map<string, EventType>(EVENT_TYPES.map((t) => [t.key, t]));

// Two visual rows of type buttons; `row` on each event type drives placement.
const TYPE_ROWS = [
  EVENT_TYPES.filter((t) => t.row === 1),
  EVENT_TYPES.filter((t) => t.row === 2),
] as const;

export function logbookStorageKey(date: string, poste: Poste | null): string {
  return `wb.logbook.v4.${date}.${poste}`;
}

interface LogbookProps {
  poste: Poste | null;
  shiftMeta: ShiftMeta;
  // State is owned by LogbookPage — the journal shares its shift with the
  // Test section and the attachment sheets, and the sync layer allows only
  // one live hook per partition.
  events: LogEvent[];
  setEvents: (next: LogEvent[] | ((prev: LogEvent[]) => LogEvent[])) => void;
  // The shift's test sheets and the global Cosmétique registry, for the
  // attachment chips on journal lines.
  tests: Test[];
  suiviEntries: SuiviEntry[];
  onOpenTest: (id: string) => void;
  onOpenSuivi: (id: string) => void;
  // The journal is the creator: these gestures write the line AND its sheet.
  onQuickTest: () => void;
  onQuickCosmetique: () => void;
  onCreateTestFromLine: (eventId: string, testNo: string) => void;
  onCreateSuiviFromLine: (eventId: string, serial: string, plateCode: string | null) => void;
  // Removal lives in LogbookPage: a linked line needs the attachment states
  // to ask "et la feuille ?", and the page owns all three.
  onRemoveEvent: (id: string) => void;
  onNavigate?: (date: string, poste: Poste) => void;
}

interface OtherMatch {
  ev: LogEvent;
  date: string;
  poste: Poste;
}

const STORAGE_PREFIX = 'wb.logbook.v4.';

// Scan localStorage for matching events outside the current shift. Used to
// expose log entries from other dates/postes that the operator may be looking
// for — e.g. searching for "#375" finds the plate across every shift.
function searchOtherShifts(
  currentDate: string,
  currentPoste: Poste | null,
  query: string,
  activeFlags: Set<FlagKey>,
): OtherMatch[] {
  if (typeof window === 'undefined') return [];
  if (!query.trim() && activeFlags.size === 0) return [];
  const q = query.trim().toLowerCase();
  const results: OtherMatch[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
    const tail = key.slice(STORAGE_PREFIX.length);
    const dot = tail.lastIndexOf('.');
    if (dot < 0) continue;
    const date = tail.slice(0, dot);
    const poste = tail.slice(dot + 1) as Poste;
    if (date === currentDate && poste === currentPoste) continue;
    let events: LogEvent[];
    try {
      const raw = window.localStorage.getItem(key);
      events = raw ? (JSON.parse(raw) as LogEvent[]) : [];
    } catch {
      continue;
    }
    for (const ev of events) {
      if (activeFlags.size > 0 && (!ev.flag || !activeFlags.has(ev.flag))) continue;
      if (q) {
        const haystack = [ev.desc, ev.type, ...(ev.notes || [])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) continue;
      }
      results.push({ ev, date, poste });
    }
  }
  results.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return a.poste.localeCompare(b.poste);
  });
  return results;
}

function fmtShortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

interface EditingState {
  event: Partial<LogEvent>;
}

// ---------------------------------------------------------------------------
// Attachment chips
//
// In the paper logbook a "#390 Test QC" or a "Cosmétique AJ2219DE" is a line
// of the shift's sheet; the actual measurement sheet and the plate follow-up
// live in their own partitions. The chips are the bridge back: a journal line
// that mentions a number found in this shift's test sheets (or, for lines
// mentioning a cosmetic, in the registry's plates born this date) gets a tap
// target opening that sheet in place.
//
// Resolution is by convention, not by stored reference, so everything already
// imported lights up with zero migration. Test numbers recycle (1..399, and a
// shift holds several tests), which is why number matching is bounded to the
// current partition. Plate codes ("AJ2219DE", "GJ7827DE" — kept in the
// entry's comment) are specific enough to resolve across every date — a
// later shift's "Découpe AJ2219DE" line still gets the plate's chip. In
// every case an ambiguous token — two sheets claiming it — yields no chip
// rather than a wrong one.
// ---------------------------------------------------------------------------

interface AttachChip {
  kind: 'test' | 'suivi';
  id: string;
  label: string;
  // test: whether any measurement has been typed yet.
  filled?: boolean;
  // suivi: the D-T-M-V strip, live from the registry.
  stages?: { letter: string; status: StageStatus }[];
  // The line names a sheet that doesn't exist yet — tapping creates it,
  // prefilled from the line. The journal writing its own consequences.
  create?: { testNo?: string; serial?: string; plateCode?: string | null };
  // Explicit link whose target vanished (deleted from another device).
  missing?: boolean;
}

const MENTION_RE = /#(\d{1,4})\b/g;
// Two letters, digits, two letters — AJ2219DE and GJ7827DE both observed in
// the logbook. Loose on purpose: a token only ever produces a chip when the
// registry holds an entry carrying that exact code, so a stray match costs
// nothing.
const PLATE_CODE_RE = /\b[A-Z]{2}\d{3,5}[A-Z]{2}\b/gi;
// Creation offers are stricter than consultation: only a "#nnn Test QC"
// mention earns a measurement sheet (a Vapo or Acide test has none — hard
// rule of production_tests), and a cosmetic line is read segment by segment
// (desc, then each note) so a multi-mention event can't donate its QC number
// to a plate.
const TESTQC_RE = /#(\d{1,3})\s+Test QC/i;
const COSM_NUM_RE = /#(\d{1,4})\b/;
const PLATE_CODE_ONE = /\b[A-Z]{2}\d{3,5}[A-Z]{2}\b/i;

function testChip(t: Test): AttachChip {
  return {
    kind: 'test',
    id: t.id,
    label: `#${sanitizeTestNo(t.header.testNo)}`,
    filled: testHasMeasures(t),
  };
}

function suiviChip(e: SuiviEntry): AttachChip {
  return {
    kind: 'suivi',
    id: e.id,
    label: `#${e.serial}`,
    stages: PROCESSES.map((p) => ({ letter: STAGE_LETTER[p], status: stageStatus(e.process[p]) })),
  };
}

function chipsForEvents(
  events: LogEvent[],
  tests: Test[],
  suiviEntries: SuiviEntry[],
  date: string,
): Map<string, AttachChip[]> {
  const testsByNo = new Map<string, Test[]>();
  for (const t of tests) {
    const no = sanitizeTestNo(t.header.testNo);
    if (!no) continue;
    const list = testsByNo.get(no) ?? [];
    list.push(t);
    testsByNo.set(no, list);
  }
  // Only plates born on the displayed date: serials share the tests' rolling
  // counter, so an unscoped match would point at another day's plate.
  const entriesBySerial = new Map<string, SuiviEntry[]>();
  const entriesByAj = new Map<string, SuiviEntry[]>();
  for (const e of suiviEntries) {
    for (const m of (e.comment || '').matchAll(PLATE_CODE_RE)) {
      const code = m[0].toUpperCase();
      const list = entriesByAj.get(code) ?? [];
      list.push(e);
      entriesByAj.set(code, list);
    }
    if (e.dateProd !== date) continue;
    const s = (e.serial || '').replace(/^0+/, '');
    if (!s) continue;
    const list = entriesBySerial.get(s) ?? [];
    list.push(e);
    entriesBySerial.set(s, list);
  }
  const result = new Map<string, AttachChip[]>();
  for (const ev of events) {
    const segments = [ev.desc, ...(ev.notes || [])].filter(Boolean) as string[];
    const haystack = segments.join(' ');
    const chips: AttachChip[] = [];
    const seen = new Set<string>();

    // Explicit links first — the journal created these sheets itself. A
    // vanished target (deleted from another device) shows as a greyed chip.
    if (ev.testId) {
      const t = tests.find((x) => x.id === ev.testId);
      if (t) {
        seen.add(`t${t.id}`);
        chips.push(testChip(t));
      } else {
        chips.push({ kind: 'test', id: '', label: '', missing: true });
      }
    }
    if (ev.suiviId) {
      const e = suiviEntries.find((x) => x.id === ev.suiviId);
      if (e) {
        seen.add(`s${e.id}`);
        chips.push(suiviChip(e));
      } else {
        chips.push({ kind: 'suivi', id: '', label: '', missing: true });
      }
    }

    if (!haystack) {
      if (chips.length > 0) result.set(ev.id, chips);
      continue;
    }
    // A plate chip needs the line to actually talk about a cosmetic — a bare
    // "#390 Test QC" must not pick up a plate that happens to share the number.
    const mentionsCosmetic = /cosm/i.test(haystack);
    for (const m of haystack.matchAll(MENTION_RE)) {
      const no = m[1].replace(/^0+/, '');
      if (!no) continue;
      const ts = testsByNo.get(no);
      if (ts?.length === 1 && !seen.has(`t${ts[0].id}`)) {
        seen.add(`t${ts[0].id}`);
        chips.push(testChip(ts[0]));
      }
      if (mentionsCosmetic) {
        const es = entriesBySerial.get(no);
        if (es?.length === 1 && !seen.has(`s${es[0].id}`)) {
          seen.add(`s${es[0].id}`);
          chips.push(suiviChip(es[0]));
        }
      }
    }
    // The code alone is the signal — the paper line "Cosmétique AJ2219DE"
    // carries no "#" mention at all.
    for (const m of haystack.matchAll(PLATE_CODE_RE)) {
      const es = entriesByAj.get(m[0].toUpperCase());
      if (es?.length === 1 && !seen.has(`s${es[0].id}`)) {
        seen.add(`s${es[0].id}`);
        chips.push(suiviChip(es[0]));
      }
    }

    // Ghost chips — the line names a sheet that doesn't exist yet, so offer
    // to create it, prefilled from the line. This is what makes the journal
    // the creator even for imported or hand-typed lines. Segment-scoped so a
    // multi-mention event can't cross-donate a number.
    if (!ev.testId) {
      for (const seg of segments) {
        const qc = seg.match(TESTQC_RE);
        if (!qc) continue;
        const no = qc[1].replace(/^0+/, '');
        if (!no || testsByNo.has(no) || seen.has(`gt${no}`)) continue;
        seen.add(`gt${no}`);
        chips.push({ kind: 'test', id: '', label: `#${no}`, create: { testNo: no } });
      }
    }
    if (!ev.suiviId) {
      for (const seg of segments) {
        if (!/cosm/i.test(seg)) continue;
        const num = seg.match(COSM_NUM_RE);
        if (!num) continue;
        const serial = num[1].replace(/^0+/, '');
        if (!serial || entriesBySerial.has(serial) || seen.has(`gs${serial}`)) continue;
        seen.add(`gs${serial}`);
        const code = seg.match(PLATE_CODE_ONE);
        chips.push({ kind: 'suivi', id: '', label: `#${serial}`, create: { serial, plateCode: code ? code[0].toUpperCase() : null } });
      }
    }
    if (chips.length > 0) result.set(ev.id, chips);
  }
  return result;
}

export default function Logbook({
  poste,
  shiftMeta,
  events,
  setEvents,
  tests,
  suiviEntries,
  onOpenTest,
  onOpenSuivi,
  onQuickTest,
  onQuickCosmetique,
  onCreateTestFromLine,
  onCreateSuiviFromLine,
  onRemoveEvent,
  onNavigate,
}: LogbookProps) {
  const { date } = shiftMeta;
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [showSecondary, setShowSecondary] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeFlags, setActiveFlags] = useState<Set<FlagKey>>(() => new Set());
  const queryInputId = useId();

  const filteredEvents = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((e) => {
      if (activeFlags.size > 0 && (!e.flag || !activeFlags.has(e.flag))) return false;
      if (!q) return true;
      const haystack = [e.desc, e.type, ...(e.notes || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [events, query, activeFlags]);

  const summary = useMemo(() => computeSummary(filteredEvents), [filteredEvents]);
  const filteringActive = query.trim() !== '' || activeFlags.size > 0;
  const hiddenCount = events.length - filteredEvents.length;

  // Cross-shift / cross-date results live alongside the current shift's list
  // so the operator never has to navigate to find a past entry.
  const otherMatches = useMemo(
    () => (filteringActive ? searchOtherShifts(date, poste, query, activeFlags) : []),
    [filteringActive, date, poste, query, activeFlags],
  );

  // Chip map keyed by event id. The inner arrays stay reference-stable while
  // the deps don't change, so the memoized rows keep skipping re-renders.
  const attachChips = useMemo(
    () => chipsForEvents(events, tests, suiviEntries, date),
    [events, tests, suiviEntries, date],
  );

  const openAttachment = useCallback(
    (ev: LogEvent, chip: AttachChip) => {
      if (chip.missing) return;
      if (chip.create) {
        if (chip.kind === 'test' && chip.create.testNo) onCreateTestFromLine(ev.id, chip.create.testNo);
        else if (chip.kind === 'suivi' && chip.create.serial) {
          onCreateSuiviFromLine(ev.id, chip.create.serial, chip.create.plateCode ?? null);
        }
        return;
      }
      if (chip.kind === 'test') onOpenTest(chip.id);
      else onOpenSuivi(chip.id);
    },
    [onOpenTest, onOpenSuivi, onCreateTestFromLine, onCreateSuiviFromLine],
  );

  function toggleFlagFilter(f: FlagKey) {
    setActiveFlags((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }

  function clearFilters() {
    setQuery('');
    setActiveFlags(new Set());
  }

  function openTypedEvent(type: string) {
    const stamp = fmtHM();
    const meta = EVENT_TYPE_BY_KEY.get(type);
    setEditing({
      event: {
        start: stamp,
        end: '',
        type,
        desc: typeof meta?.prefill === 'string' ? meta.prefill : meta?.prefill ? meta.label : '',
        flag: meta?.defaultFlag ?? null,
        notes: meta?.openNote ? [''] : [],
      },
    });
    setFabOpen(false);
  }

  const openEvent = useCallback((ev: LogEvent) => setEditing({ event: ev }), []);

  function saveFromEditor(payload: LogEvent) {
    const now = Date.now();
    const normalized: LogEvent = { ...payload, end: payload.end || payload.start || null };
    setEvents((prev) =>
      normalized.id
        ? prev.map((e) =>
            e.id === normalized.id
              ? { ...e, ...normalized, createdAt: e.createdAt ?? now, updatedAt: now }
              : e,
          )
        : [...prev, { ...normalized, id: newId(), createdAt: now, updatedAt: now }],
    );
    setEditing(null);
  }

  return (
    <div>
      <PrintHeader poste={poste} shiftMeta={shiftMeta} />

      <div className="type-strip no-print">
        <div className="type-row">
          {TYPE_ROWS[0].map((t) => (
            <button
              key={t.key}
              type="button"
              className={t.key === 'Nouveau' ? 'type-add' : ''}
              onClick={() => openTypedEvent(t.key)}
              title={`Enregistrer ${t.label} maintenant`}
            >
              <span className="glyph">＋</span>
              {t.label}
            </button>
          ))}
          {/* The creator gestures: one tap writes the line AND its sheet,
              linked, and opens the sheet. Visually set apart from the plain
              event types — these have consequences beyond the fil. */}
          <button
            type="button"
            className="type-attach"
            onClick={onQuickTest}
            title="Créer la ligne et sa feuille de mesures d'un geste"
          >
            <span className="glyph">＋</span>
            Test QC
          </button>
          <button
            type="button"
            className="type-attach"
            onClick={onQuickCosmetique}
            title="Créer la ligne et sa fiche plaque d'un geste"
          >
            <span className="glyph">＋</span>
            Cosmétique
          </button>
          <button
            type="button"
            className="type-more"
            onClick={() => setShowSecondary((v) => !v)}
            title={showSecondary ? 'Masquer les types secondaires' : 'Afficher les types secondaires'}
            aria-expanded={showSecondary}
            aria-label="Basculer les types secondaires"
          >
            <span className="chevron" aria-hidden="true">⌄</span>
          </button>
        </div>
        {showSecondary && (
          <div className="type-row">
            {TYPE_ROWS[1].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => openTypedEvent(t.key)}
                title={`Enregistrer ${t.label} maintenant`}
              >
                <span className="glyph">＋</span>
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="evt-filterbar no-print" role="search">
        <label htmlFor={queryInputId} className="evt-filterbar-label">
          <span className="evt-filterbar-glyph" aria-hidden="true">⌕</span>
          <input
            id={queryInputId}
            type="search"
            className="evt-filterbar-input"
            placeholder="Rechercher description, notes, type…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="evt-filterbar-flags" role="group" aria-label="Filtrer par catégorie">
          {FILTER_FLAGS.map((f) => {
            const meta = FLAGS[f];
            const on = activeFlags.has(f);
            const cls = ['flag', 'flag-filter', 'flag-active', f];
            if (activeFlags.size > 0) cls.push(on ? 'is-on' : 'is-off');
            return (
              <button
                key={f}
                type="button"
                className={cls.join(' ')}
                onClick={() => toggleFlagFilter(f)}
                aria-pressed={on}
                title={on ? `Retirer le filtre ${meta.label}` : `Filtrer sur ${meta.label}`}
              >
                {meta.label}
              </button>
            );
          })}
          {filteringActive && (
            <button
              type="button"
              className="btn ghost mini evt-filterbar-clear"
              onClick={clearFilters}
            >
              Effacer
            </button>
          )}
        </div>
      </div>

      <div className="evt-list">
        <div className="evt evt-head no-print" aria-hidden="true">
          <div className="time">Heure</div>
          <div className="dur">Durée</div>
          <div className="type-h">Type</div>
          <div className="desc">Description</div>
          <div className="flags-h">Catégorie</div>
        </div>
        {filteredEvents.map((ev) => (
          <EventRow
            key={ev.id}
            ev={ev}
            attachments={attachChips.get(ev.id)}
            onOpen={openEvent}
            onRemove={onRemoveEvent}
            onOpenAttach={openAttachment}
          />
        ))}
        {filteredEvents.length === 0 && events.length === 0 && !filteringActive && (
          <div className="evt-empty no-print">
            <div>Aucun événement pour Poste {poste}.</div>
          </div>
        )}
        {filteredEvents.length === 0 && filteringActive && (
          <div className="evt-empty no-print">
            <div>
              {events.length > 0
                ? 'Aucun résultat dans ce shift.'
                : 'Aucun résultat pour ce shift.'}
            </div>
            {otherMatches.length === 0 && (
              <button type="button" className="btn ghost mini" onClick={clearFilters}>
                Effacer les filtres
              </button>
            )}
          </div>
        )}
        {otherMatches.length > 0 && (
          <div className="evt-other-matches no-print">
            <div className="evt-other-head">
              <span className="evt-other-title">
                <span className="evt-other-icon" aria-hidden="true">⤴</span>
                Autres shifts
              </span>
              <span className="evt-other-count">
                {otherMatches.length} résultat{otherMatches.length > 1 ? 's' : ''}
              </span>
            </div>
            {otherMatches.slice(0, 50).map((m) => (
              <OtherMatchRow
                key={`${m.date}.${m.poste}.${m.ev.id}`}
                match={m}
                onNavigate={onNavigate}
              />
            ))}
            {otherMatches.length > 50 && (
              <div className="evt-other-more faint small">
                + {otherMatches.length - 50} autres — affinez la recherche pour les voir.
              </div>
            )}
          </div>
        )}
        <div className="summary">
          <span><strong>{summary.total}</strong> événements</span>
          <span>planifié <strong>{fmtDuration(summary.scheduledMin)}</strong></span>
          <span>non planifié <strong>{fmtDuration(summary.unscheduledMin)}</strong></span>
          {filteringActive && hiddenCount > 0 && (
            <span className="faint no-print">{hiddenCount} masqué{hiddenCount > 1 ? 's' : ''}</span>
          )}
          <span style={{ marginLeft: 'auto' }} className="no-print">
            <button className="btn ghost" onClick={() => window.print()}>Imprimer</button>
          </span>
        </div>
      </div>

      <PrintSignature poste={poste} />

      <button
        type="button"
        className="fab no-print"
        onClick={() => setFabOpen(true)}
        aria-label="Nouvel événement"
        title="Nouvel événement"
      >
        <span className="fab-glyph" aria-hidden="true">＋</span>
      </button>

      {fabOpen && (
        <FabTypeSheet
          onPick={openTypedEvent}
          onClose={() => setFabOpen(false)}
        />
      )}

      {editing && (
        <EventEditor
          event={editing.event}
          onSave={saveFromEditor}
          onDelete={() => editing.event?.id && onRemoveEvent(editing.event.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface FabTypeSheetProps {
  onPick: (type: string) => void;
  onClose: () => void;
}

function FabTypeSheet({ onPick, onClose }: FabTypeSheetProps) {
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet fab-sheet" role="dialog" aria-modal="true" aria-label="Choisir un type d'événement">
        <div className="grabber" />
        <div className="sheet-head">
          <h3>Nouvel événement</h3>
          <button className="btn ghost icon" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="fab-sheet-grid">
          {EVENT_TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`fab-type-btn ${t.key === 'Nouveau' ? 'is-add' : ''}`}
              onClick={() => onPick(t.key)}
            >
              <span className="glyph" aria-hidden="true">＋</span>
              <span className="fab-type-label">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

interface EventRowProps {
  ev: LogEvent;
  attachments?: AttachChip[];
  onOpen: (ev: LogEvent) => void;
  onRemove: (id: string) => void;
  onOpenAttach: (ev: LogEvent, chip: AttachChip) => void;
}

const EventRow = memo(function EventRow({ ev, attachments, onOpen, onRemove, onOpenAttach }: EventRowProps) {
  const tint = tintForFlag(ev.flag);
  const minutes = diffMinutes(ev.start, ev.end);
  const sameStartEnd = ev.start && ev.end && ev.start === ev.end;
  const notes = (ev.notes || []).filter((n) => n && n.trim());

  const open = () => onOpen(ev);

  return (
    <div
      className={`evt ${tint ? `tint-${tint}` : ''} ${ev.danger ? 'is-danger' : ''}`}
      onClick={open}
      role="button"
      tabIndex={0}
      aria-label={`${ev.start || 'Événement'} ${ev.type} ${ev.desc || ''}`.trim()}
      onKeyDown={(e) => {
        // Only when the row itself is focused: an Enter bubbling up from an
        // attachment chip (or the ✕ button) must activate that control, not
        // hijack it into opening the editor.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
    >
      <div className="time">
        {ev.start ? <span className="start">{ev.start}</span> : <span className="faint">—</span>}
        {ev.end && !sameStartEnd ? <span className="end"> → {ev.end}</span> : null}
      </div>
      <div className="dur">{sameStartEnd ? <span className="faint">·</span> : fmtDuration(minutes)}</div>
      <span className="type">{ev.type}</span>
      <div className="desc">
        <span style={{ fontWeight: ev.bold ? 600 : 400 }}>
          {ev.desc || <span className="faint">(sans description)</span>}
        </span>
        {notes.map((n, i) => (
          <span key={i} className="sub">{n}</span>
        ))}
        {/* Screen-only: paper keeps the plain line, the sheets print from
            their own sections. */}
        {attachments && attachments.length > 0 && (
          <span className="evt-attach-row no-print">
            {attachments.map((a, i) =>
              a.missing ? (
                <span
                  key={`m.${a.kind}.${i}`}
                  className="evt-attach is-missing"
                  title={
                    a.kind === 'test'
                      ? 'Feuille de mesures liée introuvable — supprimée depuis un autre appareil ?'
                      : 'Fiche plaque liée introuvable — supprimée depuis un autre appareil ?'
                  }
                >
                  <span className="evt-attach-label mono">
                    {a.kind === 'test' ? 'feuille ?' : 'plaque ?'}
                  </span>
                </span>
              ) : (
                <button
                  key={a.create ? `c.${a.kind}.${a.label}` : `${a.kind}.${a.id}`}
                  type="button"
                  className={`evt-attach evt-attach-${a.kind}${a.create ? ' evt-attach-create' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenAttach(ev, a);
                  }}
                  title={
                    a.create
                      ? a.kind === 'test'
                        ? `Créer la feuille de mesures ${a.label} depuis cette ligne`
                        : `Créer la fiche plaque ${a.label} depuis cette ligne`
                      : a.kind === 'test'
                        ? `Feuille de mesures ${a.label} — ${a.filled ? 'mesures saisies' : 'feuille vierge'}`
                        : `Suivi plaque ${a.label} — Découpe · Trempe · Montage · Vitrine`
                  }
                >
                  {a.create && <span className="glyph" aria-hidden="true">＋</span>}
                  {a.kind === 'test' && !a.create && (
                    <span className={`evt-attach-dot ${a.filled ? 'is-filled' : ''}`} aria-hidden="true" />
                  )}
                  <span className="evt-attach-label mono">
                    {a.kind === 'test' ? `Test ${a.label}` : a.label}
                  </span>
                  {a.stages && (
                    <span className="sv-stages" aria-hidden="true">
                      {a.stages.map((s) => (
                        <span key={s.letter} className={`sv-stage sv-st-${s.status}`}>{s.letter}</span>
                      ))}
                    </span>
                  )}
                </button>
              ),
            )}
          </span>
        )}
      </div>
      <div className="flags">
        {ev.flag ? (
          <span className={`flag flag-active ${ev.flag}`}>{FLAGS[ev.flag].label}</span>
        ) : (
          <span className="flag flag-empty muted">—</span>
        )}
      </div>
      <div className="row-actions no-print">
        <button
          type="button"
          className="btn ghost icon"
          title="Supprimer l’événement"
          aria-label="Supprimer l’événement"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(ev.id);
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
});

interface OtherMatchRowProps {
  match: OtherMatch;
  onNavigate?: (date: string, poste: Poste) => void;
}

function OtherMatchRow({ match, onNavigate }: OtherMatchRowProps) {
  const { ev, date, poste } = match;
  const tint = tintForFlag(ev.flag);
  const minutes = diffMinutes(ev.start, ev.end);
  const sameStartEnd = ev.start && ev.end && ev.start === ev.end;
  const navigable = !!onNavigate;
  const go = () => onNavigate?.(date, poste);

  return (
    <div
      className={`evt evt-other ${tint ? `tint-${tint}` : ''} ${ev.danger ? 'is-danger' : ''} ${navigable ? 'is-clickable' : ''}`}
      onClick={navigable ? go : undefined}
      role={navigable ? 'button' : undefined}
      tabIndex={navigable ? 0 : undefined}
      aria-label={`Voir ${fmtShortDate(date)} Poste ${poste}`}
      onKeyDown={
        navigable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                go();
              }
            }
          : undefined
      }
    >
      <div className="time">
        {ev.start ? <span className="start">{ev.start}</span> : <span className="faint">—</span>}
        {ev.end && !sameStartEnd ? <span className="end"> → {ev.end}</span> : null}
      </div>
      <div className="dur">{sameStartEnd ? <span className="faint">·</span> : fmtDuration(minutes)}</div>
      <span className="type">{ev.type}</span>
      <div className="desc">
        <span className="evt-other-tag mono">{fmtShortDate(date)} · Poste {poste}</span>
        <span style={{ fontWeight: ev.bold ? 600 : 400 }}>
          {ev.desc || <span className="faint">(sans description)</span>}
        </span>
      </div>
      <div className="flags">
        {ev.flag ? (
          <span className={`flag flag-active ${ev.flag}`}>{FLAGS[ev.flag].label}</span>
        ) : (
          <span className="flag flag-empty muted">—</span>
        )}
      </div>
    </div>
  );
}

interface PrintHeaderProps {
  poste: Poste | null;
  shiftMeta: ShiftMeta;
}

function PrintHeader({ poste, shiftMeta }: PrintHeaderProps) {
  return (
    <div className="print-header print-only">
      <h1>Logbook · Poste {poste} · {shiftMeta.shift.label}</h1>
      <div className="meta">
        <span><strong>Date:</strong> {shiftMeta.dateLabel}</span>
        <span><strong>Horaires:</strong> {shiftMeta.shift.hours}</span>
        <span><strong>Opérateur:</strong> ____________________</span>
      </div>
    </div>
  );
}

function PrintSignature({ poste }: { poste: Poste | null }) {
  return (
    <div className="print-signature print-only">
      <div className="sig-row">
        <div>
          <div className="sig-line" />
          <div className="sig-label">Signature opérateur · Poste {poste}</div>
        </div>
        <div>
          <div className="sig-line" />
          <div className="sig-label">Visa chef d'équipe</div>
        </div>
      </div>
    </div>
  );
}

interface SummaryResult {
  total: number;
  scheduledMin: number;
  unscheduledMin: number;
}

function computeSummary(events: LogEvent[]): SummaryResult {
  let scheduledMin = 0;
  let unscheduledMin = 0;
  for (const e of events) {
    const m = diffMinutes(e.start, e.end);
    if (m == null || m === 0) continue;
    if (e.flag === 'scheduled') scheduledMin += m;
    if (e.flag === 'unscheduled') unscheduledMin += m;
  }
  return { total: events.length, scheduledMin, unscheduledMin };
}
