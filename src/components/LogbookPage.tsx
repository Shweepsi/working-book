import { useCallback, useEffect, useState } from 'react';
import Logbook, { logbookStorageKey } from './Logbook';
import {
  initialProdTestState,
  patchTestById,
  prodTestStorageKey,
  ProductionTestView,
  type Test,
  type TestState,
} from './ProductionTest';
import {
  deleteSuiviEntryById,
  initialSuiviState,
  patchSuiviEntryById,
  SUIVI_STORAGE_KEY,
  SuiviSheet,
  SuiviView,
  type SuiviEntry,
  type SuiviState,
} from './Suivi';
import TestSheet from './TestSheet';
import { load, save } from '../lib/storage';
import { useSyncedState } from '../lib/sync';
import { useToast } from '../lib/toast';
import type { LogEvent, Poste, ShiftMeta } from '../types';

// The shift's whole paperwork in one page. In the paper logbook a "#390 Test
// QC" or a "Cosmétique AJ2219DE" is a line of the shift's sheet; the app had
// split them into tabs, and consulting a test meant leaving the journal. This
// page brings them back under one roof: the journal's lines carry chips that
// open the matching measurement sheet or plate follow-up in place, and the
// Test and Cosmétique sections remain for the full-width views.
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
  const toast = useToast();

  // An open sheet belongs to the shift and section it was opened from: a date
  // or section change would leave it floating over content it no longer talks
  // about (and two mounted TestFields would fight over Enter navigation).
  useEffect(() => { setAttachOpen(null); }, [date, shiftKey, section]);

  const openTest: Test | null =
    attachOpen?.kind === 'test'
      ? testState.tests.find((t) => t.id === attachOpen.id) ?? null
      : null;
  const openSuivi: SuiviEntry | null =
    attachOpen?.kind === 'suivi'
      ? suiviState.entries.find((e) => e.id === attachOpen.id) ?? null
      : null;

  function deleteSuiviEntry(id: string) {
    deleteSuiviEntryById(setSuiviState, toast, id);
    setAttachOpen(null);
  }

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
    </div>
  );
}
