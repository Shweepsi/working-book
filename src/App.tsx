import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Gridcraft from './components/Gridcraft';
import Logbook from './components/Logbook';
import ProductionTest from './components/ProductionTest';
import Schedules from './components/Schedules';
import Settings from './components/Settings';
import Suivi from './components/Suivi';
import SyncIndicator from './components/SyncIndicator';
import { SYNC_ENABLED } from './lib/api';
import { IS_DEV_CHANNEL } from './lib/channel';
import { useKeyBindings, type KeyBinding } from './lib/hooks';
import { applyUpdate, registerServiceWorker } from './lib/pwa';
import { prefetchGridcraft } from './lib/sharedGrid';
import { load, save } from './lib/storage';
import { useToast } from './lib/toast';
import SuiviCalculs from './components/SuiviCalculs';
import { BilanHeaderButton, BilanPrint, BilanSheet, type BilanScope } from './components/SuiviBilan';
import LineTab from './components/LineTabs';
import ToolsMenu from './components/ToolsMenu';
import { CalcIcon, CloseIcon, NextIcon, PrevIcon, PrintIcon, RedoIcon, UndoIcon } from './components/icons';
import { redoLine, undoLine, useLineSnapshot } from './lib/lineSync';
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

type TabKey = 'logbook' | 'test' | 'sched' | 'suivi' | 'grid' | 'loading' | 'unloading';

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
  { key: 'grid', label: 'Suivi', preview: true, shiftScoped: true },
  // The line's own input, without a spreadsheet (components/LineTabs.tsx).
  { key: 'loading', label: 'Loading', preview: true, shiftScoped: true },
  { key: 'unloading', label: 'Unloading', preview: true, shiftScoped: true },
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
  // The line's calculators (time for plates, plates in a time): one way in, from every page.
  const [calcOpen, setCalcOpen] = useState(false);
  // The shift's bilan (previews): a sheet over whatever page is showing, the
  // shift's or its day's; printed alone from the sheet, with the Suivi tab otherwise.
  const [bilanOpen, setBilanOpen] = useState(false);
  const [bilanScope, setBilanScope] = useState<BilanScope>('poste');
  const showBilan = IS_DEV_CHANNEL && SYNC_ENABLED && TABS.some((t) => t.key === 'grid');
  // Once opened, the Suivi workbook stays mounted (hidden behind the other
  // tabs): coming back is instant, with no wasm to start again and no cells
  // to replay. Its files are fetched ahead, so the first open is quick too.
  const [gridSeen, setGridSeen] = useState(false);
  useEffect(() => {
    if (tab === 'grid') setGridSeen(true);
  }, [tab]);
  useEffect(() => {
    if (!IS_DEV_CHANNEL || !SYNC_ENABLED) return;
    const t = setTimeout(() => void prefetchGridcraft(), 4000);
    return () => clearTimeout(t);
  }, []);
  // Which paper layout the Schedule view prints as. Kept here, next to the
  // `@page` rule and the aperçu bar, so the orientation has a single owner.
  // Persisted like the other paper-adjacent preferences: an operator who
  // prints the récap every morning shouldn't re-arm it every morning.
  const [schedPrintMode, setSchedPrintMode] = useState<SchedPrintMode>(
    () => (load<SchedPrintMode>('wb.sched.printMode', 'detail') === 'recap' ? 'recap' : 'detail'),
  );
  // Whether that récap notes each plate's PDP behind it. Same drawer as the
  // mode above, and persisted for the same reason: the two shifts don't prepare
  // plates the same way, and neither should have to re-arm the sheet.
  const [recapShowPdp, setRecapShowPdp] = useState<boolean>(
    () => load<boolean>('wb.sched.recapPdp', true) !== false,
  );

  const live = useNowLive();
  const toast = useToast();

  useEffect(() => {
    window.location.hash = tab;
  }, [tab]);

  // Service-worker registration is gated behind a user-visible toast so the
  // operator decides when to reload (autoUpdate would refresh mid-edit).
  //
  // The toast never times out: it used to fade after 30 s, which is exactly how
  // long it takes to walk to the coater, and the version then sat waiting for
  // days behind a button nobody had seen. It carries a key so a background
  // check can raise it again without stacking a second copy, and the same
  // update is reachable from Réglages for anyone who dismissed it.
  useEffect(() => {
    registerServiceWorker({
      onNeedRefresh() {
        toast.show({
          key: 'sw-update',
          message: 'Nouvelle version disponible',
          action: { label: 'Recharger', run: applyUpdate },
          ttl: null,
        });
      },
    });
  }, [toast]);

  useEffect(() => { save('wb.sched.printMode', schedPrintMode); }, [schedPrintMode]);
  useEffect(() => { save('wb.sched.recapPdp', recapShowPdp); }, [recapShowPdp]);
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

  // The bilan alone on paper, whatever page is under its sheet: the page's own
  // content steps aside (print-bilan on <html>) and the sheet goes portrait for
  // the time of the dialog.
  function printBilan() {
    const root = document.documentElement;
    const size = document.getElementById(PAGE_SIZE_STYLE_ID);
    const before = size?.textContent ?? null;
    if (size) size.textContent = '@media print { @page { size: A4 portrait; margin: 5mm; } }';
    root.classList.add('print-bilan');
    const done = () => {
      root.classList.remove('print-bilan');
      if (size && before !== null) size.textContent = before;
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
    // Where the engine fires no afterprint, print() returned once the dialog closed.
    setTimeout(done, 0);
  }

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

  // Steps to the previous / next shift in time — so, poste by poste, since a
  // different poste works each one. Past Nuit it rolls onto the next day's
  // Matin, and back from Matin onto the previous day's Nuit.
  function stepShift(delta: 1 | -1) {
    const idx = SHIFT_TABS.findIndex((s) => s.key === shiftKey);
    if (idx < 0) return;
    const next = idx + delta;
    const dayDelta = next < 0 ? -1 : next >= SHIFT_TABS.length ? 1 : 0;
    if (dayDelta) setDate(addDaysISO(date, dayDelta));
    setShiftKey(SHIFT_TABS[(next + SHIFT_TABS.length) % SHIFT_TABS.length].key);
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
            { key: 'ArrowLeft',  ctrl: false, shift: false, alt: false, run: () => stepShift(-1) },
            { key: 'ArrowRight', ctrl: false, shift: false, alt: false, run: () => stepShift(+1) },
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

  // The tools on the right go into a menu when they would start a second line
  // of the header: measured against what the rest of the line takes, with the
  // tools' own width as last seen inline.
  const headerRef = useRef<HTMLElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const toolsWidth = useRef(0);
  const [toolsMenu, setToolsMenu] = useState(false);
  // Annuler / Rétablir for tablets (Ctrl+Z / Ctrl+Y otherwise): the line's input only.
  const lineSnap = useLineSnapshot();
  const linePart = poste && (tab === 'loading' || tab === 'unloading') ? { date, poste } : null;
  const history = linePart
    ? { canUndo: lineSnap.canUndo, canRedo: lineSnap.canRedo, onUndo: () => undoLine(linePart), onRedo: () => redoLine(linePart) }
    : null;
  const historyButtons = history && (
    <span className="hdr-history" role="group" aria-label="Historique">
      <button type="button" className="btn ghost icon" onClick={history.onUndo} disabled={!history.canUndo} aria-label="Annuler" title="Annuler (Ctrl+Z)">
        <UndoIcon />
      </button>
      <button type="button" className="btn ghost icon" onClick={history.onRedo} disabled={!history.canRedo} aria-label="Rétablir" title="Rétablir (Ctrl+Y)">
        <RedoIcon />
      </button>
    </span>
  );
  useLayoutEffect(() => {
    const h = headerRef.current;
    if (!h || typeof ResizeObserver === 'undefined') return;
    const check = () => {
      const cs = getComputedStyle(h);
      const gap = parseFloat(cs.columnGap) || 0;
      const room = h.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      if (toolsRef.current) toolsWidth.current = toolsRef.current.offsetWidth;
      const rest = [...h.children].filter((el) => !el.classList.contains('hdr-tools')) as HTMLElement[];
      const needed = rest.reduce((n, el) => n + el.offsetWidth + gap, 0) + toolsWidth.current;
      setToolsMenu(needed > room + 0.5);
    };
    const ro = new ResizeObserver(check);
    ro.observe(h);
    for (const el of h.children) ro.observe(el);
    check();
    return () => ro.disconnect();
  }, []);

  return (
    <div className="app">
      {calcOpen && <SuiviCalculs onClose={() => setCalcOpen(false)} />}
      <header ref={headerRef} className={`app-header no-print${TABS.length > 1 || SHIFT_HEADER ? '' : ' is-single-view'}`}>
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
                onClick={() => stepShift(-1)}
                aria-label="Poste précédent"
                title="Poste précédent"
              >
                <PrevIcon />
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
                onClick={() => stepShift(+1)}
                aria-label="Poste suivant"
                title="Poste suivant"
              >
                <NextIcon />
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

        {toolsMenu ? (
          // Annuler / Rétablir stay out of the menu: a step back is one tap, as often as needed.
          <div className="hdr-tools hdr-end">
            {historyButtons}
            <ToolsMenu
              bilan={showBilan ? { part: poste ? { date, poste } : null, onOpen: () => setBilanOpen(true) } : null}
              onCalc={() => setCalcOpen(true)}
              printPreview={printPreview}
              onPrintPreview={() => setPrintPreview((v) => !v)}
              settings={{
                theme,
                onThemeChange: setTheme,
                density,
                onDensityChange: setDensity,
              }}
            />
          </div>
        ) : (
          <div className="shift-meta hdr-tools" ref={toolsRef}>
            <SyncIndicator />
            {historyButtons}
            {showBilan && <BilanHeaderButton part={poste ? { date, poste } : null} onOpen={() => setBilanOpen(true)} />}
            <button
              type="button"
              className="btn ghost icon calc-trigger"
              onClick={() => setCalcOpen(true)}
              aria-label="Calculs de ligne"
              title="Calculs de ligne : temps pour un nombre de plaques, plaques dans un temps"
            >
              <CalcIcon />
            </button>
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
              <PrintIcon />
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
        )}
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
          <Schedules density={density} printMode={schedPrintMode} recapShowPdp={recapShowPdp} />
        )}
        {tab === 'suivi' && <Suivi />}
        {gridSeen && <Gridcraft poste={poste} shiftMeta={shiftMeta} theme={theme} hidden={tab !== 'grid'} />}
        {(tab === 'loading' || tab === 'unloading') && <LineTab part={poste ? { date, poste } : null} side={tab} />}
        {showBilan && poste && (
          <div className={`sb-print-host${tab === 'grid' || tab === 'loading' || tab === 'unloading' ? ' is-tab' : ''}`}>
            <BilanPrint part={{ date, poste }} shiftLabel={shiftMeta.shift.label} dateLabel={shiftMeta.dateLabel} scope={bilanScope} />
          </div>
        )}
      </main>
      {bilanOpen && poste && (
        <BilanSheet
          part={{ date, poste }}
          shiftLabel={shiftMeta.shift.label}
          scope={bilanScope}
          onScope={setBilanScope}
          onClose={() => setBilanOpen(false)}
          onPrint={printBilan}
          onShowRow={(target) => setTab(target.tab)}
        />
      )}

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
          {/* Only the récap carries the PDP note, so the toggle only shows once
              that sheet is the one being printed — next to the choice it
              depends on, not somewhere else on the bar. */}
          {tab === 'sched' && schedPrintMode === 'recap' && (
            <button
              type="button"
              className={`btn ghost mini ${recapShowPdp ? 'is-on' : ''}`}
              onClick={() => setRecapShowPdp((v) => !v)}
              aria-pressed={recapShowPdp}
              title={
                recapShowPdp
                  ? 'PDP noté derrière chaque plaque — cliquer pour ne garder que les plaques'
                  : 'Noter le PDP derrière chaque plaque'
              }
            >
              PDP
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
          { keys: ['←', '→'], label: 'Poste précédent / suivant' },
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
          <button className="btn ghost icon" onClick={onClose} aria-label="Fermer"><CloseIcon /></button>
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
