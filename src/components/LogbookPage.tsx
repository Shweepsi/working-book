import { useEffect, useState } from 'react';
import Logbook from './Logbook';
import ProductionTest from './ProductionTest';
import Suivi from './Suivi';
import { load, save } from '../lib/storage';
import type { Poste, ShiftMeta } from '../types';

// The shift's whole paperwork in one page. In the paper logbook a "#390 Test
// QC" or a "Cosmétique AJ2219DE" is a line of the shift's sheet; the app had
// split them into tabs, and consulting a test meant leaving the journal. This
// page brings them back under one roof as sections — Journal, Test, Cosmétique
// — mounting the existing components one at a time.
//
// One at a time is load-bearing, not a styling choice:
// - each section owns its useSyncedState, and the sync layer tolerates only
//   one live hook per partition (see selfWrites in lib/sync.ts — a twin hook
//   on the same key never refetches and can clobber the other's writes);
// - printing keeps working by construction: the mounted section is the only
//   one contributing print-only markup, so one section = one A4 sheet, same
//   sheets as the old tabs produced.
//
// The standalone Test and Cosmétique tabs stay available (dev channel) while
// this page proves itself; a colleague keeps writing plate follow-ups from the
// Cosmétique tab, and the fallback is re-pointing one line in App.tsx.

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

interface LogbookPageProps {
  poste: Poste | null;
  shiftMeta: ShiftMeta;
  onNavigate?: (date: string, poste: Poste) => void;
}

export default function LogbookPage({ poste, shiftMeta, onNavigate }: LogbookPageProps) {
  const [section, setSection] = useState<Section>(() => {
    const persisted = load<string | null>(SECTION_KEY, null);
    return isSection(persisted) ? persisted : 'journal';
  });
  useEffect(() => { save(SECTION_KEY, section); }, [section]);

  const { date, shift } = shiftMeta;

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

      {/* The remount keys moved down here from App: they must wrap only the
          shift-scoped sections. Keying the whole page would remount Cosmétique
          on every ←/→, closing an open fiche and re-fetching the registry. */}
      {section === 'journal' && (
        <Logbook
          key={`lb-${date}-${shift.key}`}
          poste={poste}
          shiftMeta={shiftMeta}
          onNavigate={onNavigate}
        />
      )}
      {section === 'test' && (
        <ProductionTest key={`pt-${date}-${shift.key}`} poste={poste} shiftMeta={shiftMeta} />
      )}
      {section === 'suivi' && <Suivi />}
    </div>
  );
}
