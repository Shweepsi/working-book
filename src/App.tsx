import { useEffect, useMemo, useState } from 'react';
import Logbook from './components/Logbook';
import ProductionTest from './components/ProductionTest';
import Schedules from './components/Schedules';
import Settings from './components/Settings';
import Suivi from './components/Suivi';
import SyncIndicator from './components/SyncIndicator';
import { useKeyBindings, type KeyBinding } from './lib/hooks';
import { registerServiceWorker } from './lib/pwa';
import { load, save } from './lib/storage';
import { useToast } from './lib/toast';
import {
  POSTES,
  SHIFT_TYPES,
  addDaysISO,
  dateFromISO,
  fmtDateLong,
  shiftFor,
  todayISO,
} from './lib/shiftCalendar';
import type { Density, Poste, ShiftKey, ShiftMeta, Theme } from './types';

type TabKey = 'logbook' | 'test' | 'sched' | 'suivi';

const TABS = [
  { key: 'logbook', label: 'Logbook' },
  { key: 'test', label: 'Test' },
  { key: 'suivi', label: 'Cosmétique' },
  { key: 'sched', label: 'Schedule' },
] as const satisfies readonly { key: TabKey; label: string }[];

const SHIFT_TABS = [
  { key: 'M', label: 'Matin' },
  { key: 'A', label: 'Après-Midi' },
  { key: 'N', label: 'Nuit' },
] as const satisfies readonly { key: Exclude<ShiftKey, 'R'>; label: string }[];

type LiveShiftKey = (typeof SHIFT_TABS)[number]['key'];

// Status-bar color (PWA / mobile chrome) per resolved theme
const META_COLOR: Record<'light' | 'dark', string> = { light: '#f0eee9', dark: '#14130f' };

function shiftKeyForHour(hour: number): LiveShiftKey {
  if (hour >= 6 && hour < 14) return 'M';
  if (hour >= 14 && hour < 22) return 'A';
  return 'N';
}

// The night shift (22h–06h) spans two calendar days but belongs to the day it
// started on. Between 00h and 06h the active shift is yesterday's night shift.
function liveDateAndShift(now: Date = new Date()): { date: string; shiftKey: LiveShiftKey } {
  const hour = now.getHours();
  if (hour < 6) return { date: addDaysISO(todayISO(now), -1), shiftKey: 'N' };
  return { date: todayISO(now), shiftKey: shiftKeyForHour(hour) };
}

function posteFor(dateObj: Date, shiftKey: ShiftKey): Poste | null {
  return POSTES.find((p) => shiftFor(p, dateObj).key === shiftKey) ?? null;
}

