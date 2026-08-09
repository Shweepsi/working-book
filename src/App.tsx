import { useEffect, useMemo, useState } from 'react';
import Logbook from './components/Logbook';
import ProductionTest from './components/ProductionTest';
import Schedules from './components/Schedules';
import Settings from './components/Settings';
import Suivi from './components/Suivi';
import SyncIndicator from './components/SyncIndicator';
import { IS_DEV_CHANNEL } from './lib/channel';
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
import type { Density, Poste, SchedPrintMode, ShiftKey, ShiftMeta, Theme } from './types';

type TabKey = 'logbook' | 'test' | 'sched' | 'suivi';

interface TabDef {
  key: TabKey;
  label: string;
  // Still being reworked: shipped to the dev-Worker previews only, so the
  // production site shows Schedule on its own.
  preview?: boolean;
  // Reads the header's date and shift. Cosmétique and Schedule hold their own
  // scope, so they don't.
  shiftScoped?: boolean;
}

const ALL_TABS: readonly TabDef[] = [
  { key: 'logbook', label: 'Logbook', preview: true, shiftScoped: true },
  { key: 'test', label: 'Test', preview: true, shiftScoped: true },
  { key: 'suivi', label: 'Cosmétique', preview: true },
  { key: 'sched', label: 'Schedule' },
];

const TABS = ALL_TABS.filter((t) => IS_DEV_CHANNEL || !t.preview);

// The date picker and the shift chips exist for the shift-scoped tabs. Once
// those are filtered out they steer nothing on screen, so they go with them.
const SHIFT_HEADER = TABS.some((t) => t.shiftScoped);

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

// Deliberately checks the *visible* tabs: a `#logbook` bookmark opened on the
// production site falls back to the default rather than restoring a tab that
// build doesn't ship.
function isVisibleTab(value: string): value is TabKey {
  return TABS.some((t) => t.key === value);
}

function isLiveShiftKey(value: string): value is LiveShiftKey {
  return SHIFT_TABS.some((s) => s.key === value);
}

// Style element holding the per-view `@page` size (see the effect that fills it).
const PAGE_SIZE_STYLE_ID = 'wb-page-size';

