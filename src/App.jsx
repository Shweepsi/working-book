import { useEffect, useState } from 'react';
import Logbook from './components/Logbook.jsx';
import ProductionTest from './components/ProductionTest.jsx';
import { fmtClock } from './lib/time.js';
import { load, save } from './lib/storage.js';

const TABS = [
  { key: 'logbook', label: 'Logbook' },
  { key: 'test', label: 'Production Test' },
];

const POSTES = ['C', 'D'];

const SHIFT_HOURS = {
  C: '06h – 14h',
  D: '14h – 22h',
};

export default function App() {
  const [tab, setTab] = useState(() => window.location.hash.replace('#', '') || 'logbook');
  const [poste, setPoste] = useState(() => load('wb.poste', 'C'));
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    window.location.hash = tab;
  }, [tab]);

  useEffect(() => {
    save('wb.poste', poste);
  }, [poste]);

  const shiftMeta = {
    poste,
    date: now.toISOString().slice(0, 10),
    hours: SHIFT_HOURS[poste],
  };

  return (
    <div className="app">
      <header className="app-header no-print">
        <div className="brand">
          <span className="dot" />
          Working Book
        </div>
        <div className="tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`tab ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="poste-switch" role="group" aria-label="Poste">
          <span className="muted xsmall">Poste</span>
          {POSTES.map((p) => (
            <button
              key={p}
              type="button"
              className={`chip ${poste === p ? 'active' : ''}`}
              onClick={() => setPoste(p)}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="shift-meta">
          <span>{shiftMeta.hours}</span>
          <span className="clock">{fmtClock(now)}</span>
        </div>
      </header>
      <main className="app-main">
        {tab === 'logbook' ? (
          <Logbook key={`lb-${poste}`} now={now} poste={poste} shiftMeta={shiftMeta} />
        ) : (
          <ProductionTest key={`pt-${poste}`} now={now} poste={poste} />
        )}
      </main>
    </div>
  );
}
