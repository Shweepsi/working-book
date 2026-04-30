import { useEffect, useState } from 'react';
import Logbook from './components/Logbook.jsx';
import ProductionTest from './components/ProductionTest.jsx';
import Schedules from './components/Schedules.jsx';
import Settings from './components/Settings.jsx';
import { load, save } from './lib/storage.js';
import {
  POSTES,
  SHIFT_TYPES,
  addDaysISO,
  dateFromISO,
  fmtDateLong,
  shiftFor,
  todayISO,
} from './lib/shiftCalendar.js';

const TABS = [
  { key: 'logbook', label: 'Logbook' },
  { key: 'test', label: 'Production Test' },
  { key: 'sched', label: 'Schedule' },
];

const SHIFT_TABS = [
  { key: 'M', label: 'Matin' },
  { key: 'A', label: 'Après-Midi' },
  { key: 'N', label: 'Nuit' },
];

// Status-bar color (PWA / mobile chrome) per resolved theme
const META_COLOR = { light: '#f0eee9', dark: '#14130f' };

function shiftKeyForHour(hour) {
  if (hour >= 6 && hour < 14) return 'M';
  if (hour >= 14 && hour < 22) return 'A';
  return 'N';
}

function posteFor(dateObj, shiftKey) {
  return POSTES.find((p) => shiftFor(p, dateObj).key === shiftKey) || null;
}

function resolvedTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function App() {
  const [tab, setTab] = useState(() => window.location.hash.replace('#', '') || 'logbook');

  const [date, setDate] = useState(() => load('wb.date', null) || todayISO());
  const [shiftKey, setShiftKey] = useState(() => {
    const persisted = load('wb.shiftKey', null);
    if (persisted && SHIFT_TABS.some((s) => s.key === persisted)) return persisted;
    return shiftKeyForHour(new Date().getHours());
  });

  const [theme, setTheme] = useState(() => load('wb.theme', 'auto'));
  const [density, setDensity] = useState(() => load('wb.density', 'normal'));
  const [settingsOpen, setSettingsOpen] = useState(false);

  const nowShiftKey = useNowShiftKey();

  useEffect(() => {
    window.location.hash = tab;
  }, [tab]);

  useEffect(() => { save('wb.shiftKey', shiftKey); }, [shiftKey]);
  useEffect(() => { save('wb.date', date); }, [date]);

  // Apply theme + density to <html> and sync the PWA theme-color meta
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    save('wb.theme', theme);

    const meta = document.querySelector('meta[name="theme-color"]');
    const apply = () => {
      if (meta) meta.setAttribute('content', META_COLOR[resolvedTheme(theme)]);
    };
    apply();

    if (theme === 'auto' && window.matchMedia) {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      mql.addEventListener?.('change', apply);
      return () => mql.removeEventListener?.('change', apply);
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-density', density);
    save('wb.density', density);
  }, [density]);

  const dateObj = dateFromISO(date);
  const poste = posteFor(dateObj, shiftKey);
  const shift = SHIFT_TYPES[shiftKey];
  const isToday = date === todayISO();
  const onLiveShift = isToday && shiftKey === nowShiftKey;

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
          <span className="brand-name">Working Book</span>
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
          <button
            type="button"
            className="btn ghost mini today-btn"
            onClick={jumpToday}
            disabled={onLiveShift}
            title={
              onLiveShift ? 'Already on today’s current shift'
                : isToday ? 'Snap to today’s current shift'
                : 'Jump to today'
            }
          >
            Today
          </button>
        </div>

        <div className="shift-switch" role="group" aria-label="Shift">
          {SHIFT_TABS.map((s) => {
            const p = posteFor(dateObj, s.key);
            const isLive = isToday && nowShiftKey === s.key;
            return (
              <button
                key={s.key}
                type="button"
                className={`shift-chip ${shiftKey === s.key ? 'active' : ''} ${isLive ? 'is-live' : ''} shift-${s.key}`}
                onClick={() => setShiftKey(s.key)}
                title={isLive ? `${s.label} · Poste ${p} · en cours` : `${s.label} · Poste ${p}`}
              >
                {isLive && <span className="live-dot" aria-hidden="true" />}
                <span className="shift-name">{s.label}</span>
                <span className="shift-poste">{p}</span>
              </button>
            );
          })}
        </div>

        <div className="shift-meta">
          <Settings
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            theme={theme}
            onThemeChange={setTheme}
            density={density}
            onDensityChange={setDensity}
          />
        </div>
      </header>

      <main className="app-main">
        {tab === 'logbook' && (
          <Logbook key={`lb-${date}-${shiftKey}`} poste={poste} shiftMeta={shiftMeta} />
        )}
        {tab === 'test' && (
          <ProductionTest key={`pt-${date}-${shiftKey}`} poste={poste} shiftMeta={shiftMeta} />
        )}
        {tab === 'sched' && <Schedules />}
      </main>
    </div>
  );
}

function useNowShiftKey() {
  const [key, setKey] = useState(() => shiftKeyForHour(new Date().getHours()));
  useEffect(() => {
    const tick = () => setKey((prev) => {
      const next = shiftKeyForHour(new Date().getHours());
      return next === prev ? prev : next;
    });
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  return key;
}