function resolvedTheme(pref: Theme): 'light' | 'dark' {
  if (pref === 'light' || pref === 'dark') return pref;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function isTabKey(value: string): value is TabKey {
  return value === 'logbook' || value === 'test' || value === 'sched' || value === 'suivi';
}

function isLiveShiftKey(value: string): value is LiveShiftKey {
  return SHIFT_TABS.some((s) => s.key === value);
}

export default function App() {
  const [tab, setTab] = useState<TabKey>(() => {
    const hash = window.location.hash.replace('#', '');
    return isTabKey(hash) ? hash : 'logbook';
  });

  const [date, setDate] = useState<string>(
    () => load<string | null>('wb.date', null) || liveDateAndShift().date,
  );
  const [shiftKey, setShiftKey] = useState<LiveShiftKey>(() => {
    const persisted = load<string | null>('wb.shiftKey', null);
    if (persisted && isLiveShiftKey(persisted)) return persisted;
    return liveDateAndShift().shiftKey;
  });

  const [theme, setTheme] = useState<Theme>(() => load<Theme>('wb.theme', 'auto'));
  const [density, setDensity] = useState<Density>(() => load<Density>('wb.density', 'normal'));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [printPreview, setPrintPreview] = useState(false);

  const live = useNowLive();
  const toast = useToast();

  useEffect(() => {
    window.location.hash = tab;
  }, [tab]);

  // Service-worker registration is gated behind a user-visible toast so the
  // operator decides when to reload (autoUpdate would refresh mid-edit).
  useEffect(() => {
    registerServiceWorker({
      onNeedRefresh(apply) {
        toast.show({
          message: 'Nouvelle version disponible',
          action: { label: 'Recharger', run: apply },
          ttl: 30_000,
        });
      },
    });
  }, [toast]);

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

  // Toggle a screen-only class that mirrors the print stylesheet, so the
  // user can validate page layout without touching the OS print dialog.
  useEffect(() => {
    document.documentElement.classList.toggle('is-print-preview', printPreview);
  }, [printPreview]);

  // Tag the document while the OS is rendering the print preview so the
  // print rules can be expressed once with both selectors and stay in sync.
  useEffect(() => {
    const onBefore = () => document.documentElement.classList.add('is-printing');
    const onAfter = () => document.documentElement.classList.remove('is-printing');
    window.addEventListener('beforeprint', onBefore);
    window.addEventListener('afterprint', onAfter);
    return () => {
      window.removeEventListener('beforeprint', onBefore);
      window.removeEventListener('afterprint', onAfter);
    };
  }, []);

  const dateObj = dateFromISO(date);
  const poste = posteFor(dateObj, shiftKey);
  const shift = SHIFT_TYPES[shiftKey];
  const onLiveShift = date === live.date && shiftKey === live.shiftKey;

  const shiftMeta: ShiftMeta = {
    poste,
    date,
    dateLabel: fmtDateLong(date),
    shift,
  };

  function jumpLive() {
    const { date: liveDate, shiftKey: liveShift } = liveDateAndShift();
    setDate(liveDate);
    setShiftKey(liveShift);
  }

  function cycleShift(delta: 1 | -1) {
    const idx = SHIFT_TABS.findIndex((s) => s.key === shiftKey);
    if (idx < 0) return;
    const next = (idx + delta + SHIFT_TABS.length) % SHIFT_TABS.length;
    setShiftKey(SHIFT_TABS[next].key);
  }

  function cycleTab(delta: 1 | -1) {
    const idx = TABS.findIndex((t) => t.key === tab);
    if (idx < 0) return;
    const next = (idx + delta + TABS.length) % TABS.length;
    setTab(TABS[next].key);
  }

  const bindings = useMemo<KeyBinding[]>(
    () => [
      { key: 'ArrowLeft',  ctrl: false, shift: false, alt: false, run: () => setDate(addDaysISO(date, -1)) },
      { key: 'ArrowRight', ctrl: false, shift: false, alt: false, run: () => setDate(addDaysISO(date, +1)) },
      { key: '[', shift: false, run: () => cycleShift(-1) },
      { key: ']', shift: false, run: () => cycleShift(+1) },
      { key: 't', shift: false, run: jumpLive },
      { key: 'Tab', shift: false, ctrl: true, run: () => cycleTab(+1) },
      { key: 'Tab', shift: true,  ctrl: true, run: () => cycleTab(-1) },
      { key: '?', shift: true, run: () => setHelpOpen((v) => !v) },
    ],
    [date, shiftKey, tab],
  );

  useKeyBindings(bindings);

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
            aria-label="Jour précédent"
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
            aria-label="Jour suivant"
          >
            ›
          </button>
          <button
            type="button"
            className="btn ghost mini live-btn"
            onClick={jumpLive}
            disabled={onLiveShift}
            title={onLiveShift ? 'Déjà sur le shift en cours' : 'Aller au shift en cours'}
          >
            Live
          </button>
        </div>

        <div className="shift-switch" role="group" aria-label="Shift">
          {SHIFT_TABS.map((s) => {
            const p = posteFor(dateObj, s.key);
            const isLive = date === live.date && live.shiftKey === s.key;
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
          <SyncIndicator />
          <button
            type="button"
            className="btn ghost icon kbd-help-trigger"
            onClick={() => setHelpOpen((v) => !v)}
            aria-label="Raccourcis clavier"
            title="Raccourcis clavier (Maj + ?)"
          >
            ?
          </button>
          <Settings
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            theme={theme}
            onThemeChange={setTheme}
            density={density}
            onDensityChange={setDensity}
            printPreview={printPreview}
            onPrintPreviewChange={setPrintPreview}
          />
        </div>
      </header>

      <main className="app-main">
        {tab === 'logbook' && (
          <Logbook
            key={`lb-${date}-${shiftKey}`}
            poste={poste}
            shiftMeta={shiftMeta}
            onNavigate={(d, p) => {
              const sk = shiftFor(p, d).key;
              if (sk !== 'M' && sk !== 'A' && sk !== 'N') return;
              setDate(d);
              setShiftKey(sk);
            }}
          />
        )}
        {tab === 'test' && (
          <ProductionTest key={`pt-${date}-${shiftKey}`} poste={poste} shiftMeta={shiftMeta} />
        )}
        {tab === 'sched' && <Schedules />}
        {tab === 'suivi' && <Suivi />}
      </main>

      {helpOpen && <KeyboardHelp onClose={() => setHelpOpen(false)} />}

      {printPreview && (
        <div className="print-preview-bar no-print" role="status">
          <span><strong>Aperçu d’impression</strong> — la mise en page papier s’applique à l’écran.</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn ghost mini" onClick={() => window.print()}>
            Imprimer
          </button>
          <button type="button" className="btn primary mini" onClick={() => setPrintPreview(false)}>
            Quitter l’aperçu
          </button>
        </div>
      )}
    </div>
  );
}

function KeyboardHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows: Array<{ keys: string[]; label: string }> = [
    { keys: ['←', '→'], label: 'Jour précédent / suivant' },
    { keys: ['[', ']'], label: 'Shift précédent / suivant' },
    { keys: ['T'], label: 'Aller au shift en cours' },
    { keys: ['Ctrl', '⇥'], label: 'Onglet suivant' },
    { keys: ['Ctrl', 'Maj', '⇥'], label: 'Onglet précédent' },
    { keys: ['Maj', '?'], label: 'Afficher / masquer cette aide' },
    { keys: ['Échap'], label: 'Fermer' },
  ];

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet kbd-help-sheet" role="dialog" aria-modal="true" aria-label="Raccourcis clavier">
        <div className="grabber" />
        <div className="sheet-head">
          <h3>Raccourcis clavier</h3>
          <button className="btn ghost icon" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <dl className="kbd-help-list">
          {rows.map((r) => (
            <div key={r.label} className="kbd-help-row">
              <dt>
                {r.keys.map((k, i) => (
                  <span key={i}>
                    {i > 0 && <span className="kbd-help-plus" aria-hidden="true">+</span>}
                    <kbd className="kbd">{k}</kbd>
                  </span>
                ))}
              </dt>
              <dd>{r.label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  );
}

function useNowLive(): { date: string; shiftKey: LiveShiftKey } {
  const [live, setLive] = useState(() => liveDateAndShift());
  useEffect(() => {
    const tick = () => setLive((prev) => {
      const next = liveDateAndShift();
      return next.date === prev.date && next.shiftKey === prev.shiftKey ? prev : next;
    });
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  return live;
}
