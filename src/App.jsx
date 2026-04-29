import { useEffect, useState } from 'react';
import Logbook from './components/Logbook.jsx';
import ProductionTest from './components/ProductionTest.jsx';
import { fmtClock } from './lib/time.js';
import { load, save } from './lib/storage.js';
import {
  POSTES,
  SHIFT_TYPES,
  activePosteAt,
  addDaysISO,
  dateFromISO,
  fmtDateLong,
  isoDate,
  shiftFor,
  todayISO,
} from './lib/shiftCalendar.js';

const TABS = [
  { key: 'logbook', label: 'Logbook' },
  { key: 'test', label: 'Production Test' },
];

export default function App() {
  const [tab, setTab] = useState(() => window.location.hash.replace('#', '') || 'logbook');
  const [now, setNow] = useState(() => new Date());

  // Default date = today; default poste = whichever is currently working.
  const [date, setDate] = useState(() => {
    const persisted = load('wb.date', null);
    return persisted || todayISO();
  });
  const [poste, setPoste] = useState(() => {
    const persisted = load('wb.poste', null);
    if (persisted && POSTES.includes(persisted)) return persisted;
    const today = new Date();
    return activePosteAt(today, today.getHours()) || 'C';
  });

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    window.location.hash = tab;
  }, [tab]);

  useEffect(() => { save('wb.poste', poste); }, [poste]);
  useEffect(() => { save('wb.date', date); }, [date]);

  const dateObj = dateFromISO(date);
  const shift = shiftFor(poste, dateObj);
  const isResting = shift.key === 'R';

  const shiftMeta = {
    poste,
    date,
    dateLabel: fmtDateLong(date),
    shift,
  };

  function jumpToday() {
    const today = todayISO();
    setDate(today);
    const cur = activePosteAt(new Date(), new Date().getHours());
    if (cur) setPoste(cur);
  }

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

        <div className="date-nav" role="group" aria-label="Date">
          <button
            type="button"
            className="btn ghost icon"
            onClick={() => setDate(addDaysISO(date, -1))}
            aria-label="Previous day"
          >
            ‹
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="date-input"
          />
          <button
            type="button"
            className="btn ghost icon"
            onClick={() => setDate(addDaysISO(date, +1))}
            aria-label="Next day"
          >
            ›
          </button>
          <button type="button" className="btn ghost mini today-btn" onClick={jumpToday}>
            Today
          </button>
        </div>

        <div className="poste-switch" role="group" aria-label="Poste">
          {POSTES.map((p) => {
            const s = shiftFor(p, dateObj);
            return (
              <button
                key={p}
                type="button"
                className={`poste-chip ${poste === p ? 'active' : ''} shift-${s.key}`}
                onClick={() => setPoste(p)}
                title={`Poste ${p} · ${s.label}`}
              >
                <span className="poste-letter">{p}</span>
                <span className="poste-shift">{s.key}</span>
              </button>
            );
          })}
        </div>

        <div className="shift-meta">
          <span className={`shift-badge shift-${shift.key}`}>{shift.label}</span>
          <span className="muted small">{shift.hours}</span>
          <span className="clock">{fmtClock(now)}</span>
        </div>
      </header>

      <main className="app-main">
        {isResting ? (
          <RestingView shiftMeta={shiftMeta} onPick={setPoste} dateObj={dateObj} />
        ) : tab === 'logbook' ? (
          <Logbook key={`lb-${date}-${poste}`} now={now} poste={poste} shiftMeta={shiftMeta} />
        ) : (
          <ProductionTest key={`pt-${date}-${poste}`} now={now} poste={poste} shiftMeta={shiftMeta} />
        )}
      </main>
    </div>
  );
}

function RestingView({ shiftMeta, onPick, dateObj }) {
  const others = POSTES.filter((p) => shiftFor(p, dateObj).key !== 'R');
  return (
    <div className="resting">
      <div className="resting-card">
        <div className="resting-icon">☾</div>
        <h2>Repos · Poste {shiftMeta.poste}</h2>
        <p className="muted">{shiftMeta.dateLabel}</p>
        <p className="faint small">No shift logged on rest days. Pick another poste working today:</p>
        <div className="resting-postes">
          {others.map((p) => {
            const s = shiftFor(p, dateObj);
            return (
              <button
                key={p}
                type="button"
                className="btn"
                onClick={() => onPick(p)}
              >
                Poste {p} · {SHIFT_TYPES[s.key].label}
                <span className="faint small" style={{ marginLeft: 6 }}>{s.hours}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
