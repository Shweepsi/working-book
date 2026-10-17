import { useEscapeToClose } from '../lib/hooks';
import { displayTestNo, TestFields, type Test } from './ProductionTest';

interface TestSheetProps {
  test: Test;
  onPatch: (updater: (t: Test) => Test) => void;
  onClose: () => void;
}

// The measurement sheet opened in place from a journal line — same fields as
// the Test section (TestFields is shared), just wrapped in a bottom sheet so
// consulting or completing a test never leaves the shift's timeline. State
// stays owned by LogbookPage; this component only patches what it's handed.
export default function TestSheet({ test, onPatch, onClose }: TestSheetProps) {
  useEscapeToClose(onClose);

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet pt-sheet" role="dialog" aria-modal="true" aria-label="Feuille de test">
        <div className="grabber" />
        <div className="sheet-head">
          <div className="sheet-head-titles">
            <h3>Test {displayTestNo(test.header.testNo) || 'sans n°'}</h3>
            <div className="sheet-head-sub mono">
              {test.header.date}
              {test.header.hour ? ` · ${test.header.hour}` : ''}
            </div>
          </div>
          <button className="btn ghost icon" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="pt pt-in-sheet">
          <TestFields test={test} onPatch={onPatch} />
        </div>
      </div>
    </>
  );
}
