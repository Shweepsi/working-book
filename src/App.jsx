import { useEffect, useState } from 'react';
import Logbook from './components/Logbook.jsx';
import ProductionTest from './components/ProductionTest.jsx';
import { fmtClock } from './lib/time.js';
import { SAMPLE_SHIFT } from './data/shift.js';

const TABS = [
  { key: 'logbook', label: 'Logbook' },
  { key: 'test', label: 'Production Test' },
];

export default function App() {
  const [tab, setTab] = useState(() => window.location.hash.replace('#', '') || 'logbook');
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    window.location.hash = tab;
  }, [tab]);

  return (
    <div className="app">
      <header className="app-header">
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
        <div className="shift-meta">
          <span>Poste {SAMPLE_SHIFT.poste} · {SAMPLE_SHIFT.hours}</span>
          <span className="clock">{fmtClock(now)}</span>
        </div>
      </header>
      <main className="app-main">
        {tab === 'logbook' ? <Logbook now={now} /> : <ProductionTest now={now} />}
      </main>
    </div>
  );
}
