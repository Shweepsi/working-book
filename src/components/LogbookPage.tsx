import { useCallback, useEffect, useState } from 'react';
import { newId } from '../data/shift';
import { useEscapeToClose } from '../lib/hooks';
import { load, save } from '../lib/storage';
import { useSyncedState } from '../lib/sync';
import { fmtHM } from '../lib/time';
import { useToast } from '../lib/toast';
import Logbook, { logbookStorageKey } from './Logbook';
import {
  emptyTest,
  initialProdTestState,
  patchTestById,
  prodTestStorageKey,
  ProductionTestView,
  sanitizeTestNo,
  type Test,
  type TestState,
} from './ProductionTest';
import {
  deleteSuiviEntryById,
  emptyEntry,
  initialSuiviState,
  patchSuiviEntryById,
  SUIVI_STORAGE_KEY,
  SuiviSheet,
  SuiviView,
  type SuiviEntry,
  type SuiviState,
} from './Suivi';
import TestSheet from './TestSheet';
import type { LogEvent, Poste, ShiftMeta } from '../types';

// The shift's whole paperwork in one page, with the journal as the CREATOR.
// In the paper logbook a "#390 Test QC" or a "Cosmétique AJ2219DE" is a line
// of the shift's sheet, and everything else follows from that line. Here the
// same holds: the type strip's "Test QC" / "Cosmétique" gestures write the
// line AND its sheet in one tap, a line that names a sheet that doesn't exist
// offers to create it (ghost chip), and the created sheets open in place as
// bottom sheets. The Test and Cosmétique sections remain as full-width views
// of what the journal created.
//
// This wrapper owns all three synced states, and the sections and sheets
// receive them as props. That single-owner shape is load-bearing: the sync
// layer tolerates only one live hook per partition (see selfWrites in
// lib/sync.ts — a twin hook on the same key never refetches and can clobber
// the other's writes). It also keeps the Cosmétique registry, a global
// singleton, outside the date/shift remount boundary: the keys live on the
// shift-scoped children, so the ←/→ arrows never re-fetch the registry.
//
// Printing keeps working by construction: the mounted section is the only one
// contributing print-only markup (the attachment sheets are .sheet overlays,
// hidden on paper), so one section = one A4 sheet, same sheets as the old
// tabs produced. Those standalone tabs stay available on the dev channel
// while this page proves itself — never mounted at the same time as this
// page, so their own hooks don't conflict with the hoisted ones.

type Section = 'journal' | 'test' | 'suivi';

const SECTIONS: readonly { key: Section; label: string }[] = [
  { key: 'journal', label: 'Journal' },
  { key: 'test', label: 'Test' },
  { key: 'suivi', label: 'Cosmétique' },
];

// Persisted so an operator living in one section (the QC bench on Test, the
// downstream colleague on Cosmétique) doesn't re-pick it every visit.
const SECTION_KEY = 'wb.logbook.section';

function isSection(value: string | null): value is Section {
  return SECTIONS.some((s) => s.key === value);
}

// Which attachment sheet is open above the journal.
interface AttachOpen {
  kind: 'test' | 'suivi';
  id: string;
}

// "06:15" (journal) → "06h15", the shape the import tooling writes in plate
// comments. The test sheet's hour field keeps the journal's own "06:15" —
// that's what the app natively produces (emptyTest) and nothing parses it.
function importHour(start: string | null | undefined): string | undefined {
  return start ? start.replace(':', 'h') : undefined;
}

interface LogbookPageProps {
  poste: Poste | null;
  shiftMeta: ShiftMeta;
  onNavigate?: (date: string, poste: Poste) => void;
}