export default function App() {
  const [tab, setTab] = useState<TabKey>(() => {
    const hash = window.location.hash.replace('#', '');
    return isVisibleTab(hash) ? hash : TABS[0].key;
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
  // Which paper layout the Schedule view prints as. Kept here, next to the
  // `@page` rule and the aperçu bar, so the orientation has a single owner.
  // Persisted like the other paper-adjacent preferences: an operator who
  // prints the récap every morning shouldn't re-arm it every morning.
  const [schedPrintMode, setSchedPrintMode] = useState<SchedPrintMode>(
    () => (load<SchedPrintMode>('wb.sched.printMode', 'detail') === 'recap' ? 'recap' : 'detail'),
  );
  // Whether that récap splits each dimension's plates by PDP. Same drawer as
  // the mode above, and persisted for the same reason: the two shifts don't
  // prepare plates the same way, and neither should have to re-arm the sheet.
  const [recapByPdp, setRecapByPdp] = useState<boolean>(
    () => load<boolean>('wb.sched.recapByPdp', true) !== false,
  );

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

  useEffect(() => { save('wb.sched.printMode', schedPrintMode); }, [schedPrintMode]);
  useEffect(() => { save('wb.sched.recapByPdp', recapByPdp); }, [recapByPdp]);
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

  // Nothing tags the document for printing: the paper rules win on their own
  // (see the schedule print section at the bottom of app.css), so printing
  // doesn't hang on a `beforeprint` listener some engines never fire.

  // Paper orientation per view. `@page` can't be selector-scoped, and binding a
  // named page with the `page` property makes Chromium force a break around
  // every table row (a 60-row schedule printed as 61 sheets), so the rule is
  // rewritten in place instead. The schedule table is wide → landscape;
  // everything else stays portrait.
  useEffect(() => {
    const el =
      document.getElementById(PAGE_SIZE_STYLE_ID) ??
      document.head.appendChild(
        Object.assign(document.createElement('style'), { id: PAGE_SIZE_STYLE_ID }),
      );
    // The schedule sheet gets taller top/bottom margins: 5mm glued the title
    // to the paper edge, and on later pages the repeated column header sat
    // just as tight. Sides stay at 5mm — the table needs the width.
    //
    // Its récap is the exception: three columns fit portrait, and the widest of
    // them is filled in by hand, so the margins go wider — the sheet is held
    // and written on, not just read.
    el.textContent =
      tab === 'sched' && schedPrintMode === 'detail'
        ? '@media print { @page { size: A4 landscape; margin: 8mm 5mm; } }'
        : tab === 'sched'
          ? '@media print { @page { size: A4 portrait; margin: 10mm 8mm; } }'
          : '@media print { @page { size: A4 portrait; margin: 5mm; } }';
  }, [tab, schedPrintMode]);

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

  // Only the shortcuts whose target is on screen — see SHIFT_HEADER. A build
  // with one tab and no shift header keeps just the help toggle.
  const bindings = useMemo<KeyBinding[]>(
    () => [
      ...(SHIFT_HEADER
        ? ([
            { key: 'ArrowLeft',  ctrl: false, shift: false, alt: false, run: () => setDate(addDaysISO(date, -1)) },
            { key: 'ArrowRight', ctrl: false, shift: false, alt: false, run: () => setDate(addDaysISO(date, +1)) },
            { key: '[', shift: false, run: () => cycleShift(-1) },
            { key: ']', shift: false, run: () => cycleShift(+1) },
            { key: 't', shift: false, run: jumpLive },
          ] satisfies KeyBinding[])
        : []),
      ...(TABS.length > 1
        ? ([
            { key: 'Tab', shift: false, ctrl: true, run: () => cycleTab(+1) },
            { key: 'Tab', shift: true,  ctrl: true, run: () => cycleTab(-1) },
          ] satisfies KeyBinding[])
        : []),
      { key: '?', shift: true, run: () => setHelpOpen((v) => !v) },
    ],
    [date, shiftKey, tab],
  );

  useKeyBindings(bindings);

  return (
    <div className="app">
      <header className={`app-header no-print${TABS.length > 1 || SHIFT_HEADER ? '' : ' is-single-view'}`}>
        <div className="brand">
          <span className="brand-name">Working Book</span>
        </div>

        {/* A single tab is a permanently-active pill with nothing to switch to,
            so the bar comes out with the tabs it was hiding. */}
        {TABS.length > 1 && (
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
        )}

        {SHIFT_HEADER && (
          <>
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
          </>
        )}

        <div className="shift-meta">
          <SyncIndicator />
          {/* Sits in the header rather than behind the settings cog: checking
              the paper layout is a recurring gesture, not a preference. */}
          <button
            type="button"
            className={`btn ghost icon print-preview-trigger ${printPreview ? 'is-on' : ''}`}
            onClick={() => setPrintPreview((v) => !v)}
            aria-pressed={printPreview}
            aria-label="Aperçu d’impression"
            title={printPreview ? 'Quitter l’aperçu d’impression' : 'Aperçu d’impression — voir la mise en page papier'}
          >
            <span className="print-preview-icon" aria-hidden="true" />
          </button>
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
        {tab === 'sched' && (
          <Schedules density={density} printMode={schedPrintMode} recapByPdp={recapByPdp} />
        )}
        {tab === 'suivi' && <Suivi />}
      </main>

      {helpOpen && <KeyboardHelp onClose={() => setHelpOpen(false)} />}

      {printPreview && (
        <div className="print-preview-bar" role="status">
          <span><strong>Aperçu d’impression</strong> — la mise en page papier s’applique à l’écran.</span>
          <span style={{ flex: 1 }} />
          {/* The Schedule view has two sheets, and this is the only place the
              choice between them is offered: it is a paper decision, so it
              belongs on the last stop before the print dialog rather than in
              the table's own toolbar, which prints nothing. */}
          {tab === 'sched' && (
            <div className="print-mode-switch" role="group" aria-label="Mise en page du schedule">
              {(['detail', 'recap'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`btn ghost mini ${schedPrintMode === mode ? 'is-on' : ''}`}
                  onClick={() => setSchedPrintMode(mode)}
                  aria-pressed={schedPrintMode === mode}
                  title={
                    mode === 'detail'
                      ? 'Tableau détaillé du planning, A4 paysage'
                      : 'Récap des lites restantes par qualité, dimension, PDP et plaque, A4 portrait, colonne plaques à remplir'
                  }
                >
                  {mode === 'detail' ? 'Détail' : 'Récap'}
                </button>
              ))}
            </div>
          )}
          {/* Only the récap has a PDP level to fold away, so the toggle only
              shows once that sheet is the one being printed — next to the
              choice it depends on, not somewhere else on the bar. */}
          {tab === 'sched' && schedPrintMode === 'recap' && (
            <button
              type="button"
              className={`btn ghost mini ${recapByPdp ? 'is-on' : ''}`}
              onClick={() => setRecapByPdp((v) => !v)}
              aria-pressed={recapByPdp}
              title={
                recapByPdp
                  ? 'Plaques regroupées par PDP sous chaque dimension — cliquer pour les lister directement'
                  : 'Regrouper les plaques par PDP sous chaque dimension'
              }
            >
              Tri PDP
            </button>
          )}
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

  // Mirrors the bindings actually registered in App — a sheet promising keys
  // that do nothing is worse than a short sheet.
  const rows: Array<{ keys: string[]; label: string }> = [
    ...(SHIFT_HEADER
      ? [
          { keys: ['←', '→'], label: 'Jour précédent / suivant' },
          { keys: ['[', ']'], label: 'Shift précédent / suivant' },
          { keys: ['T'], label: 'Aller au shift en cours' },
        ]
      : []),
    ...(TABS.length > 1
      ? [
          { keys: ['Ctrl', '⇥'], label: 'Onglet suivant' },
          { keys: ['Ctrl', 'Maj', '⇥'], label: 'Onglet précédent' },
        ]
      : []),
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
