import { useEffect, useState } from 'react';
import Logbook from './components/Logbook.jsx';
import ProductionTest from './components/ProductionTest.jsx';
import { fmtClock } from './lib/time.js';
import { load, save } from './lib/storage.js';
import {
  POSTES,
  SHIFT_TYPES,
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

const SHIFT_TABS = [
  { key: 'M', label: 'Matin' },
  { key: 'A', label: 'Après-Midi' },
  { key: 'N', label: 'Nuit' },
];

function shiftKeyForHour(hour) {
  if (hour >= 6 && hour < 14) return 'M';
  if (hour >= 14 && hour < 22) return 'A';
  return 'N';
}

// Map (date, shiftKey) → poste letter
function posteFor(date, shiftKey) {
  return POSTES.find((p) => shiftFor(p, date).key === shiftKey) || null;
}

// Map (date) → resting poste
function restingPoste(date) {
  return POSTES.find((p) => shiftFor(p, date).key === 'R') || null;
}

export default function App() {
  const [tab, setTab] = useState(() => window.location.hash.replace('#', '') || 'logbook');
  const [now, setNow] = useState(() => new Date());

  const [date, setDate] = useState(() => load('wb.date', null) || todayISO());
  const [shiftKey, setShiftKey] = useState(() => {
    const persisted = load('wb.shiftKey', null);
    if (persisted && SHIFT_TABS.some((s) => s.key === persisted)) return persisted;
    return shiftKeyForHour(new Date().getHours());
  });

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    window.location.hash = tab;
  }, [tab]);

  useEffect(() => { save('wb.shiftKey', shiftKey); }, [shiftKey]);
  useEffect(() => { save('wb.date', date); }, [date]);

  const dateObj = dateFromISO(date);
  const poste = posteFor(date, shiftKey);
  const shift = SHIFT_TYPES[shiftKey];
  const restPoste = restingPoste(date);

  const shiftMeta = {
    poste,
    date,
    dateLabel: fmtDateLong(date),
    shift,
  };

  function jumpToday() {
    setDate(todayISO());
    setShiftKey(shiftKeyForHour(new Date().getHours()));
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

        <div className="shift-switch" role="group" aria-label="Shift">
          {SHIFT_TABS.map((s) => {
            const p = posteFor(date, s.key);
            return (
              <button
                key={s.key}
                type="button"
                className={`shift-chip ${shiftKey === s.key ? 'active' : ''} shift-${s.key}`}
                onClick={() => setShiftKey(s.key)}
                title={`${s.label} · Poste ${p}`}
              >
                <span className="shift-name">{s.label}</span>
                <span className="shift-poste">{p}</span>
              </button>
            );
          })}
        </div>

        <div className="shift-meta">
          <span className="muted small">{shift.hours}</span>
          {restPoste && <span className="rest-hint faint xsmall">Repos · {restPoste}</span>}
          <span className="clock">{fmtClock(now)}</span>
        </div>
      </header>

      <main className="app-main">
        {tab === 'logbook' ? (
          <Logbook key={`lb-${date}-${shiftKey}`} now={now} poste={poste} shiftMeta={shiftMeta} />
        ) : (
          <ProductionTest key={`pt-${date}-${shiftKey}`} now={now} poste={poste} shiftMeta={shiftMeta} />
        )}
      </main>
    </div>
  );
}