export default function LogbookPage({ poste, shiftMeta, onNavigate }: LogbookPageProps) {
  const { date, shift } = shiftMeta;
  const shiftKey = shift.key;

  const [section, setSection] = useState<Section>(() => {
    const persisted = load<string | null>(SECTION_KEY, null);
    return isSection(persisted) ? persisted : 'journal';
  });
  useEffect(() => { save(SECTION_KEY, section); }, [section]);

  const lbKey = logbookStorageKey(date, poste);
  const lbInit = useCallback(() => load<LogEvent[]>(lbKey, []), [lbKey]);
  const [events, setEvents] = useSyncedState<LogEvent[]>(
    lbKey,
    poste ? { domain: 'logbook', params: { date, poste } } : null,
    lbInit,
    // The shift's log is written from whichever device is at hand — the office
    // PC and the tablet on the line both open the same date and poste.
    { live: true },
  );

  const ptKey = prodTestStorageKey(date, shiftKey);
  const ptInit = useCallback(
    () => initialProdTestState(date, shiftKey, poste),
    [date, shiftKey, poste],
  );
  const [testState, setTestState] = useSyncedState<TestState>(
    ptKey,
    { domain: 'prodtest', params: { date, shift: shiftKey } },
    ptInit,
    // One test sheet per shift, filled from wherever the measurements are taken.
    { live: true },
  );

  const [suiviState, setSuiviState] = useSyncedState<SuiviState>(
    SUIVI_STORAGE_KEY,
    { domain: 'suivi', params: {} },
    initialSuiviState,
    // A single shared list with more than one writer on the line — another
    // operator keeps plate follow-ups here — so it has to stay live.
    { live: true },
  );

  const [attachOpen, setAttachOpen] = useState<AttachOpen | null>(null);
  // A linked line whose deletion is awaiting the "et la feuille ?" answer.
  const [confirmRemove, setConfirmRemove] = useState<LogEvent | null>(null);
  const toast = useToast();

  // An open sheet belongs to the shift and section it was opened from: a date
  // or section change would leave it floating over content it no longer talks
  // about (and two mounted TestFields would fight over Enter navigation).
  useEffect(() => {
    setAttachOpen(null);
    setConfirmRemove(null);
  }, [date, shiftKey, section]);

  // Keep a default-shaped desc in step with the number typed in its sheet.
  // The desc is what the cross-shift search scans and what the printed line
  // carries, so "Test QC" grows into "Test QC #390" as soon as the number is
  // known. A desc the operator has reworded is never touched.
  useEffect(() => {
    const updates: Array<{ id: string; desc: string }> = [];
    for (const ev of events) {
      if (ev.testId) {
        const t = testState.tests.find((x) => x.id === ev.testId);
        const no = t ? sanitizeTestNo(t.header.testNo) : '';
        if (no && /^Test QC( #\d+)?$/.test(ev.desc) && ev.desc !== `Test QC #${no}`) {
          updates.push({ id: ev.id, desc: `Test QC #${no}` });
        }
      }
      if (ev.suiviId) {
        const e = suiviState.entries.find((x) => x.id === ev.suiviId);
        const serial = e?.serial.trim() ?? '';
        if (serial && /^Cosmétique( #\d+)?$/.test(ev.desc) && ev.desc !== `Cosmétique #${serial}`) {
          updates.push({ id: ev.id, desc: `Cosmétique #${serial}` });
        }
      }
    }
    if (updates.length === 0) return;
    const now = Date.now();
    setEvents((prev) =>
      prev.map((e) => {
        const u = updates.find((x) => x.id === e.id);
        return u ? { ...e, desc: u.desc, updatedAt: now } : e;
      }),
    );
  }, [events, testState.tests, suiviState.entries, setEvents]);

  const openTest: Test | null =
    attachOpen?.kind === 'test'
      ? testState.tests.find((t) => t.id === attachOpen.id) ?? null
      : null;
  const openSuivi: SuiviEntry | null =
    attachOpen?.kind === 'suivi'
      ? suiviState.entries.find((e) => e.id === attachOpen.id) ?? null
      : null;

  // The one guaranteed data-loss shape under last-write-wins: enqueueing a
  // full blob from a device that has never seen the partition while offline —
  // the queued copy would erase everything on flush. Block creation there;
  // everywhere else the mount pull has already seeded the local copy.
  function guardColdWrite(cacheKey: string, what: string): boolean {
    if (
      typeof navigator !== 'undefined' &&
      navigator.onLine === false &&
      load<unknown>(cacheKey, null) === null
    ) {
      toast.show({
        message: `Hors ligne et ${what} jamais chargé sur cet appareil — création refusée pour ne rien écraser.`,
        variant: 'danger',
      });
      return false;
    }
    return true;
  }

  function seedTest(init: { testNo?: string; hour?: string }): Test {
    const t = emptyTest();
    // The sheet belongs to the shift being viewed, not to the wall clock —
    // after midnight the night shift's date is yesterday's.
    t.header.date = date;
    if (init.hour) t.header.hour = init.hour;
    if (init.testNo) t.header.testNo = init.testNo;
    return t;
  }

  function seedSuivi(init: { serial: string; comment?: string }): SuiviEntry {
    const e = emptyEntry(init.serial);
    e.dateProd = date;
    e.tag = 'Production';
    e.testType = 'Cosmétique';
    if (init.comment) e.comment = init.comment;
    return e;
  }

  // --- The creator gestures -------------------------------------------------
  // Ids are minted here, outside any state updater, then both partitions are
  // written and the sheet opens. Undo removes both sides.

  function quickTest() {
    if (!guardColdWrite(ptKey, 'le shift')) return;
    const t = seedTest({});
    const evId = newId();
    const stamp = fmtHM();
    const now = Date.now();
    setEvents((prev) => [
      ...prev,
      { id: evId, start: stamp, end: stamp, type: 'Qualité', desc: 'Test QC', flag: 'normal', notes: [], testId: t.id, createdAt: now, updatedAt: now },
    ]);
    setTestState((s) => ({ tests: [...s.tests, t], activeId: t.id }));
    setAttachOpen({ kind: 'test', id: t.id });
    toast.show({
      message: 'Ligne + feuille de test créées',
      undo: () => {
        setEvents((prev) => prev.filter((e) => e.id !== evId));
        setTestState((s) => ({
          tests: s.tests.filter((x) => x.id !== t.id),
          activeId: s.activeId === t.id ? '' : s.activeId,
        }));
        setAttachOpen(null);
      },
    });
  }

  function quickCosmetique() {
    if (!guardColdWrite(SUIVI_STORAGE_KEY, 'le registre Cosmétique')) return;
    const entry = seedSuivi({ serial: '' });
    const evId = newId();
    const stamp = fmtHM();
    const now = Date.now();
    setEvents((prev) => [
      ...prev,
      { id: evId, start: stamp, end: stamp, type: 'Qualité', desc: 'Cosmétique', flag: 'normal', notes: [], suiviId: entry.id, createdAt: now, updatedAt: now },
    ]);
    setSuiviState((s) => ({ ...s, entries: [...s.entries, entry] }));
    setAttachOpen({ kind: 'suivi', id: entry.id });
    toast.show({
      message: 'Ligne + fiche plaque créées',
      undo: () => {
        setEvents((prev) => prev.filter((e) => e.id !== evId));
        setSuiviState((s) => ({ ...s, entries: s.entries.filter((x) => x.id !== entry.id) }));
        setAttachOpen(null);
      },
    });
  }

  function createTestFromLine(eventId: string, testNo: string) {
    if (!guardColdWrite(ptKey, 'le shift')) return;
    const src = events.find((e) => e.id === eventId);
    if (!src) return;
    const t = seedTest({ testNo, hour: src.start ?? undefined });
    const now = Date.now();
    setTestState((s) => ({ tests: [...s.tests, t], activeId: t.id }));
    setEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, testId: t.id, updatedAt: now } : e)));
    setAttachOpen({ kind: 'test', id: t.id });
    toast.show({
      message: `Feuille de test #${testNo} créée depuis la ligne`,
      undo: () => {
        setTestState((s) => ({
          tests: s.tests.filter((x) => x.id !== t.id),
          activeId: s.activeId === t.id ? '' : s.activeId,
        }));
        setEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, testId: undefined } : e)));
        setAttachOpen(null);
      },
    });
  }

  function createSuiviFromLine(eventId: string, serial: string, plateCode: string | null) {
    if (!guardColdWrite(SUIVI_STORAGE_KEY, 'le registre Cosmétique')) return;
    const src = events.find((e) => e.id === eventId);
    if (!src) return;
    // Same comment shape as the import tooling writes: the plate code, then
    // the line's context in parentheses.
    const context = [src.desc, importHour(src.start), poste ? `poste ${poste}` : null]
      .filter(Boolean)
      .join(', ');
    const entry = seedSuivi({
      serial,
      comment: plateCode ? `${plateCode}${context ? ` (${context})` : ''}` : '',
    });
    const now = Date.now();
    setSuiviState((s) => ({ ...s, entries: [...s.entries, entry] }));
    setEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, suiviId: entry.id, updatedAt: now } : e)));
    setAttachOpen({ kind: 'suivi', id: entry.id });
    toast.show({
      message: `Fiche plaque #${serial} créée depuis la ligne`,
      undo: () => {
        setSuiviState((s) => ({ ...s, entries: s.entries.filter((x) => x.id !== entry.id) }));
        setEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, suiviId: undefined } : e)));
        setAttachOpen(null);
      },
    });
  }

  // --- Removal --------------------------------------------------------------

  function removeEventOnly(ev: LogEvent) {
    let removedIndex = -1;
    setEvents((prev) => {
      removedIndex = prev.findIndex((e) => e.id === ev.id);
      return removedIndex < 0 ? prev : prev.filter((e) => e.id !== ev.id);
    });
    if (removedIndex < 0) return;
    const insertAt = removedIndex;
    toast.show({
      message: 'Événement supprimé',
      undo: () => {
        setEvents((prev) => {
          if (prev.some((e) => e.id === ev.id)) return prev;
          const next = [...prev];
          next.splice(Math.min(insertAt, next.length), 0, ev);
          return next;
        });
      },
    });
  }

  function removeEventAndSheets(ev: LogEvent) {
    const test = ev.testId ? testState.tests.find((t) => t.id === ev.testId) : undefined;
    const entry = ev.suiviId ? suiviState.entries.find((e) => e.id === ev.suiviId) : undefined;
    let removedIndex = -1;
    setEvents((prev) => {
      removedIndex = prev.findIndex((e) => e.id === ev.id);
      return removedIndex < 0 ? prev : prev.filter((e) => e.id !== ev.id);
    });
    if (test) {
      setTestState((s) => {
        const idx = s.tests.findIndex((t) => t.id === test.id);
        const next = s.tests.filter((t) => t.id !== test.id);
        const fallback = next[Math.min(Math.max(idx, 0), next.length - 1)]?.id ?? '';
        return { tests: next, activeId: s.activeId === test.id ? fallback : s.activeId };
      });
    }
    if (entry) setSuiviState((s) => ({ ...s, entries: s.entries.filter((e) => e.id !== entry.id) }));
    setAttachOpen(null);
    const insertAt = Math.max(removedIndex, 0);
    toast.show({
      message: 'Ligne et feuille supprimées',
      undo: () => {
        setEvents((prev) => {
          if (prev.some((e) => e.id === ev.id)) return prev;
          const next = [...prev];
          next.splice(Math.min(insertAt, next.length), 0, ev);
          return next;
        });
        if (test) {
          setTestState((s) =>
            s.tests.some((t) => t.id === test.id) ? s : { tests: [...s.tests, test], activeId: test.id },
          );
        }
        if (entry) {
          setSuiviState((s) =>
            s.entries.some((e) => e.id === entry.id) ? s : { ...s, entries: [...s.entries, entry] },
          );
        }
      },
    });
  }

  // A line that created a sheet doesn't disappear silently: Loïc's rule is
  // "demander". Lines without a living link keep the one-tap delete + undo.
  function removeEvent(id: string) {
    const ev = events.find((e) => e.id === id);
    if (!ev) return;
    const hasLiveTest = !!ev.testId && testState.tests.some((t) => t.id === ev.testId);
    const hasLiveSuivi = !!ev.suiviId && suiviState.entries.some((e) => e.id === ev.suiviId);
    if (hasLiveTest || hasLiveSuivi) setConfirmRemove(ev);
    else removeEventOnly(ev);
  }

  function deleteSuiviEntry(id: string) {
    deleteSuiviEntryById(setSuiviState, toast, id);
    setAttachOpen(null);
  }

  const linkedTest = confirmRemove?.testId
    ? testState.tests.find((t) => t.id === confirmRemove.testId)
    : undefined;
  const linkedEntry = confirmRemove?.suiviId
    ? suiviState.entries.find((e) => e.id === confirmRemove.suiviId)
    : undefined;

  return (
    <div className="lbp">
      <div className="lbp-sections seg no-print" role="tablist" aria-label="Sections du logbook">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={section === s.key}
            className={section === s.key ? 'active' : ''}
            onClick={() => setSection(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* The header's date and shift steer Journal and Test; the Cosmétique
          registry is one shared list across every date, so say so rather than
          letting the header imply a scope it doesn't have. */}
      {section === 'suivi' && (
        <div className="lbp-scope-note no-print">
          Registre global — indépendant de la date et du shift affichés.
        </div>
      )}

      {/* The remount keys sit here, on the shift-scoped sections only — they
          reset per-shift UI state (filters, open editor) while the data hooks
          above follow the date on their own. */}
      {section === 'journal' && (
        <Logbook
          key={`lb-${date}-${shiftKey}`}
          poste={poste}
          shiftMeta={shiftMeta}
          events={events}
          setEvents={setEvents}
          tests={testState.tests}
          suiviEntries={suiviState.entries}
          onOpenTest={(id) => setAttachOpen({ kind: 'test', id })}
          onOpenSuivi={(id) => setAttachOpen({ kind: 'suivi', id })}
          onQuickTest={quickTest}
          onQuickCosmetique={quickCosmetique}
          onCreateTestFromLine={createTestFromLine}
          onCreateSuiviFromLine={createSuiviFromLine}
          onRemoveEvent={removeEvent}
          onNavigate={onNavigate}
        />
      )}
      {section === 'test' && (
        <ProductionTestView
          key={`pt-${date}-${shiftKey}`}
          poste={poste}
          shiftMeta={shiftMeta}
          state={testState}
          setState={setTestState}
        />
      )}
      {section === 'suivi' && <SuiviView state={suiviState} setState={setSuiviState} />}

      {openTest && (
        <TestSheet
          test={openTest}
          onPatch={(u) => patchTestById(setTestState, openTest.id, u)}
          onClose={() => setAttachOpen(null)}
        />
      )}
      {openSuivi && (
        <SuiviSheet
          entry={openSuivi}
          onChange={(mut) => patchSuiviEntryById(setSuiviState, openSuivi.id, mut)}
          onDelete={() => deleteSuiviEntry(openSuivi.id)}
          onClose={() => setAttachOpen(null)}
        />
      )}

      {confirmRemove && (
        <ConfirmRemoveSheet
          ev={confirmRemove}
          testLabel={linkedTest ? `la feuille de test #${sanitizeTestNo(linkedTest.header.testNo) || '—'}` : null}
          suiviLabel={linkedEntry ? `la fiche plaque #${linkedEntry.serial || '—'}` : null}
          onBoth={() => {
            const ev = confirmRemove;
            setConfirmRemove(null);
            removeEventAndSheets(ev);
          }}
          onLineOnly={() => {
            const ev = confirmRemove;
            setConfirmRemove(null);
            removeEventOnly(ev);
          }}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </div>
  );
}

interface ConfirmRemoveSheetProps {
  ev: LogEvent;
  testLabel: string | null;
  suiviLabel: string | null;
  onBoth: () => void;
  onLineOnly: () => void;
  onCancel: () => void;
}

function ConfirmRemoveSheet({ ev, testLabel, suiviLabel, onBoth, onLineOnly, onCancel }: ConfirmRemoveSheetProps) {
  useEscapeToClose(onCancel);
  const what = [testLabel, suiviLabel].filter(Boolean).join(' et ');
  return (
    <>
      <div className="sheet-backdrop" onClick={onCancel} />
      <div className="sheet confirm-sheet" role="alertdialog" aria-modal="true" aria-label="Supprimer la ligne liée">
        <div className="grabber" />
        <div className="sheet-head">
          <h3>Supprimer la ligne ?</h3>
          <button className="btn ghost icon" onClick={onCancel} aria-label="Fermer">✕</button>
        </div>
        <p className="confirm-text">
          « {ev.desc || ev.type} » est liée à {what}. Que faut-il supprimer ?
        </p>
        <div className="confirm-actions">
          <button className="btn destructive" type="button" onClick={onBoth}>
            La ligne et sa feuille
          </button>
          <button className="btn" type="button" onClick={onLineOnly}>
            La ligne seule — la feuille reste
          </button>
          <button className="btn ghost" type="button" onClick={onCancel}>
            Annuler
          </button>
        </div>
      </div>
    </>
  );
}
