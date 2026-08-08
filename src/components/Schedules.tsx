import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { load, save } from '../lib/storage';
import { useSyncedState } from '../lib/sync';
import { mergePMS230, parsePMS230, shortItemName, type PMS230Record, type PMS230Result } from '../lib/pms230Parser';
import { parsePolicy, type Policy, type PolicyResult } from '../lib/policyParser';
import {
  DOWNTIME_FACTOR,
  fmtHMmin,
  hasHMmin,
  minutesAt,
  totalLites,
  totalM2,
  totalReqLites,
} from '../lib/coaterMath';
import PasteImport from './PasteImport';
import PortalImport from './PortalImport';
import ScheduleRecap from './ScheduleRecap';
import type { SchedPrintMode } from '../types';
import { useEscapeToClose } from '../lib/hooks';
import { useToast } from '../lib/toast';

const KEY_DATA     = 'wb.schedules.v1';
const KEY_POLICY   = 'wb.schedules.policy.v1';
const KEY_SPEEDS   = 'wb.schedules.vitesses.v1';
const KEY_ARCHIVES = 'wb.schedules.archives.v1';
const KEY_TABLE    = 'wb.schedules.table.v1';

// Coater speed of a schedule nobody has set one on yet. The tile reads as
// invalid at 0 and the throughput tiles show an em dash, which is the honest
// state: the planner has to say how fast the line runs before the times mean
// anything.
const DEFAULT_SPEED = 0;

// How long the two coarse Schedule toasts stay up — retiring a schedule, and
// the import announcing a purge. Wider than the toast default because both are
// whole-schedule news and the operator may be away from the screen when it
// lands; the first of them also has an Annuler to reach in that time.
const LONG_TOAST_TTL = 10_000;

// How far a rail card has to travel left before the release retires its
// schedule. Absolute rather than a share of the width so the gesture feels the
// same on the 240px desktop rail and on the wider phone chips.
const SWIPE_RETIRE_PX = 88;

type DisplayRow = PMS230Record & { mtoMts: string };

// A row's planning policy, or '?' when the product isn't in the imported table.
type MtoFilter = Policy | '?';

type GroupedItem =
  | { kind: 'break'; id: string; longueur: number }
  | { kind: 'row'; row: DisplayRow };

// Both halves of the planner's Excel formula, which sets these rows aside
// before anything else is computed. Neither family is work the coater still
// has to do, so neither takes part in the totals, the throughput tiles or the
// rail counts.
//
// They part company after that. A QC sample is a prélèvement, not production:
// it never appears anywhere in this view, and the œillet does not offer it.
// A finished line is production — the œillet exists to let it be read back.
const isQcSample = (r: PMS230Record): boolean => /^Vacuum/i.test(r.itemName);

// Op-step 90 marks a line finished, as does a remaining requirement fallen to
// zero. The two say the same thing by different routes.
const isFinished = (r: PMS230Record): boolean => r.opStepD === 90 || (r.reqLites ?? 0) <= 0;

// Still work to do — what the planning table, the totals and the rail count.
const isPlanningRow = (r: PMS230Record): boolean => !isQcSample(r) && !isFinished(r);

// A schedule out of the planning, as the "terminés" sheet lists it — either
// because there is nothing left to produce or because someone retired it.
interface FinishedSchedule {
  schedule: string;
  name: string;
  count: number;
  // Lites already produced, and the surface still to coat. On a schedule that
  // ran to the end the second one is zero, which is precisely what says it is
  // finished; on a retired one it is what the line chose to leave behind.
  // Either way the sheet prints it as a reste, so both rows read the same.
  lites: number;
  m2: number;
  // Rows still to produce. Zero on a finished schedule — the œillet has to be
  // open for the table to show anything at all when one is opened from here.
  planning: number;
}

interface RailStat {
  count: number;
  m2: number;
  shortName: string;
}

type SortKey = 'longueur' | 'dateDepart' | 'mo' | 'product' | 'itemName' | 'schedLites' | 'prodLites' | 'reqLites' | 'opTm' | 'qualite' | 'pdp' | 'm2' | 'packsReq' | 'litesPerPack' | 'mtoMts';
type SortDir = 'asc' | 'desc';

interface ColumnDef {
  key: string;
  label: string;
  cls: string;
  sortKey?: SortKey;
}

interface ColumnView extends ColumnDef {
  pinnedLeft?: number;
  pinnedLast?: boolean;
}

// Class + style fragments for a cell of a possibly-pinned column. Returns
// empty defaults for non-pinned cells so callers can spread the result
// without branching at every call site.
function pinnedAttrs(c: ColumnView): { className: string; style: CSSProperties | undefined } {
  if (c.pinnedLeft === undefined) return { className: '', style: undefined };
  return {
    className: ` is-pinned${c.pinnedLast ? ' is-pinned-last' : ''}`,
    style: { left: `${c.pinnedLeft}px` },
  };
}

// Every column sorts. The three that didn't — MTO/MTS, MO, L/Pack — had no
// reason not to beyond never having been wired up, and a header that ignores a
// click reads as broken rather than as deliberate.
const COLUMNS: ColumnDef[] = [
  { key: 'mtoMts',     label: 'MTO/MTS',  cls: 'col-mto',  sortKey: 'mtoMts'     },
  { key: 'dateDepart', label: 'Départ',   cls: 'col-date', sortKey: 'dateDepart' },
  { key: 'mo',         label: 'MO',       cls: 'col-mo',   sortKey: 'mo'         },
  { key: 'product',    label: 'Produit',  cls: 'col-prod', sortKey: 'product'    },
  { key: 'itemName',   label: 'Article',  cls: 'col-name', sortKey: 'itemName'   },
  { key: 'schedLites', label: 'Sched',    cls: 'col-num',  sortKey: 'schedLites' },
  { key: 'prodLites',  label: 'Prod',     cls: 'col-num',  sortKey: 'prodLites'  },
  { key: 'reqLites',   label: 'Req',      cls: 'col-num',  sortKey: 'reqLites'   },
  { key: 'opTm',       label: 'Op Tm',    cls: 'col-num',  sortKey: 'opTm'       },
  { key: 'format',     label: 'Dimension', cls: 'col-fmt', sortKey: 'longueur'   },
  { key: 'qualite',    label: 'Qualité',  cls: 'col-q',    sortKey: 'qualite'    },
  { key: 'litesPerPack', label: 'L/Pack', cls: 'col-num', sortKey: 'litesPerPack' },
  { key: 'packsReq',   label: 'P/REQ',    cls: 'col-num',  sortKey: 'packsReq'   },
  { key: 'pdp',        label: 'PDP',      cls: 'col-pdp',                   sortKey: 'pdp'       },
  { key: 'm2',         label: 'm² rest.', cls: 'col-m2',                    sortKey: 'm2'        },
];

// Columns whose footer cell carries a summed value (see TotalRow).
const TOTAL_KEYS = new Set(['schedLites', 'prodLites', 'reqLites', 'm2']);

// Every sort key a column actually offers. Used to validate what comes back
// from localStorage: an unknown key would fall through `compareRows`' switch
// and return undefined, which reads as "non-zero" in the comparator and skips
// the tiebreakers entirely.
const SORT_KEYS = new Set<string>(
  COLUMNS.map((c) => c.sortKey).filter((k): k is SortKey => !!k),
);
const isSortKey = (v: unknown): v is SortKey => typeof v === 'string' && SORT_KEYS.has(v);

// --- Column layout model ---------------------------------------------------

type Density = 'compact' | 'normal' | 'advanced';

// One column layout. Stored once per density (see TableSettings.layouts).
interface ColumnLayout {
  hidden: string[];
  pinned: string[];
  order: string[];
  // Widths the operator dragged. Honoured on screen and on paper.
  widths: Record<string, number>;
  // Widths pinned automatically when a resize starts, so the flexible columns
  // stop absorbing what the dragged one gives up (see `beginResize`). Screen
  // only: the print template weights columns by their intrinsic default, so
  // stretching a column on a wide monitor doesn't reshape the printed page.
  autoWidths: Record<string, number>;
}

interface TableSettings {
  // Bumped when a stored-shape or default-layout change needs a one-time
  // migration on load (see sanitiseTableSettings).
  version: number;
  sortKey: SortKey;
  sortDir: SortDir;
  // A separate column layout per density. Switching density swaps the active
  // layout, so the user's per-density customisations are each remembered.
  layouts: Record<Density, ColumnLayout>;
  // Filters are global — shared across densities.
  qualite: string[];
  pdp: string[];
  mtoMts: MtoFilter[];
  // Whether the œillet is open, greying finished lines back into the table.
  // Unlike the filters it survives a schedule change: an operator who wants to
  // see what is already done wants it on every schedule, and — showing rows
  // rather than hiding them — it can never be mistaken for "this schedule has
  // no work left".
  showFinished: boolean;
}

// Current settings schema version. v2 un-hid Article, v3 un-hid MTO/MTS, v4
// moved Req next to P/REQ, v5 moved PDP between Qualité and L/Pack, v6 un-hid
// PDP — see UNHID_AT_VERSION and REORDERED_AT_VERSION for the migrations
// applied on load.
const TABLE_SETTINGS_VERSION = 6;

// The planner's canonical ordering: widest dimension first, which is also what
// the longueur group-break rows are built around. It is carried by the
// Dimension header — hidden by default in compact/normal — so `toggleSort` has
// to offer a way back to it that doesn't depend on that column being visible.
const DEFAULT_SORT_KEY: SortKey = 'longueur';
const DEFAULT_SORT_DIR: SortDir = 'desc';

// Direction a column takes on its first click: numeric and date columns read
// best high-to-low, text A-to-Z. Shared with the header so its tooltip can
// name the click that actually follows.
const DESC_FIRST_SORT_KEYS: readonly SortKey[] = [
  'longueur', 'schedLites', 'prodLites', 'reqLites', 'opTm', 'm2', 'dateDepart',
  'litesPerPack',
];
const firstSortDir = (key: SortKey): SortDir =>
  DESC_FIRST_SORT_KEYS.includes(key) ? 'desc' : 'asc';

// Columns that became default-visible at a given settings version. A layout
// stored before that version gets the column un-hidden once on load, so the
// new default reaches existing per-density layouts without a manual reset.
const UNHID_AT_VERSION: { version: number; key: string }[] = [
  { version: 2, key: 'itemName' },
  { version: 3, key: 'mtoMts' },
  { version: 6, key: 'pdp' },
];

// Most recent settings version at which DEFAULT_ORDER changed. A layout stored
// before it keeps its own `order`, which would pin the old arrangement forever
// — so the canonical order is re-applied once. Visibility, pinning and widths
// survive; only a deliberate drag order is lost, and only on that upgrade.
const REORDERED_AT_VERSION = 5;

// Canonical column order shared by every density default. Quality / pack /
// production numbers come before format / pdp so the eye sweeps the
// "what fits in a pack and what's left to make" cluster first. Req sits right
// after P/REQ — the two are read together, packs against lites remaining —
// with Sched / Prod behind them as the backing detail.
const DEFAULT_ORDER = [
  'mtoMts', 'dateDepart', 'mo', 'product', 'itemName',
  'qualite', 'pdp', 'litesPerPack', 'packsReq',
  'reqLites', 'schedLites', 'prodLites',
  'opTm', 'format', 'm2',
];

// Per-density default visibility. Compact strips the page down to just
// production maths + m². Normal adds MO / Product identification. Advanced
// also reveals the format. Départ, opTm, pdp stay opt-in across the board
// (rarely scanned, available via the Colonnes menu).
const DENSITY_DEFAULT_HIDDEN: Record<Density, string[]> = {
  compact:  ['dateDepart', 'mo', 'product', 'opTm', 'format'],
  normal:   ['dateDepart', 'opTm', 'format'],
  advanced: ['dateDepart', 'opTm'],
};

function defaultColumnLayout(density: Density): ColumnLayout {
  return {
    hidden: [...DENSITY_DEFAULT_HIDDEN[density]],
    pinned: [],
    order: [...DEFAULT_ORDER],
    widths: {},
    autoWidths: {},
  };
}

// Migrate stored settings across column renames. When a column key changes
// (e.g. `scraps` → `opTm`), translate references in older saved layouts so the
// user's drag order / width survive the upgrade instead of being dropped.
const COLUMN_KEY_MIGRATIONS: Record<string, string> = { scraps: 'opTm' };
const migrateKey = (k: string): string => COLUMN_KEY_MIGRATIONS[k] ?? k;

// Sanitise one stored column layout: migrate renamed keys, drop keys that no
// longer match a real column. A missing layout falls back to the density default.
function sanitiseColumnLayout(raw: Partial<ColumnLayout> | undefined, density: Density): ColumnLayout {
  if (!raw || typeof raw !== 'object') return defaultColumnLayout(density);
  const known = new Set(COLUMNS.map((c) => c.key));
  const dedupe = (arr: unknown): string[] =>
    Array.isArray(arr)
      ? Array.from(new Set(arr.map((k) => migrateKey(String(k))).filter((k) => known.has(k))))
      : [];
  const numbers = (raw: unknown): Record<string, number> =>
    Object.fromEntries(
      Object.entries((raw ?? {}) as Record<string, number>)
        .map(([k, v]) => [migrateKey(k), v] as [string, number])
        .filter(([k, v]) => known.has(k) && Number.isFinite(v)),
    );
  return {
    hidden: dedupe(raw.hidden),
    pinned: dedupe(raw.pinned),
    order: dedupe(raw.order),
    widths: numbers(raw.widths),
    autoWidths: numbers(raw.autoWidths),
  };
}

// Build a complete TableSettings from whatever localStorage holds. The
// pre-per-density flat shape (top-level hidden/pinned/order/widths) carries no
// `layouts` key, so those installs start every density from its default —
// which is also exactly what the user now expects from density switching.
function sanitiseTableSettings(raw: Record<string, unknown>): TableSettings {
  const rawLayouts = (raw.layouts ?? {}) as Partial<Record<Density, ColumnLayout>>;
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  const storedVersion = typeof raw.version === 'number' ? raw.version : 1;
  const layouts: Record<Density, ColumnLayout> = {
    compact: sanitiseColumnLayout(rawLayouts.compact, 'compact'),
    normal: sanitiseColumnLayout(rawLayouts.normal, 'normal'),
    advanced: sanitiseColumnLayout(rawLayouts.advanced, 'advanced'),
  };
  // Replay each "column became default-visible" migration the stored layout
  // is behind on, so the new defaults reach existing layouts without a reset.
  for (const { version, key } of UNHID_AT_VERSION) {
    if (storedVersion >= version) continue;
    for (const d of ['compact', 'normal', 'advanced'] as Density[]) {
      layouts[d] = { ...layouts[d], hidden: layouts[d].hidden.filter((k) => k !== key) };
    }
  }
  if (storedVersion < REORDERED_AT_VERSION) {
    for (const d of ['compact', 'normal', 'advanced'] as Density[]) {
      layouts[d] = { ...layouts[d], order: [...DEFAULT_ORDER] };
    }
  }
  return {
    version: TABLE_SETTINGS_VERSION,
    sortKey: (() => {
      const migrated = migrateKey(typeof raw.sortKey === 'string' ? raw.sortKey : DEFAULT_SORT_KEY);
      return isSortKey(migrated) ? migrated : DEFAULT_SORT_KEY;
    })(),
    sortDir: raw.sortDir === 'asc' ? 'asc' : DEFAULT_SORT_DIR,
    layouts,
    qualite: arr(raw.qualite),
    pdp: arr(raw.pdp),
    mtoMts: arr(raw.mtoMts) as MtoFilter[],
    // Absent from every layout stored before the œillet existed, and `false` is
    // exactly what those installs were doing — so no version bump is owed here.
    showFinished: raw.showFinished === true,
  };
}

// Take the user's saved order, drop keys we no longer know about, and append
// any newly-introduced columns at the end. Used wherever we need a complete
// canonical ordering of column keys.
function completeColumnOrder(saved: string[]): string[] {
  const known = new Set(COLUMNS.map((c) => c.key));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const k of saved) if (known.has(k) && !seen.has(k)) { result.push(k); seen.add(k); }
  for (const c of COLUMNS) if (!seen.has(c.key)) result.push(c.key);
  return result;
}

// All columns in pinned-first display order, regardless of visibility. Used by
// the Colonnes menu so the user can see and reorder hidden columns too.
function orderedAllColumns(layout: Pick<ColumnLayout, 'pinned' | 'order'>): ColumnDef[] {
  const known = new Map(COLUMNS.map((c) => [c.key, c]));
  const ordered = completeColumnOrder(layout.order).map((k) => known.get(k)!);
  const pinSet = new Set(layout.pinned);
  return [
    ...ordered.filter((c) => pinSet.has(c.key)),
    ...ordered.filter((c) => !pinSet.has(c.key)),
  ];
}

function compareRows(a: DisplayRow, b: DisplayRow, key: SortKey, dir: SortDir): number {
  const sign = dir === 'asc' ? 1 : -1;
  switch (key) {
    case 'longueur':   return sign * (a.longueur - b.longueur);
    case 'schedLites': return sign * (a.schedLites - b.schedLites);
    case 'prodLites':  return sign * ((a.prodLites ?? 0) - (b.prodLites ?? 0));
    case 'reqLites':   return sign * (a.reqLites - b.reqLites);
    case 'opTm':       return sign * ((a.opTm ?? 0) - (b.opTm ?? 0));
    case 'm2':         return sign * (a.m2 - b.m2);
    case 'packsReq':   return sign * (packsReq(a) - packsReq(b));
    // Absent on rows the portal didn't give a pack size for; 0 keeps them
    // together at one end rather than scattering them through the order.
    case 'litesPerPack': return sign * ((a.litesPerPack ?? 0) - (b.litesPerPack ?? 0));
    case 'dateDepart': return sign * String(a.dateDepart || '').localeCompare(String(b.dateDepart || ''));
    case 'mo':         return sign * String(a.mo || '').localeCompare(String(b.mo || ''));
    // 'MTO' / 'MTS', or '?' where the policy sheet has no line for the
    // product — which sorts ahead of both, so ascending opens on exactly the
    // rows whose policy nobody has filled in.
    case 'mtoMts':     return sign * String(a.mtoMts || '').localeCompare(String(b.mtoMts || ''));
    case 'product':    return sign * String(a.product || '').localeCompare(String(b.product || ''));
    case 'itemName':   return sign * String(a.itemName || '').localeCompare(String(b.itemName || ''));
    case 'qualite':    return sign * String(a.qualite || '').localeCompare(String(b.qualite || ''));
    case 'pdp':        return sign * String(a.pdp || '').localeCompare(String(b.pdp || ''));
  }
}

// Whole packs covered by the remaining requirement. Floor — the leftover
// (reqLites % litesPerPack) is signalled in the cell by a danger style
// instead of being rounded away into an extra pack.
function packsReq(r: Pick<PMS230Record, 'reqLites' | 'litesPerPack'>): number {
  if (!r.litesPerPack || r.litesPerPack <= 0) return 0;
  if (!r.reqLites || r.reqLites <= 0) return 0;
  return Math.floor(r.reqLites / r.litesPerPack);
}

function packsReqShort(r: Pick<PMS230Record, 'reqLites' | 'litesPerPack'>): boolean {
  if (!r.litesPerPack || r.litesPerPack <= 0) return false;
  if (!r.reqLites || r.reqLites <= 0) return false;
  return r.reqLites % r.litesPerPack !== 0;
}

function describePMS230(r: PMS230Result): string {
  const records = r.records?.length ?? 0;
  const schedules = r.schedules?.length ?? 0;
  const m2 = totalM2(r.records ?? []);
  return `✓ ${records} lignes · ${schedules} schedule${schedules > 1 ? 's' : ''} · ${fmtNum(m2, 2)} m²`;
}

function describePolicy(r: PolicyResult): string {
  return `✓ ${r.count} produits chargés`;
}

function retireConfirmBody(data: PMS230Result, schedule: string): string {
  const records = data.records.filter((r) => r.schedule === schedule).length;
  return (
    // The count is interpolated on both branches, singular included: a sync can
    // drop the schedule while the dialog sits open, and "1 ligne quitte le
    // planning" over an empty schedule would be the sheet inventing a row.
    (records > 1
      ? `${records} lignes quittent le planning et rejoignent la liste des terminés. `
      : `${records} ligne quitte le planning et rejoint la liste des terminés. `)
    + 'Rien ne sort du rapport : le schedule reste consultable depuis cette liste.'
  );
}

function fmtDate(yyyymmdd: string | null | undefined): string {
  if (!yyyymmdd || yyyymmdd.length !== 8) return '';
  return `${yyyymmdd.slice(6)}/${yyyymmdd.slice(4, 6)}`;
}

// Coater speed (m/min) per schedule number. Shared: the speed is a property of
// the schedule, so whoever sets it sets it for everyone.
type SpeedMap = Record<string, number>;

// Keep only entries that can drive `minutesAt`. Anything else — a string left
// by an older build, null, NaN, a negative — is dropped rather than carried,
// so a bad value can't outlive the tab that wrote it.
function sanitiseSpeeds(raw: unknown): SpeedMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: SpeedMap = {};
  for (const [schedule, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) out[schedule] = n;
  }
  return out;
}

// Schedules retired from the planning by hand, against the moment it happened
// (ISO). Shared like the speeds: a schedule the line has set aside is set aside
// for the planning room too. Nothing renders the date today — the sheet lists
// the schedule, not when it left — but it is the only trace of when the
// decision was taken, and it costs a dozen bytes to keep.
type ArchiveMap = Record<string, string>;

// The same map minus a few schedules. Returns `prev` untouched when none of
// them were in it, so a no-op can't queue a pointless sync write.
function withoutSchedules<T>(prev: Record<string, T>, gone: ReadonlySet<string>): Record<string, T> {
  const kept = Object.entries(prev).filter(([schedule]) => !gone.has(schedule));
  return kept.length === Object.keys(prev).length ? prev : Object.fromEntries(kept);
}

// Same defensive read as `sanitiseSpeeds`. Anything that isn't a date string is
// dropped — an entry with a junk value would still hide a schedule from the
// rail, with nothing to say when or why it went.
function sanitiseArchives(raw: unknown): ArchiveMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: ArchiveMap = {};
  for (const [schedule, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value) out[schedule] = value;
  }
  return out;
}

function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return '';
  return n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

interface SchedulesProps {
  density: Density;
  // Which of the two paper layouts the view prints as. Owned by App, which
  // holds the single `@page` rule the orientation depends on and the aperçu bar
  // the choice is made in — see PAGE_SIZE_STYLE_ID there.
  printMode: SchedPrintMode;
}

export default function Schedules({ density, printMode }: SchedulesProps) {
  // Every domain syncs, the PMS230 report included — the per-operator
  // local-only toggle it used to honour is gone.
  const dataInit = useCallback(() => load<PMS230Result | null>(KEY_DATA, null), []);
  const [data, setData] = useSyncedState<PMS230Result | null>(
    KEY_DATA,
    { domain: 'schedules', params: {} },
    dataInit,
    // The bookmarklet writes this partition from the Infor portal, so the
    // report can change without anybody touching this screen. Follow it rather
    // than sitting on whatever was there at mount.
    { live: true },
  );
  const policyInit = useCallback(() => load<PolicyResult | null>(KEY_POLICY, null), []);
  const [policy, setPolicy] = useSyncedState<PolicyResult | null>(
    KEY_POLICY,
    { domain: 'policy', params: {} },
    policyInit,
    // Rarely reimported, but when it is, every screen should start colouring
    // MTO/MTS the new way at once.
    { live: true },
  );
  const speedsInit = useCallback(() => sanitiseSpeeds(load<unknown>(KEY_SPEEDS, {})), []);
  const [speeds, setSpeeds] = useSyncedState<SpeedMap>(
    KEY_SPEEDS,
    { domain: 'speeds', params: {} },
    speedsInit,
    // Same reasoning as the report: the planning room and the line run this on
    // two screens, and a speed set on one has to reach the other without a
    // reload — that is the whole point of hanging it off the schedule.
    { live: true },
  );
  const archivesInit = useCallback(() => sanitiseArchives(load<unknown>(KEY_ARCHIVES, {})), []);
  const [archives, setArchives] = useSyncedState<ArchiveMap>(
    KEY_ARCHIVES,
    { domain: 'archives', params: {} },
    archivesInit,
    // Retiring a schedule changes what the planning *is*, so it has to reach
    // the other screen as fast as an import does — otherwise the line and the
    // planning room work from two different rails.
    { live: true },
  );
  const [selected, setSelected] = useState<string | null>(null);
  // What the operator is currently typing in the Vitesse field, or null when it
  // just mirrors the stored value. Without it, clearing the box would snap it
  // back to "0" mid-edit and the next keystroke would land after that zero.
  const [speedDraft, setSpeedDraft] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<'pms230' | 'policy' | 'portal' | null>(null);
  // Schedule number waiting on the retire confirmation, or null.
  const [pendingRetire, setPendingRetire] = useState<string | null>(null);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [finishedOpen, setFinishedOpen] = useState(false);
  const [tableSettings, setTableSettings] = useState<TableSettings>(
    () => sanitiseTableSettings(load<Record<string, unknown>>(KEY_TABLE, {})),
  );
  // Column layout for the density currently in effect. Switching density
  // (a prop change from App) swaps this to the matching stored layout.
  const layout = tableSettings.layouts[density];
  const [colsMenuOpen, setColsMenuOpen] = useState(false);
  const toast = useToast();

  useEffect(() => { save(KEY_TABLE, tableSettings); }, [tableSettings]);

  const openRow = useMemo(
    () => (data?.records ?? []).find((r) => r.id === openRowId) ?? null,
    [data, openRowId],
  );

  const handleRowOpen = useCallback((row: DisplayRow) => setOpenRowId(row.id), []);

  // Speed of the schedule on screen. A schedule nobody has set one on — a new
  // one straight out of an import — starts at 0.
  const vitesse = selected ? speeds[selected] ?? DEFAULT_SPEED : DEFAULT_SPEED;

  function setVitesse(next: number) {
    if (!selected) return;
    setSpeeds((prev) => ({ ...prev, [selected]: next }));
  }

  // Drop the draft when the selection moves: it belongs to the field of the
  // schedule that was on screen, not to the one that just replaced it.
  useEffect(() => { setSpeedDraft(null); }, [selected]);

  // What the field shows. A draft only stands while it still describes the
  // stored speed — every keystroke commits, so the two agree until something
  // else moves the value. When that happens (another poste setting the speed of
  // this schedule) the half-typed text steps aside rather than hiding it.
  const speedText =
    speedDraft !== null && Number(speedDraft === '' ? 0 : speedDraft) === vitesse
      ? speedDraft
      : String(vitesse);

  const schedules = data?.schedules ?? [];

  // Decorate with the planning policy, apply the user-driven filters
  // (qualité / pdp / mtoMts) and sort. Shared by the planning rows and by the
  // finished ones, so the two are narrowed and ordered the same way — finished
  // lines that ignored the active filters would contradict the rows they sit
  // between. Default sort matches the planner's Excel formula
  // (longueur DESC, PDP DESC, name ASC).
  //
  // Pinned to the five settings it actually reads rather than to
  // `tableSettings` as a whole: dragging a column width or opening the œillet
  // would otherwise rebuild every row for a change no row depends on.
  const { qualite, pdp, mtoMts, sortKey, sortDir } = tableSettings;
  const prepareRows = useCallback((records: PMS230Record[]): DisplayRow[] => {
    const policyMap = policy?.map ?? {};
    const rows: DisplayRow[] = records
      .map((r) => ({ ...r, mtoMts: policyMap[r.product] ?? '?' }))
      .filter((r) => {
        if (qualite.length > 0 && !qualite.includes(r.qualite)) return false;
        if (pdp.length > 0 && !pdp.includes(r.pdp)) return false;
        if (mtoMts.length > 0 && !mtoMts.includes(r.mtoMts as MtoFilter)) return false;
        return true;
      });

    rows.sort((a, b) => {
      const primary = compareRows(a, b, sortKey, sortDir);
      if (primary !== 0) return primary;
      // Stable secondary tiebreakers preserving the planner's intent.
      if (sortKey !== DEFAULT_SORT_KEY && b.longueur !== a.longueur) return b.longueur - a.longueur;
      if ((b.pdp || '') !== (a.pdp || '')) return (b.pdp || '').localeCompare(a.pdp || '');
      return (a.itemName || '').localeCompare(b.itemName || '');
    });

    return rows;
  }, [policy, qualite, pdp, mtoMts, sortKey, sortDir]);

  // The rows of the selected schedule worth putting on screen, split into the
  // planning proper and the finished lines the œillet brings back. QC samples
  // are in neither list — they leave the view here and never come back.
  const [planningRecords, finishedRecords] = useMemo(() => {
    const planning: PMS230Record[] = [];
    const finished: PMS230Record[] = [];
    for (const r of data?.records ?? []) {
      if (r.schedule !== selected || isQcSample(r)) continue;
      (isFinished(r) ? finished : planning).push(r);
    }
    return [planning, finished];
  }, [data, selected]);

  const visibleRows: DisplayRow[] = useMemo(
    () => prepareRows(planningRecords),
    [planningRecords, prepareRows],
  );

  // Built whatever the œillet's state: closed, its count is what the œillet
  // offers; open, these are the rows that grey into the table.
  const finishedRows: DisplayRow[] = useMemo(
    () => prepareRows(finishedRecords),
    [finishedRecords, prepareRows],
  );

  // What the table paints. With the œillet open the finished lines are sorted
  // in among the planning rather than stacked under the total: a line that has
  // been produced belongs where it sat while it was being produced — in its
  // dimension group, between the same neighbours — and the grey is what says
  // it is done. The totals never see this list; they stay on visibleRows.
  const tableRows: DisplayRow[] = useMemo(
    () => (tableSettings.showFinished && finishedRecords.length > 0
      ? prepareRows([...planningRecords, ...finishedRecords])
      : visibleRows),
    [tableSettings.showFinished, planningRecords, finishedRecords, prepareRows, visibleRows],
  );

  // Available filter values come from the unfiltered, schedule-scoped pool so
  // the menu doesn't shrink as the user picks options.
  const availableFilters = useMemo(() => {
    const policyMap = policy?.map ?? {};
    const qualites = new Set<string>();
    const pdps = new Set<string>();
    const mtos = new Set<string>();
    for (const r of planningRecords) {
      if (r.qualite) qualites.add(r.qualite);
      if (r.pdp) pdps.add(r.pdp);
      mtos.add(policyMap[r.product] ?? '?');
    }
    return {
      qualites: [...qualites].sort(),
      pdps: [...pdps].sort(),
      mtos: [...mtos].sort(),
    };
  }, [planningRecords, policy]);

  const filteringActive =
    tableSettings.qualite.length > 0 ||
    tableSettings.pdp.length > 0 ||
    tableSettings.mtoMts.length > 0;

  // The controls bar is no-print, so on paper nothing would otherwise betray
  // that the rows were narrowed or re-ordered — and the total is computed on
  // the filtered set, so the sheet would read as a complete planning.
  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (tableSettings.mtoMts.length > 0) parts.push(`MTO/MTS ${tableSettings.mtoMts.join(', ')}`);
    if (tableSettings.qualite.length > 0) parts.push(`Qualité ${tableSettings.qualite.join(', ')}`);
    if (tableSettings.pdp.length > 0) parts.push(`PDP ${tableSettings.pdp.join(', ')}`);
    return parts.join(' · ');
  }, [tableSettings.mtoMts, tableSettings.qualite, tableSettings.pdp]);

  const sortSummary = useMemo(() => {
    const col = COLUMNS.find((c) => c.sortKey === tableSettings.sortKey);
    return `${col?.label ?? tableSettings.sortKey} ${tableSettings.sortDir === 'asc' ? '↑' : '↓'}`;
  }, [tableSettings.sortKey, tableSettings.sortDir]);

  // Same job as filterSummary, for the œillet: on paper the grey has to be
  // named. A reader who was not the one to open it sees rows the total does not
  // count and nothing to tell them why — the tone alone won't say it, and a
  // photocopy may not keep it at all. Empty when the œillet is shut.
  const finishedSummary =
    tableSettings.showFinished && finishedRows.length > 0
      ? `${finishedRows.length} ligne${finishedRows.length > 1 ? 's' : ''} `
        + `terminée${finishedRows.length > 1 ? 's' : ''} en grisé, hors total`
      : '';

  function toggleSort(key: SortKey) {
    setTableSettings((s) => {
      const firstDir = firstSortDir(key);
      if (s.sortKey !== key) return { ...s, sortKey: key, sortDir: firstDir };
      // Cycle on the active column: preferred direction, then the other, then
      // back to the dimension sort. Without that third step the default is a
      // dead end whenever Dimension is hidden, which it is by default.
      if (s.sortDir === firstDir) {
        return { ...s, sortDir: firstDir === 'asc' ? 'desc' : 'asc' };
      }
      return { ...s, sortKey: DEFAULT_SORT_KEY, sortDir: DEFAULT_SORT_DIR };
    });
  }

  function toggleFilterValue(field: 'qualite' | 'pdp' | 'mtoMts', value: string) {
    setTableSettings((s) => {
      const list = s[field] as string[];
      const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
      return { ...s, [field]: next } as TableSettings;
    });
  }

  function clearFilters() {
    setTableSettings((s) => ({ ...s, qualite: [], pdp: [], mtoMts: [] }));
  }

  function toggleShowFinished() {
    setTableSettings((s) => ({ ...s, showFinished: !s.showFinished }));
  }

  // Apply a change to the active density's column layout, leaving the other
  // densities' stored layouts untouched.
  function updateLayout(fn: (l: ColumnLayout) => ColumnLayout) {
    setTableSettings((s) => ({ ...s, layouts: { ...s.layouts, [density]: fn(s.layouts[density]) } }));
  }

  function toggleColumnVisibility(key: string) {
    updateLayout((l) => ({
      ...l,
      hidden: l.hidden.includes(key) ? l.hidden.filter((k) => k !== key) : [...l.hidden, key],
    }));
  }

  function togglePinned(key: string) {
    updateLayout((l) => ({
      ...l,
      pinned: l.pinned.includes(key) ? l.pinned.filter((k) => k !== key) : [...l.pinned, key],
    }));
  }

  function moveColumn(key: string, dir: -1 | 1) {
    updateLayout((l) => {
      const order = completeColumnOrder(l.order);
      const i = order.indexOf(key);
      if (i < 0) return l;
      // Only reorder within the same pinned/unpinned group so the visual order
      // matches the pinned-first rendering.
      const isPinned = l.pinned.includes(key);
      let j = i + dir;
      while (j >= 0 && j < order.length && l.pinned.includes(order[j]!) !== isPinned) j += dir;
      if (j < 0 || j >= order.length) return l;
      const next = order.slice();
      [next[i], next[j]] = [next[j]!, next[i]!];
      return { ...l, order: next };
    });
  }

  function reorderColumn(fromKey: string, toKey: string) {
    if (fromKey === toKey) return;
    updateLayout((l) => {
      // Cross-group drops are ignored to keep pinned columns grouped to the left.
      if (l.pinned.includes(fromKey) !== l.pinned.includes(toKey)) return l;
      const order = completeColumnOrder(l.order);
      const fromIdx = order.indexOf(fromKey);
      const toIdx = order.indexOf(toKey);
      if (fromIdx < 0 || toIdx < 0) return l;
      const next = order.slice();
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved!);
      return { ...l, order: next };
    });
  }

  function setColumnWidth(key: string, px: number) {
    // Clamp so a runaway drag can't push a column to thousands of pixels or
    // below the minimum useful width. Reject NaN/Infinity outright — Math.min
    // and Math.max propagate NaN and we'd persist it to localStorage.
    if (!Number.isFinite(px)) return;
    updateLayout((l) => {
      const autoWidths = { ...l.autoWidths };
      delete autoWidths[key];
      return { ...l, widths: { ...l.widths, [key]: clampColumnPx(px) }, autoWidths };
    });
  }

  // Pin the flexible columns at their rendered width when a resize starts, so
  // they stop absorbing the space the dragged column gives up (see
  // `beginResize`). Only fills gaps: a column the user already sized keeps it.
  function freezeColumnWidths(px: Record<string, number>) {
    updateLayout((l) => {
      const autoWidths = { ...l.autoWidths };
      let changed = false;
      for (const [key, value] of Object.entries(px)) {
        if (l.widths[key] || autoWidths[key] || !Number.isFinite(value)) continue;
        autoWidths[key] = clampColumnPx(value);
        changed = true;
      }
      return changed ? { ...l, autoWidths } : l;
    });
  }

  function resetTableLayout() {
    // Reset the active density back to its canonical default, sort included —
    // "Réinitialiser" is where users look for the dimension order once they've
    // sorted on something else. The other densities keep what the user set.
    setTableSettings((s) => ({
      ...s,
      sortKey: DEFAULT_SORT_KEY,
      sortDir: DEFAULT_SORT_DIR,
      layouts: { ...s.layouts, [density]: defaultColumnLayout(density) },
    }));
  }

  const visibleColumns = useMemo(
    () => orderedAllColumns(layout).filter((c) => !layout.hidden.includes(c.key)),
    [layout],
  );

  // Insert a break marker before each new longueur group (including the first).
  // Carries the longueur so the break row can render a section label.
  //
  // Keyed by the row that opens the group, not by the dimension change that
  // caused it. Under any sort other than Dimension the rows no longer arrive in
  // dimension order, so the same change — 5850 → 5845, say — comes round more
  // than once; keying on it gave two <tr> the same React key, and re-sorting
  // then left stale headers stacked at the top of the table with no rows under
  // them. Row ids are unique, so a break inherits that.
  const groupedRows: GroupedItem[] = useMemo(() => {
    const out: GroupedItem[] = [];
    let prevLongueur: number | null = null;
    for (const r of tableRows) {
      if (r.longueur !== prevLongueur) {
        out.push({ kind: 'break', id: `break-${r.id}`, longueur: r.longueur });
      }
      out.push({ kind: 'row', row: r });
      prevLongueur = r.longueur;
    }
    return out;
  }, [tableRows]);

  const coaterRows = useMemo(
    () => visibleRows.filter((r) => r.workCenter === 'Coater'),
    [visibleRows],
  );
  // Time still needed for the visible Coater rows at the current speed. Uses
  // reqLites under the hood so the value aligns with the m² restants total
  // and matches the Excel reference. coaterMinDt adds the 9 % downtime
  // factor. Both feed the hero stat tiles and the print throughput subline.
  const coaterMin = minutesAt(coaterRows, vitesse);
  const coaterMinDt = coaterMin != null ? coaterMin * DOWNTIME_FACTOR : null;

  // Stats per schedule, recomputed against the same filters so the rail and
  // detail header mirror what the user actually sees in the table.
  const railStats = useMemo(() => {
    const stats = new Map<string, RailStat>();
    // shortName tallies kept aside — they only feed the dominant-name pick
    // below, they're not part of the RailStat shape the UI consumes.
    const nameTally = new Map<string, Map<string, number>>();
    for (const r of data?.records ?? []) {
      // Planning rows only — the rail counts work left to do, so the set-aside
      // families take no part in it whatever the œillet is showing.
      if (!isPlanningRow(r)) continue;
      let cur = stats.get(r.schedule);
      if (!cur) {
        cur = { count: 0, m2: 0, shortName: '' };
        stats.set(r.schedule, cur);
        nameTally.set(r.schedule, new Map());
      }
      cur.count += 1;
      cur.m2 += r.m2;
      const short = shortItemName(r.itemName);
      if (short) {
        const tally = nameTally.get(r.schedule)!;
        tally.set(short, (tally.get(short) ?? 0) + 1);
      }
    }
    // Resolve the dominant short name per schedule from the full itemNames so
    // the rail isn't tied to the (potentially lossy) cached itemRoot.
    for (const [schedule, stat] of stats) {
      let best = '';
      let bestCount = 0;
      for (const [name, n] of nameTally.get(schedule) ?? []) {
        if (n > bestCount) { best = name; bestCount = n; }
      }
      stat.shortName = best;
    }
    return stats;
  }, [data]);

  // Hide schedules with no remaining surface to coat — covers the case where
  // every surviving row has largeur=longueur=0 (QC-style samples) — and those
  // the line has retired by hand. Both leave by the same door: the rail lists
  // work to do, and neither is any.
  const visibleSchedules = useMemo(
    () => schedules.filter(
      (s) => (railStats.get(s.schedule)?.m2 ?? 0) > 0 && !archives[s.schedule],
    ),
    [schedules, railStats, archives],
  );

  // The other side of that filter: every schedule that has left the rail,
  // whether it ran out of work or was retired. They have no place in a list of
  // work to do, but they are the record of what the line has already made — so
  // they get a sheet of their own, from which any of them can be opened in the
  // table.
  //
  // QC samples are left out here as everywhere else, which also settles what a
  // sample-only schedule is doing in a list headed "terminés": nothing — it
  // ends up with no rows and drops out.
  const finishedSchedules: FinishedSchedule[] = useMemo(() => {
    const visible = new Set(visibleSchedules.map((s) => s.schedule));
    const tally = new Map<string, { count: number; lites: number; m2: number; planning: number }>();
    for (const r of data?.records ?? []) {
      if (visible.has(r.schedule) || isQcSample(r)) continue;
      const cur = tally.get(r.schedule) ?? { count: 0, lites: 0, m2: 0, planning: 0 };
      cur.count += 1;
      cur.lites += r.prodLites ?? 0;
      cur.m2 += r.m2;
      if (isPlanningRow(r)) cur.planning += 1;
      tally.set(r.schedule, cur);
    }
    return schedules
      .filter((s) => tally.has(s.schedule))
      .map((s) => ({
        schedule: s.schedule,
        name: shortItemName(s.itemRoot) || s.itemRoot || '—',
        ...tally.get(s.schedule)!,
      }));
  }, [schedules, visibleSchedules, data]);

  // Only for the sheet's subtitle, which cannot claim "sans reste à produire"
  // over a list where some rows were pulled out with work still in them.
  const retiredCount = useMemo(
    () => finishedSchedules.filter((s) => archives[s.schedule]).length,
    [finishedSchedules, archives],
  );

  // Nothing left to list — close the sheet rather than leave an empty dialog
  // standing after the last row went back to the planning.
  useEffect(() => {
    if (finishedSchedules.length === 0) setFinishedOpen(false);
  }, [finishedSchedules.length]);

  // Auto-select once data loads, and re-pick when the selection is gone from
  // the report entirely — nothing here removes a schedule, but a re-import can
  // land without one.
  //
  // Absent from the *rail* is not gone: a finished schedule opened from the
  // terminés sheet is legitimately selected while having no place in a list of
  // work to do, and re-picking around it would bounce the operator straight
  // back out of what they just opened.
  useEffect(() => {
    if (!data) return;
    if (selected && schedules.some((s) => s.schedule === selected)) return;
    const next = visibleSchedules[0]?.schedule ?? null;
    setSelected(next);
    // A forced re-pick is a selection change like any other, so the filters go
    // with it (see selectSchedule). `selected` is null on the first load —
    // nothing was selected to move away from, and the operator's stored filters
    // survive a reload.
    if (selected && next !== selected) clearFilters();
  }, [data, selected, schedules, visibleSchedules]);

  // Open a schedule from the terminés sheet in the table. The œillet goes with
  // it when the schedule has no planning row left — all its rows are finished,
  // so leaving it shut would answer the click with an empty table. A retired
  // schedule still has work in it and needs no such help; forcing the œillet
  // there would grey nothing and change a setting the operator didn't touch.
  function openFinished(item: FinishedSchedule) {
    setFinishedOpen(false);
    if (item.planning === 0) setTableSettings((s) => ({ ...s, showFinished: true }));
    selectSchedule(item.schedule);
  }

  const selectedSchedule = schedules.find((s) => s.schedule === selected);

  // Filters are global — one qualité/PDP/MTO set shared by every schedule. Kept
  // across a selection change they routinely match nothing in the schedule the
  // operator just opened, and an empty table reads as "this schedule has no
  // work", not "you filtered it away". Changing schedule resets them.
  function selectSchedule(schedule: string) {
    if (schedule === selected) return;
    setSelected(schedule);
    clearFilters();
  }

  // Retire a schedule from the planning: its rows stay in the report, it moves
  // to the terminés sheet. The rail gesture used to drop the schedule out of
  // the report outright, which is not this app's call to make on a report that
  // came from Infor — nothing removes one any more.
  function handleRetireSchedule(schedule: string) {
    if (archives[schedule]) return;
    const snapshotSelected = selected;
    const snapshotFilters = {
      qualite: tableSettings.qualite,
      pdp: tableSettings.pdp,
      mtoMts: tableSettings.mtoMts,
    };
    setArchives((prev) => ({ ...prev, [schedule]: new Date().toISOString() }));
    // The schedule is still in the report, so the auto-select effect has no
    // reason to move off it. Move on by hand: the card the operator was reading
    // has just left the rail, and staying on it would leave the table showing a
    // schedule nothing points at any more.
    if (selected === schedule) {
      setSelected(visibleSchedules.find((s) => s.schedule !== schedule)?.schedule ?? null);
      clearFilters();
    }
    toast.show({
      message: `Schedule ${schedule} retiré du planning`,
      ttl: LONG_TOAST_TTL,
      undo: () => {
        setArchives((prev) => withoutSchedules(prev, new Set([schedule])));
        setSelected(snapshotSelected);
        setTableSettings((s) => ({ ...s, ...snapshotFilters }));
      },
    });
  }

  function handlePms230Confirm(parsed: PMS230Result) {
    // Every import adds, whichever route it came in by. `mergePMS230` keys on
    // schedule|MO, so re-importing a page updates its rows rather than
    // duplicating them; retiring a schedule is done from the rail.
    const { result, purged } = mergePMS230(data, parsed);
    setData(result);
    setImportMode(null);
    if (purged.length === 0) return;
    // The trim took the oldest schedules to make room. Their speed and their
    // retirement have nothing left to hang off, and kept they would silently
    // apply to a re-import of the same number months later.
    forgetSchedules(purged);
    // Named, not just counted: what left may still have had lines to produce,
    // and the operator has to be able to go and re-import one if it mattered.
    const named = purged.slice(0, 3).join(', ') + (purged.length > 3 ? '…' : '');
    toast.show({
      message: `Rapport plein : ${purged.length} schedule${purged.length > 1 ? 's' : ''} `
        + `parmi les plus anciens purgé${purged.length > 1 ? 's' : ''} (${named})`,
      ttl: LONG_TOAST_TTL,
    });
  }

  // Drop every trace of schedules that have left the report. No undo: they went
  // because the report was full, and putting them back would fill it again.
  function forgetSchedules(numbers: string[]) {
    const gone = new Set(numbers);
    setSpeeds((prev) => withoutSchedules(prev, gone));
    setArchives((prev) => withoutSchedules(prev, gone));
  }
  function handlePolicyConfirm(parsed: PolicyResult) {
    const snapshot = policy;
    setPolicy(parsed);
    setImportMode(null);
    if (snapshot) {
      toast.show({
        message: 'Table MTO/MTS remplacée',
        undo: () => setPolicy(snapshot),
      });
    }
  }

  return (
    // The print mode is carried on the root rather than on <html>: the paper
    // rules only ever need it from inside this view, and `:has()` lets the
    // preview sheet pick its own width off the same class (see app.css).
    <div className={`sch${printMode === 'recap' ? ' is-print-recap' : ''}`}>
      <SummaryBar
        data={data}
        policy={policy}
        onImport={() => setImportMode('pms230')}
      />

      {/* `data` guards the sheet as well as the gesture: a sync from another
          device can empty the report while the dialog sits open, and there is
          then nothing left to confirm. */}
      {pendingRetire && data && (
        <ConfirmSheet
          title={`Retirer le schedule ${pendingRetire} du planning ?`}
          body={retireConfirmBody(data, pendingRetire)}
          confirmLabel="Retirer"
          onConfirm={() => handleRetireSchedule(pendingRetire)}
          onClose={() => setPendingRetire(null)}
        />
      )}

      {!data && (
        <div className="sch-empty">
          <h3>Aucun rapport importé</h3>
        </div>
      )}

      {data && !policy && (
        <div className="sch-hint">
          <span>↪ Importer la table <strong>Item number → Planning policy</strong> pour voir la colonne MTO/MTS.</span>
          <button className="btn mini" onClick={() => setImportMode('policy')} title="Ouvrir l'importation de la politique MTO/MTS">
            Importer
          </button>
        </div>
      )}

      {data && (
        <div className="sch-body">
          <aside className="sch-rail">
            <h4 className="sch-rail-title">
              <span>Planning <span className="faint">· {visibleSchedules.length}</span></span>
              {/* Way back to the schedules that have left the rail. Only shown
                  when there are any — on a fresh import there never are. */}
              {finishedSchedules.length > 0 && (
                <button
                  type="button"
                  className="sch-rail-done-btn"
                  onClick={() => setFinishedOpen(true)}
                  title={
                    retiredCount > 0
                      ? `Consulter les schedules terminés et les ${retiredCount} retiré${retiredCount > 1 ? 's' : ''} du planning`
                      : 'Consulter les schedules dont il ne reste rien à produire'
                  }
                >
                  {finishedSchedules.length} terminé{finishedSchedules.length > 1 ? 's' : ''}
                </button>
              )}
            </h4>
            <ul className="sch-rail-list">
              {visibleSchedules.map((s) => {
                const stat = railStats.get(s.schedule) ?? { count: 0, m2: 0, shortName: '' };
                return (
                  <li key={s.schedule}>
                    <SwipeToRetire onRetire={() => setPendingRetire(s.schedule)}>
                      <button
                        type="button"
                        className={`sch-rail-item ${selected === s.schedule ? 'active' : ''}`}
                        onClick={() => selectSchedule(s.schedule)}
                        // Keyboard equivalent of the swipe — the gesture is the
                        // only other way in, and it needs a pointer.
                        onKeyDown={(e) => {
                          if (e.key !== 'Delete' && e.key !== 'Backspace') return;
                          e.preventDefault();
                          setPendingRetire(s.schedule);
                        }}
                        title={`Schedule ${s.schedule} — glisser vers la gauche (ou touche Suppr) pour le retirer du planning ; il rejoint les terminés`}
                      >
                        <div className="sch-rail-top">
                          <span className="mono sch-rail-num">{s.schedule}</span>
                          <span className="sch-rail-root">{stat.shortName || shortItemName(s.itemRoot) || s.itemRoot || '—'}</span>
                        </div>
                        <div className="sch-rail-meta faint small mono">
                          {stat.count} ligne{stat.count > 1 ? 's' : ''} · {fmtNum(stat.m2, 0)} m²
                        </div>
                      </button>
                    </SwipeToRetire>
                  </li>
                );
              })}
            </ul>
          </aside>

          <section className="sch-detail">
            {/* Provenance + view state, paper only. The sheet leaves the
                screen without any of the app chrome, so it has to say where
                its rows came from and whether they are the whole picture.
                Sits above the title as a discreet top-of-sheet line, not as a
                band under the header — it is reference matter, not content.
                Row count is left out — the Total row already carries it. */}
            <div className="sch-print-meta print-only">
              {data?.importedAt && (
                <span>
                  rapport importé le{' '}
                  {new Date(data.importedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              )}
              <span>tri : {sortSummary}</span>
              {finishedSummary && <span>{finishedSummary}</span>}
              {filterSummary && <strong>filtré : {filterSummary}</strong>}
            </div>

            {selectedSchedule && (() => {
              const stat = railStats.get(selectedSchedule.schedule) ?? { count: 0, m2: 0, shortName: '' };
              const validSpeed = vitesse > 0;
              return (
                <header className="sch-detail-head">
                  <div className="sch-detail-head-id">
                    <h3>
                      <span className="mono sch-detail-head-num">{selectedSchedule.schedule}</span>
                      <span className="faint sch-detail-head-sep"> — </span>
                      <span className="sch-detail-head-name">{stat.shortName || shortItemName(selectedSchedule.itemRoot) || selectedSchedule.itemRoot}</span>
                    </h3>
                  </div>
                  <div className="sch-detail-head-stats">
                    <label className={`sch-stat-tile sch-stat-tile-input ${validSpeed ? '' : 'is-invalid'}`}>
                      <span className="sch-stat-tile-label">Vitesse</span>
                      <span className="sch-stat-tile-value">
                        <input
                          type="number"
                          // 0 is a real state here — "personne n'a encore réglé
                          // la vitesse" — so the field has to accept it rather
                          // than flag it as out of range.
                          min="0"
                          step="0.1"
                          className="sch-vitesse-input mono"
                          value={speedText}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setSpeedDraft(raw);
                            // An emptied field commits 0 — the same "not set"
                            // the schedule started from — while the draft keeps
                            // the box visually empty until focus leaves.
                            const n = raw === '' ? 0 : Number(raw);
                            if (Number.isFinite(n) && n >= 0) setVitesse(n);
                          }}
                          onBlur={() => setSpeedDraft(null)}
                          aria-label={`Vitesse du schedule ${selectedSchedule.schedule} en m/min`}
                          title="Vitesse du schedule — partagée avec les autres postes"
                        />
                        <span className="sch-vitesse-print mono" aria-hidden="true">{vitesse}</span>
                        <span className="sch-stat-tile-unit faint">m/min</span>
                      </span>
                    </label>
                    <div className="sch-stat-tile" title={`${coaterRows.length} lignes Coater`}>
                      <span className="sch-stat-tile-label">Production</span>
                      {/* is-empty dims the em-dash fallback: with no vitesse set
                          these read as loud as a real duration otherwise. */}
                      <strong className={`sch-stat-tile-value mono ${hasHMmin(coaterMin) ? '' : 'is-empty'}`}>
                        {fmtHMmin(coaterMin)}
                      </strong>
                    </div>
                    <div className="sch-stat-tile" title="Temps théorique majoré du facteur d'arrêts (DT, downtime) de 9 %">
                      <span className="sch-stat-tile-label">+ DT 9 %</span>
                      <strong className={`sch-stat-tile-value mono ${hasHMmin(coaterMinDt) ? '' : 'is-empty'}`}>
                        {fmtHMmin(coaterMinDt)}
                      </strong>
                    </div>
                  </div>
                </header>
              );
            })()}

            <TableControls
              settings={tableSettings}
              layout={layout}
              visibleColumns={visibleColumns}
              available={availableFilters}
              filteringActive={filteringActive}
              colsMenuOpen={colsMenuOpen}
              onColsMenuToggle={() => setColsMenuOpen((v) => !v)}
              onColsMenuClose={() => setColsMenuOpen(false)}
              finishedCount={finishedRows.length}
              showFinished={tableSettings.showFinished}
              onToggleFinished={toggleShowFinished}
              onToggleFilterValue={toggleFilterValue}
              onClearFilters={clearFilters}
              onToggleColumn={toggleColumnVisibility}
              onTogglePinned={togglePinned}
              onMoveColumn={moveColumn}
              onResetLayout={resetTableLayout}
            />

            <ScheduleTable
              items={groupedRows}
              totals={visibleRows}
              hiddenFinished={tableSettings.showFinished ? 0 : finishedRows.length}
              onRowOpen={handleRowOpen}
              columns={visibleColumns}
              pinned={layout.pinned}
              widths={layout.widths}
              autoWidths={layout.autoWidths}
              onResize={setColumnWidth}
              onFreezeWidths={freezeColumnWidths}
              onReorder={reorderColumn}
              sortKey={tableSettings.sortKey}
              sortDir={tableSettings.sortDir}
              onSort={toggleSort}
            />

            {/* The second paper layout. Mounted alongside the table rather than
                in its place: the table stays the screen's working tool, and the
                paper rules swap which of the two is printed. Fed the same rows
                the Total row counts, so the two sheets can't disagree. */}
            {printMode === 'recap' && selectedSchedule && (
              <ScheduleRecap
                rows={visibleRows}
                schedule={selectedSchedule}
                shortName={railStats.get(selectedSchedule.schedule)?.shortName ?? ''}
                importedAt={data?.importedAt}
                filterSummary={filterSummary}
              />
            )}

          </section>
        </div>
      )}

      {importMode === 'pms230' && (
        <PasteImport<PMS230Result>
          title="Importer le rapport Operator Mashup"
          hint="Dans l'Operator Mashup, faites votre recherche. Ctrl+A puis Ctrl+C, et coller ci-dessous."
          parser={parsePMS230}
          describe={describePMS230}
          confirmLabel="Ajouter"
          onConfirm={handlePms230Confirm}
          onClose={() => setImportMode(null)}
          headerActions={
            <>
              <button
                type="button"
                className="btn ghost mini sch-import-policy-btn"
                onClick={() => setImportMode('portal')}
                aria-label="Configurer l’import direct depuis Mingle"
                title="Import direct — importer depuis l’Operator Mashup en un clic, sans copier-coller"
              >
                <span className="glyph" aria-hidden="true">⇱</span>
                <span className="lbl-full">Import direct</span>
                <span className="lbl-short" aria-hidden="true">Direct</span>
              </button>
              <button
                type="button"
                className="btn ghost mini sch-import-policy-btn"
                onClick={() => setImportMode('policy')}
                aria-label="Importer la politique MTO/MTS"
                title={
                  policy
                    ? `Politique MTO/MTS · ${policy.count} produits chargés — cliquer pour réimporter`
                    : 'Importer la table de politique MTO/MTS'
                }
              >
                <span className="glyph" aria-hidden="true">⚙</span>
                <span className="lbl-full">Politique MTO/MTS</span>
                <span className="lbl-short" aria-hidden="true">MTO</span>
              </button>
            </>
          }
        />
      )}
      {importMode === 'portal' && (
        <PortalImport
          onBack={() => setImportMode('pms230')}
          onClose={() => setImportMode(null)}
        />
      )}
      {importMode === 'policy' && (
        <PasteImport<PolicyResult>
          title="Importer la table MTO/MTS"
          hint="Colle les colonnes Item number / Name / Pp depuis l'export MMS002. Codes : 10 = MTO, 50 = MTS, 90 = Inactif."
          parser={parsePolicy}
          describe={describePolicy}
          onConfirm={handlePolicyConfirm}
          onClose={() => setImportMode(null)}
        />
      )}

      {openRow && (
        <RowDetailSheet
          row={openRow}
          mtoMts={policy?.map?.[openRow.product] ?? '?'}
          onClose={() => setOpenRowId(null)}
        />
      )}

      {finishedOpen && (
        <FinishedSheet
          schedules={finishedSchedules}
          retiredCount={retiredCount}
          current={selected}
          onOpen={openFinished}
          onClose={() => setFinishedOpen(false)}
        />
      )}
    </div>
  );
}

// Everything that has left the rail: the schedules with nothing left to
// produce, and the ones the line retired by hand. The sheet is the way back in
// — picking one opens it in the table like any rail card, which is where a
// schedule is meant to be read. Nothing leaves the report: this list is where a
// schedule ends up, not a waiting room before a deletion.
function FinishedSheet({
  schedules,
  retiredCount,
  current,
  onOpen,
  onClose,
}: {
  schedules: FinishedSchedule[];
  retiredCount: number;
  // The one already on screen, if the operator is looking at a finished
  // schedule. No rail card can carry the selection in that case, so the sheet
  // is the only place left to say where they are.
  current: string | null;
  onOpen: (item: FinishedSchedule) => void;
  onClose: () => void;
}) {
  useEscapeToClose(onClose);

  const done = schedules.length - retiredCount;
  // Two populations under one heading, so the subtitle has to name whichever
  // ones are actually there rather than claim "sans reste à produire" over a
  // list where half the rows still have work in them.
  const parts: string[] = [];
  if (done > 0) parts.push(`${done} sans reste à produire`);
  if (retiredCount > 0) parts.push(`${retiredCount} retiré${retiredCount > 1 ? 's' : ''} du planning`);

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet sch-done-sheet" role="dialog" aria-modal="true" aria-label="Schedules terminés">
        <div className="grabber" />
        <div className="sheet-head">
          <div className="sheet-head-titles">
            <h3>Schedules terminés</h3>
            <div className="sheet-head-sub">
              {schedules.length} schedule{schedules.length > 1 ? 's' : ''} · {parts.join(' · ')}
            </div>
          </div>
          <button className="btn ghost icon" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        <ul className="sch-done-list">
          {schedules.map((s) => (
            <li key={s.schedule}>
              <button
                type="button"
                className={`sch-done-item ${s.schedule === current ? 'is-current' : ''}`}
                onClick={() => onOpen(s)}
                aria-current={s.schedule === current ? 'true' : undefined}
                title={
                  s.schedule === current
                    ? `Schedule ${s.schedule} — déjà ouvert dans le tableau`
                    : `Ouvrir le schedule ${s.schedule} dans le tableau`
                }
              >
                <span className="mono sch-done-num">{s.schedule}</span>
                <span className="sch-done-name">{s.name}</span>
                {/* "reste" rather than a bare m²: on a schedule that ran to the
                    end it is zero — which is what put it in this list — and on
                    one retired with work in it, what is left is the figure
                    somebody opening the sheet is looking for. One wording for
                    both, so no row needs a badge to be read correctly. */}
                <span className="sch-done-meta faint small mono">
                  {s.count} ligne{s.count > 1 ? 's' : ''} · {fmtNum(s.lites, 0)} lites · reste {fmtNum(s.m2, 0)} m²
                </span>
                <span className="sch-done-go" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

// Swipe a rail card to the left to retire its schedule from the planning. The
// gesture is the discoverable route on the shop-floor tablets; ConfirmSheet is
// what actually guards it, so an accidental swipe costs one tap. Pointer events
// mean a mouse drag works the same way, and the card carries a Suppr key
// handler for anyone on a keyboard.
function SwipeToRetire({ onRetire, children }: { onRetire: () => void; children: ReactNode }) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Mirrors `dx` for the release decision: pointerup can land in the same batch
  // as the last pointermove, and the ref is current where the state may not be.
  const offset = useRef(0);
  const start = useRef<{ x: number; y: number; id: number; axis: 'unknown' | 'x' | 'y' } | null>(null);
  // Set once the pointer has travelled far enough to read as a swipe, so the
  // click that follows the release doesn't also select the schedule.
  const swiped = useRef(false);

  function reset(e: ReactPointerEvent<HTMLDivElement>) {
    const s = start.current;
    start.current = null;
    setDragging(false);
    offset.current = 0;
    setDx(0);
    if (s && e.currentTarget.hasPointerCapture(s.id)) e.currentTarget.releasePointerCapture(s.id);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, axis: 'unknown' };
    swiped.current = false;
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const s = start.current;
    if (!s || e.pointerId !== s.id) return;
    const mx = e.clientX - s.x;
    const my = e.clientY - s.y;
    if (s.axis === 'unknown') {
      if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
      // Lock onto whichever axis the finger committed to first. A vertical lock
      // hands the gesture straight back to the rail's scroller.
      s.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (s.axis === 'x') {
        e.currentTarget.setPointerCapture(s.id);
        setDragging(true);
      }
    }
    if (s.axis !== 'x') return;
    // Left only — nothing is armed on the right, so that side gets a few pixels
    // of give and no more.
    const next = Math.max(-SWIPE_RETIRE_PX * 1.5, Math.min(12, mx));
    if (next <= -8) swiped.current = true;
    offset.current = next;
    setDx(next);
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const axis = start.current?.axis;
    const travelled = offset.current;
    reset(e);
    if (axis === 'x' && travelled <= -SWIPE_RETIRE_PX) onRetire();
  }

  return (
    <div
      className={`sch-swipe${dragging ? ' is-dragging' : ''}${dx <= -SWIPE_RETIRE_PX ? ' is-armed' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={reset}
      onClickCapture={(e) => {
        if (!swiped.current) return;
        swiped.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="sch-swipe-action" aria-hidden="true">
        {/* Dingbat rather than an emoji: it inherits the strip's colour instead
            of dropping a full-colour glyph into the muted palette. */}
        <span className="sch-swipe-action-glyph">↧</span>
        <span className="sch-swipe-action-label">Terminés</span>
      </div>
      <div className="sch-swipe-surface" style={{ transform: `translate3d(${dx}px, 0, 0)` }}>
        {children}
      </div>
    </div>
  );
}

// Confirmation step in front of the rail gesture. The app's default is "act
// now, offer Annuler in a toast" (see lib/toast), which suits per-row edits;
// pulling a whole schedule out of the planning is coarse enough — and reachable
// by an accidental swipe — to be worth a stop first, even though nothing is
// destroyed by it. The undo toast still fires afterwards.
function ConfirmSheet({
  title, body, confirmLabel, onConfirm, onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEscapeToClose(onClose);
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet sch-confirm" role="dialog" aria-modal="true">
        <div className="grabber" />
        <div className="sheet-head">
          <h3>{title}</h3>
        </div>
        <p className="faint small">{body}</p>
        <div className="actions">
          <span style={{ flex: 1 }} />
          <button className="btn ghost" type="button" onClick={onClose}>Annuler</button>
          {/* Not `destructive`: that red is for actions that lose data, and
              this one only moves the schedule to another list. */}
          <button
            className="btn primary"
            type="button"
            autoFocus
            onClick={() => { onConfirm(); onClose(); }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}

interface SummaryBarProps {
  data: PMS230Result | null;
  policy: PolicyResult | null;
  onImport: () => void;
}

function SummaryBar({ data, policy, onImport }: SummaryBarProps) {
  const records = data?.records?.length ?? 0;
  const schedules = data?.schedules?.length ?? 0;
  const m2 = data ? fmtNum(totalM2(data.records), 2) : null;
  const policyCount = policy?.count ?? 0;
  const importedAt = data?.importedAt ? new Date(data.importedAt) : null;

  return (
    <div className="sch-summary">
      <div className="sch-summary-actions">
        {/* Short label on the strip, full one in the tooltip — "rapport
            Operator Mashup" is the only report the page imports, so it says
            nothing the button's position doesn't already say. */}
        <button
          className="btn primary mini"
          onClick={onImport}
          title={data ? 'Réimporter le rapport Operator Mashup' : 'Importer le rapport Operator Mashup'}
        >
          <span aria-hidden="true">↻</span> {data ? 'Réimporter' : 'Importer'}
        </button>
      </div>
      {/* The MTO/MTS chip is not gated on `data`: the policy syncs on its own
          and an operator who has not pasted a report yet would otherwise see
          no sign of it at all, which reads as "the table didn't sync". */}
      {(data || policy) && (
        <div className="sch-summary-stats">
          {policy && (
            <span
              className="sch-policy-chip"
              title="Politique MTO/MTS chargée — partagée entre les opérateurs"
            >
              <span className="sch-policy-chip-glyph" aria-hidden="true">⚙</span>
              MTO/MTS · <strong className="mono">{policyCount}</strong>
            </span>
          )}
          {data && (
            <>
              {/* Dropped on a phone: the rail heading right underneath already
                  reads "PLANNING · 26". */}
              <span className="sch-stat-sched"><strong className="mono">{schedules}</strong> schedules</span>
              <span><strong className="mono">{records}</strong> lignes</span>
              <span><strong className="mono">{m2}</strong> m²</span>
            </>
          )}
          {importedAt && (
            <span className="faint small">
              {/* Two forms of the same stamp; the media query picks one. The
                  year is what goes on a narrow screen — the question the stamp
                  answers is "is this today's report". */}
              <span className="sch-stamp-full">
                importé {importedAt.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
              </span>
              <span className="sch-stamp-short">
                importé {importedAt.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit' })}
                {' '}{importedAt.toLocaleString('fr-FR', { timeStyle: 'short' })}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

interface ScheduleTableProps {
  items: GroupedItem[];
  totals: DisplayRow[];
  // Finished lines the œillet is currently holding back — 0 when it is open,
  // so the empty state only blames the œillet when the œillet is to blame.
  hiddenFinished: number;
  onRowOpen: (row: DisplayRow) => void;
  columns: ColumnDef[];
  pinned: string[];
  widths: Record<string, number>;
  autoWidths: Record<string, number>;
  onResize: (key: string, px: number) => void;
  onFreezeWidths: (px: Record<string, number>) => void;
  onReorder: (fromKey: string, toKey: string) => void;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}

const COL_DRAG_MIME = 'application/x-wb-column';

// Best-effort px estimate for grid columns that use minmax/auto, used to compute
// sticky-left offsets without measuring the DOM.
function columnPx(key: string, override?: number): number {
  if (override) return override;
  const w = COL_WIDTHS[key] || '';
  const m = /^(\d+)px$/.exec(w);
  if (m) return parseInt(m[1], 10);
  const mm = /minmax\((\d+)px/.exec(w);
  if (mm) return parseInt(mm[1], 10);
  return 80;
}

// Bounds for a stored column width. The ceiling has to clear whatever Article
// stretches to on a wide screen, otherwise freezing it on resize would itself
// shrink the column.
const COL_MIN_PX = 40;
const COL_MAX_PX = 1200;
const clampColumnPx = (px: number): number =>
  Math.max(COL_MIN_PX, Math.min(COL_MAX_PX, Math.round(px)));

// Planning-policy badge. The column is 56px, which "Inactif" doesn't fit, so
// that state shows a cross and keeps the word in the tooltip; MTO / MTS are
// short enough to read as-is.
const MTO_GLYPH: Record<string, string> = { Inactif: '✕' };
const MTO_TITLE: Record<string, string> = {
  MTO: 'Make to order',
  MTS: 'Make to stock',
  Inactif: 'Inactif — produit sorti du catalogue',
  '?': 'Produit absent de la table MTO/MTS',
};

function MtoBadge({ value }: { value: string }) {
  const glyph = MTO_GLYPH[value];
  return (
    <span className="sch-mto" data-mto={value} title={MTO_TITLE[value] ?? value}>
      {glyph ? <span aria-label={value} role="img">{glyph}</span> : value}
    </span>
  );
}

// Tracks declared with an `fr` share soak up whatever the fixed columns leave
// over, which is what makes them shrink when a neighbour grows.
function isFlexibleColumn(key: string): boolean {
  return (COL_WIDTHS[key] || '').includes('fr');
}

// Per-column track widths matching the original fixed grid. Optional columns
// drop out when hidden, so the grid template is recomposed from `columns`.
const COL_WIDTHS: Record<string, string> = {
  mtoMts: '56px',
  dateDepart: '80px',
  mo: '100px',
  product: '92px',
  itemName: 'minmax(180px, 1.6fr)',
  schedLites: '62px',
  prodLites: '62px',
  reqLites: '62px',
  opTm: '72px',
  format: '116px',
  qualite: '68px',
  litesPerPack: '68px',
  packsReq: '68px',
  pdp: 'minmax(100px, 1fr)',
  m2: '88px',
};

// Track weights used to build the print template. `columnPx` falls back to a
// flexible column's minmax floor, which under-serves the identity columns on
// paper: the sheet is narrower than a desktop table, every track shrinks, and
// Article never gets more than the 180px floor it would only ever hit in the
// most cramped viewport. These weights buy back a fair share for the columns
// that carry text.
//
// They are the whole story: the printed sheet ignores column widths dragged on
// screen. Letting those through meant stretching Article on a wide monitor
// squeezed every other column on paper — dragged to 1100px it took Qualité from
// 79pt to 47pt and pushed 152 cells into overflow. A resize is a screen
// preference; the page is a fixed width and has to keep its own proportions.
const COL_PRINT_WEIGHT: Record<string, number> = {
  // These two can't fit their own header label at 7.5pt on their screen width.
  mtoMts: 92,
  qualite: 88,
  // "2 140 × 3 210" overruns the screen width once the sheet is this narrow.
  format: 132,
  // The most identifying field on the row — worth the widest text track.
  itemName: 300,
  pdp: 130,
  // The 9pt bold total ("115 875,58") needs more room than the data cells the
  // 88px screen default is sized for — it clipped to "115 875,…" on paper.
  m2: 100,
};

interface ColumnResizeHandleProps {
  colKey: string;
  // Returns the column's actual rendered width and freezes the flexible
  // tracks — see `beginResize`. Called once per drag, on pointer-down.
  onResizeStart: (key: string) => number;
  onResize: (key: string, px: number) => void;
}

function ColumnResizeHandle({ colKey, onResizeStart, onResize }: ColumnResizeHandleProps) {
  const dragState = useRef<{ originX: number; originPx: number } | null>(null);

  function endDrag(target: HTMLSpanElement | null, pointerId?: number) {
    if (!dragState.current) return;
    dragState.current = null;
    document.body.classList.remove('is-col-resizing');
    if (target && pointerId !== undefined && target.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
  }

  function onPointerDown(e: ReactPointerEvent<HTMLSpanElement>) {
    // Block the parent's sort click and own the pointer for the drag duration.
    e.stopPropagation();
    e.preventDefault();
    dragState.current = { originX: e.clientX, originPx: onResizeStart(colKey) };
    e.currentTarget.setPointerCapture(e.pointerId);
    // Lock the column-resize cursor and disable text selection page-wide so
    // the drag doesn't pick up text or flicker between cursors.
    document.body.classList.add('is-col-resizing');
  }

  function onPointerMove(e: ReactPointerEvent<HTMLSpanElement>) {
    if (!dragState.current) return;
    const delta = e.clientX - dragState.current.originX;
    onResize(colKey, dragState.current.originPx + delta);
  }

  return (
    <span
      className="sch-col-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Redimensionner la colonne"
      draggable={false}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onDragStart={(e) => e.preventDefault()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e.currentTarget, e.pointerId)}
      onPointerCancel={(e) => endDrag(e.currentTarget, e.pointerId)}
      onLostPointerCapture={(e) => endDrag(e.currentTarget, e.pointerId)}
    />
  );
}

function ScheduleTable({ items, totals, hiddenFinished, onRowOpen, columns, pinned, widths, autoWidths, onResize, onFreezeWidths, onReorder, sortKey, sortDir, onSort }: ScheduleTableProps) {
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const dragKeyRef = useRef<string | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  // Toggle .is-scrolled-x once the operator has scrolled past the pinned
  // columns, so the divider shadow only appears when it's actually meaningful.
  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const update = () => el.classList.toggle('is-scrolled-x', el.scrollLeft > 0);
    update();
    el.addEventListener('scroll', update, { passive: true });
    return () => el.removeEventListener('scroll', update);
  }, []);

  // Tag pinned columns with their cumulative px offset so each cell can stick
  // exactly to the right of the previous pinned one. Memoised because the
  // result is passed to memo'd row components — a fresh array every render
  // would invalidate every row.
  const enrichedColumns = useMemo<ColumnView[]>(() => {
    const pinSet = new Set(pinned);
    const out: ColumnView[] = [];
    let leftAcc = 0;
    for (const c of columns) {
      if (pinSet.has(c.key)) {
        out.push({ ...c, pinnedLeft: leftAcc, pinnedLast: false });
        leftAcc += columnPx(c.key, widths[c.key] ?? autoWidths[c.key]);
      } else {
        out.push({ ...c });
      }
    }
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i]!.pinnedLeft !== undefined) {
        out[i] = { ...out[i]!, pinnedLast: true };
        break;
      }
    }
    return out;
  }, [columns, pinned, widths, autoWidths]);

  const headRef = useRef<HTMLTableRowElement>(null);

  // Starting a drag pins every flexible track to what it currently shows.
  // Article and PDP are `fr` columns, so widening any fixed column used to
  // steal their space and visibly shrink them mid-drag. Freezing first means a
  // resize only moves the column under the cursor. It also returns the real
  // rendered width, which `columnPx` can only estimate for an `fr` track (it
  // reports the minmax floor, so grabbing Article snapped it to 180px).
  const beginResize = useCallback((key: string): number => {
    const cells = headRef.current?.querySelectorAll<HTMLElement>('.sch-cell');
    const measured = new Map<string, number>();
    if (cells) {
      columns.forEach((c, i) => {
        const el = cells[i];
        if (el) measured.set(c.key, Math.round(el.getBoundingClientRect().width));
      });
    }
    const freeze: Record<string, number> = {};
    for (const c of columns) {
      if (widths[c.key] || autoWidths[c.key] || !isFlexibleColumn(c.key)) continue;
      const px = measured.get(c.key);
      if (px) freeze[c.key] = px;
    }
    if (Object.keys(freeze).length > 0) onFreezeWidths(freeze);
    return measured.get(key) ?? columnPx(key, widths[key] ?? autoWidths[key]);
  }, [columns, widths, autoWidths, onFreezeWidths]);

  // Compose track widths: user override wins, then COL_WIDTHS default, then auto.
  // minPx keeps the grid from collapsing in narrow viewports.
  //
  // On paper the table falls back to real table layout (so <thead> repeats on
  // every page), so the print widths ship as <col> percentages instead of a
  // grid template. They come from COL_PRINT_WEIGHT alone — neither a dragged
  // width nor an auto-frozen one reaches the sheet, so resizing a column on
  // screen leaves the printout exactly as it was.
  const { gridTemplate, printCols, minPx } = useMemo(() => {
    const screenPx = (key: string): number | undefined => widths[key] ?? autoWidths[key];
    const weights = columns.map((c) => columnPx(c.key, COL_PRINT_WEIGHT[c.key]));
    const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
    return {
      gridTemplate: columns
        .map((c) => { const px = screenPx(c.key); return px ? `${px}px` : (COL_WIDTHS[c.key] || 'auto'); })
        .join(' '),
      printCols: weights.map((w) => `${((w / weightSum) * 100).toFixed(4)}%`),
      minPx: columns.reduce((acc, c) => acc + columnPx(c.key, screenPx(c.key)), 0),
    };
  }, [columns, widths, autoWidths]);

  // Nothing at all to paint — not even a greyed line. Tested on `items` rather
  // than on the totals: a filter can clear the planning while finished rows
  // still pass it, and swapping the table for "aucune ligne" would deny rows
  // that are right there.
  //
  // And when the œillet is what is holding them back, say so. On a schedule
  // whose every line is produced — the case the terminés sheet opens — the
  // plain "aucune ligne" is simply false, and it appears directly under a
  // control offering the rows it denies.
  if (items.length === 0) {
    return (
      <div className="sch-empty-rows faint">
        {hiddenFinished > 0
          ? `Rien à produire sur ce schedule — ${hiddenFinished} ligne${hiddenFinished > 1 ? 's' : ''} `
            + `terminée${hiddenFinished > 1 ? 's' : ''}, à afficher avec l’œillet.`
          : 'Aucune ligne pour ce schedule.'}
      </div>
    );
  }

  return (
    // A real <table>, not a div grid: it is the only way the column header
    // repeats on every printed page, and a schedule routinely runs past one
    // sheet. On screen the table display is swapped back to flex/grid (see
    // .sch-table in app.css) so the layout is exactly what it always was;
    // the table box only comes back for the aperçu and the paper.
    <table
      ref={tableRef}
      className="sch-table"
      style={{
        ['--sch-grid' as string]: gridTemplate,
        ['--sch-min' as string]: `${minPx}px`,
      }}
    >
      {/* Drives the column widths under table layout. Generates no box on
          screen, where --sch-grid is in charge. */}
      <colgroup>
        {enrichedColumns.map((c, i) => <col key={c.key} style={{ width: printCols[i] }} />)}
      </colgroup>
      <thead>
      <tr className="sch-row sch-head" ref={headRef}>
        {enrichedColumns.map((c) => {
          const sortable = !!c.sortKey;
          const isSorted = sortable && c.sortKey === sortKey;
          const dirIndicator = isSorted ? (sortDir === 'asc' ? '▲' : '▼') : '';
          // Name the click that actually follows, so the way back to the
          // dimension order isn't invisible. The column that carries the
          // default only ever flips direction, so it never gets that wording.
          const returnsToDefault =
            isSorted && c.sortKey !== DEFAULT_SORT_KEY && sortDir !== firstSortDir(c.sortKey!);
          const sortHint = !sortable
            ? undefined
            : !isSorted
              ? `Trier par ${c.label}`
              : returnsToDefault
                ? 'Cliquer pour revenir au tri par dimension'
                : 'Cliquer pour inverser le tri';
          const pin = pinnedAttrs(c);
          const isDragOver = dragOverKey === c.key && dragKeyRef.current && dragKeyRef.current !== c.key;
          const sameGroupDrag = isDragOver && pinned.includes(dragKeyRef.current!) === pinned.includes(c.key);
          return (
            <th
              key={c.key}
              scope="col"
              className={`sch-cell ${c.cls} ${sortable ? 'is-sortable' : ''} ${isSorted ? 'is-sorted' : ''}${pin.className}${sameGroupDrag ? ' is-drop-target' : ''}${dragKeyRef.current === c.key ? ' is-drag-source' : ''}`}
              aria-sort={isSorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
              title={sortHint}
              tabIndex={sortable ? 0 : undefined}
              onClick={sortable ? () => onSort(c.sortKey!) : undefined}
              onKeyDown={
                sortable
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSort(c.sortKey!);
                      }
                    }
                  : undefined
              }
              style={pin.style}
              draggable
              onDragStart={(e) => {
                dragKeyRef.current = c.key;
                e.dataTransfer.setData(COL_DRAG_MIME, c.key);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => { dragKeyRef.current = null; setDragOverKey(null); }}
              onDragOver={(e) => {
                if (!dragKeyRef.current || dragKeyRef.current === c.key) return;
                // Only accept drops within the same pinned/unpinned group.
                if (pinned.includes(dragKeyRef.current) !== pinned.includes(c.key)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dragOverKey !== c.key) setDragOverKey(c.key);
              }}
              onDragLeave={() => { if (dragOverKey === c.key) setDragOverKey(null); }}
              onDrop={(e) => {
                const from = e.dataTransfer.getData(COL_DRAG_MIME) || dragKeyRef.current;
                setDragOverKey(null);
                dragKeyRef.current = null;
                if (from && from !== c.key) {
                  e.preventDefault();
                  onReorder(from, c.key);
                }
              }}
            >
              <span className="sch-col-drag-grip" aria-hidden="true" title="Glisser pour réordonner">⋮⋮</span>
              {c.label}
              {dirIndicator && <span className="sch-sort-arrow" aria-hidden="true">{dirIndicator}</span>}
              <ColumnResizeHandle colKey={c.key} onResizeStart={beginResize} onResize={onResize} />
            </th>
          );
        })}
      </tr>
      </thead>
      <tbody>
      {items.map((it) =>
        it.kind === 'break'
          ? (
            <tr key={it.id} className="sch-row sch-group-break">
              <td className="sch-group-label" colSpan={enrichedColumns.length}>
                <span className="sch-group-value">{fmtNum(it.longueur, 0)} mm</span>
              </td>
            </tr>
          )
          // A finished line greys out where it stands. It is in the table but
          // not in the total, and the tone is what carries that — see .is-muted.
          : (
            <ScheduleRow
              key={it.row.id}
              row={it.row}
              onOpen={onRowOpen}
              columns={enrichedColumns}
              muted={isFinished(it.row)}
            />
          )
      )}
      <TotalRow rows={totals} columns={enrichedColumns} />
      </tbody>
    </table>
  );
}

interface TableControlsProps {
  settings: TableSettings;
  layout: ColumnLayout;
  visibleColumns: ColumnDef[];
  available: { qualites: string[]; pdps: string[]; mtos: string[] };
  filteringActive: boolean;
  colsMenuOpen: boolean;
  onColsMenuToggle: () => void;
  onColsMenuClose: () => void;
  finishedCount: number;
  showFinished: boolean;
  onToggleFinished: () => void;
  onToggleFilterValue: (field: 'qualite' | 'pdp' | 'mtoMts', value: string) => void;
  onClearFilters: () => void;
  onToggleColumn: (key: string) => void;
  onTogglePinned: (key: string) => void;
  onMoveColumn: (key: string, dir: -1 | 1) => void;
  onResetLayout: () => void;
}

function TableControls({
  settings,
  layout,
  visibleColumns,
  available,
  filteringActive,
  colsMenuOpen,
  onColsMenuToggle,
  onColsMenuClose,
  finishedCount,
  showFinished,
  onToggleFinished,
  onToggleFilterValue,
  onClearFilters,
  onToggleColumn,
  onTogglePinned,
  onMoveColumn,
  onResetLayout,
}: TableControlsProps) {
  const colsBtnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!colsMenuOpen) return;
    function onDoc(e: MouseEvent) {
      if (colsBtnRef.current && !colsBtnRef.current.contains(e.target as Node)) onColsMenuClose();
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [colsMenuOpen, onColsMenuClose]);

  return (
    <div className="sch-controls no-print">
      {available.mtos.length > 1 && (
        <FilterGroup
          label="MTO/MTS"
          options={available.mtos}
          selected={settings.mtoMts}
          onToggle={(v) => onToggleFilterValue('mtoMts', v)}
        />
      )}
      {available.qualites.length > 1 && (
        <FilterGroup
          label="Qualité"
          options={available.qualites}
          selected={settings.qualite}
          onToggle={(v) => onToggleFilterValue('qualite', v)}
        />
      )}
      {available.pdps.length > 1 && (
        <FilterGroup
          label="PDP"
          options={available.pdps}
          selected={settings.pdp}
          onToggle={(v) => onToggleFilterValue('pdp', v)}
        />
      )}
      {filteringActive && (
        <button type="button" className="btn ghost mini" onClick={onClearFilters}>
          Effacer filtres
        </button>
      )}
      <div className="sch-controls-end">
        {finishedCount > 0 && (
          // The œillet. Only offered when there is something behind it — on a
          // freshly imported schedule nothing is finished yet, and a control
          // reading "0 terminées" would promise rows it cannot show.
          <button
            type="button"
            className={`btn ghost mini sch-eye-btn ${showFinished ? 'is-on' : ''}`}
            onClick={onToggleFinished}
            aria-pressed={showFinished}
            title={
              showFinished
                ? 'Replier les lignes terminées'
                : 'Afficher les lignes de ce schedule qui n’ont plus rien à produire'
            }
          >
            <span className={`sch-eye ${showFinished ? '' : 'is-off'}`} aria-hidden="true" />
            {finishedCount} terminée{finishedCount > 1 ? 's' : ''}
          </button>
        )}
        <div className="sch-cols-wrap" ref={colsBtnRef}>
          <button
            type="button"
            className={`btn ghost mini sch-cols-btn ${colsMenuOpen ? 'is-open' : ''}`}
            onClick={onColsMenuToggle}
            aria-expanded={colsMenuOpen}
            aria-label="Configurer les colonnes"
          >
            <span className="sch-cols-icon" aria-hidden="true" />
            Colonnes
            <span className="sch-cols-chevron" aria-hidden="true" />
          </button>
          {colsMenuOpen && (
            <div className="popover sch-cols-menu" role="menu">
              <div className="sch-cols-menu-head">
                <h4>Colonnes</h4>
                <button type="button" className="btn ghost mini" onClick={onResetLayout}>Réinitialiser</button>
              </div>
              <ul className="sch-cols-list">
                {orderedAllColumns(layout).map((col, i, arr) => {
                  const visible = !layout.hidden.includes(col.key);
                  const pinned = layout.pinned.includes(col.key);
                  const sameGroupPrev = i > 0 && layout.pinned.includes(arr[i - 1]!.key) === pinned;
                  const sameGroupNext = i < arr.length - 1 && layout.pinned.includes(arr[i + 1]!.key) === pinned;
                  return (
                    <li key={col.key} className={`sch-cols-item ${pinned ? 'is-pinned' : ''} ${visible ? '' : 'is-hidden'}`}>
                      <label className="sch-cols-opt">
                        <input
                          type="checkbox"
                          checked={visible}
                          onChange={() => onToggleColumn(col.key)}
                        />
                        <span>{col.label}</span>
                      </label>
                      <div className="sch-cols-actions">
                        <button
                          type="button"
                          className={`btn ghost icon mini sch-cols-pin ${pinned ? 'is-on' : ''}`}
                          onClick={() => onTogglePinned(col.key)}
                          title={pinned ? 'Désépingler' : 'Épingler à gauche'}
                          aria-pressed={pinned}
                          aria-label={pinned ? 'Désépingler la colonne' : 'Épingler la colonne'}
                        >
                          <span aria-hidden="true" className="sch-pin-glyph" />
                        </button>
                        <button
                          type="button"
                          className="btn ghost icon mini"
                          onClick={() => onMoveColumn(col.key, -1)}
                          disabled={!sameGroupPrev}
                          title="Monter"
                          aria-label="Monter la colonne"
                        >↑</button>
                        <button
                          type="button"
                          className="btn ghost icon mini"
                          onClick={() => onMoveColumn(col.key, 1)}
                          disabled={!sameGroupNext}
                          title="Descendre"
                          aria-label="Descendre la colonne"
                        >↓</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="sch-cols-menu-foot faint small">
                {visibleColumns.length}/{COLUMNS.length} visibles · {layout.pinned.length} épinglée{layout.pinned.length > 1 ? 's' : ''}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface FilterGroupProps {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}

function FilterGroup({ label, options, selected, onToggle }: FilterGroupProps) {
  return (
    <div className="sch-filter-group">
      <span className="sch-filter-label">{label}</span>
      <div className="sch-filter-chips">
        {options.map((v) => {
          const on = selected.includes(v);
          return (
            <button
              key={v}
              type="button"
              className={`sch-filter-chip ${on ? 'is-on' : ''}`}
              onClick={() => onToggle(v)}
              aria-pressed={on}
            >
              {v || '—'}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface ScheduleRowProps {
  row: DisplayRow;
  onOpen: (row: DisplayRow) => void;
  columns: ColumnView[];
  // A finished line: same cells, greyed out. It stays clickable — the detail
  // sheet is the whole point of leaving it in the table.
  muted?: boolean;
}

function renderRowCell(col: ColumnDef, row: DisplayRow): ReactNode {
  switch (col.key) {
    case 'mtoMts':
      return <MtoBadge value={row.mtoMts} />;
    case 'dateDepart':   return fmtDate(row.dateDepart);
    case 'mo':           return row.mo;
    case 'product':      return row.product;
    case 'itemName':
      return (
        <>
          <div className="sch-name" title={row.itemName}>{row.itemName}</div>
          {row.customer && <div className="sch-customer faint" title={row.customer}>{row.customer}</div>}
        </>
      );
    case 'schedLites':   return row.schedLites || '';
    case 'prodLites':    return row.prodLites ?? 0;
    case 'reqLites':     return row.reqLites || '';
    case 'opTm':         return row.opTm ? fmtNum(row.opTm, 2) : '';
    case 'format':
      return row.largeur && row.longueur ? (
        <>
          {fmtNum(row.largeur, 0)}
          <span className="sch-fmt-x faint"> × </span>
          {fmtNum(row.longueur, 0)}
        </>
      ) : '';
    case 'qualite':      return row.qualite;
    case 'litesPerPack': return row.litesPerPack ?? '';
    case 'packsReq': {
      if (!row.litesPerPack || !row.reqLites) return '';
      const n = packsReq(row);
      if (!packsReqShort(row)) return n;
      const leftover = row.reqLites - n * row.litesPerPack;
      return (
        <span
          className="sch-packs-short is-danger"
          title={`${leftover} lite${leftover > 1 ? 's' : ''} restant${leftover > 1 ? 's' : ''} hors pack`}
        >
          {n}
        </span>
      );
    }
    case 'pdp':          return row.pdp;
    case 'm2':           return fmtNum(row.m2, 2);
    default:             return null;
  }
}

const ScheduleRow = memo(function ScheduleRow({ row, onOpen, columns, muted }: ScheduleRowProps) {
  const isQc = row.largeur === 0 && row.longueur === 0;
  const open = () => onOpen(row);
  return (
    // A <tr> rather than a <button>: the row has to be a table row for the
    // printed header to repeat. It keeps the keyboard affordance a button
    // gave it — focusable, Enter/Espace activates.
    <tr
      className={`sch-row sch-row-clickable ${isQc ? 'is-qc' : ''} ${muted ? 'is-muted' : ''}`}
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      }}
      // The grey is the only thing marking a finished line, and colour alone
      // reaches neither a screen reader nor a monochrome display.
      aria-label={`Détails ${row.product} ${row.itemName}${muted ? ' — terminée' : ''}`}
    >
      {columns.map((c) => {
        const monoExtra =
          c.key === 'dateDepart' || c.key === 'mo' || c.key === 'product' ||
          c.key === 'schedLites' || c.key === 'prodLites' || c.key === 'reqLites' ||
          c.key === 'opTm' || c.key === 'format' || c.key === 'qualite' ||
          c.key === 'litesPerPack' || c.key === 'packsReq' || c.key === 'm2'
            ? 'mono'
            : '';
        const titleAttr = c.key === 'pdp' ? row.pdp : undefined;
        const pin = pinnedAttrs(c);
        return (
          <td
            key={c.key}
            className={`sch-cell ${c.cls} ${monoExtra}${pin.className}`}
            title={titleAttr}
            style={pin.style}
          >
            {renderRowCell(c, row)}
          </td>
        );
      })}
    </tr>
  );
});

function TotalRow({ rows, columns }: { rows: DisplayRow[]; columns: ColumnView[] }) {
  const sched = totalLites(rows);
  const prod = rows.reduce((s, r) => s + (r.prodLites ?? 0), 0);
  const req = totalReqLites(rows);
  const m2 = totalM2(rows);
  // Columns are reorderable, so the "Total" label must never sit on — or span
  // over — a column that carries a total, otherwise moving e.g. Req ahead of
  // Sched hides its value. It takes the first *run* of consecutive columns
  // without one: at the head of the row in the default layout, further right
  // once totals are dragged to the front. Pinned layouts keep a single cell —
  // spanning one would break the sticky offsets — so the label may clip there.
  const isTotalled = (c: ColumnView) => TOTAL_KEYS.has(c.key);
  const hasPinned = columns.some((c) => c.pinnedLeft !== undefined);
  const labelStart = columns.findIndex((c) => !isTotalled(c));
  let labelEnd = labelStart === -1 ? -1 : labelStart + 1; // exclusive
  if (labelStart !== -1 && !hasPinned) {
    while (labelEnd < columns.length && !isTotalled(columns[labelEnd]!)) labelEnd++;
  }
  const spans = labelEnd - labelStart > 1;
  // Every visible column carries a total — reachable once the identity columns
  // are all hidden. There is no free cell to put the label in, so it shares
  // the first one with its value rather than disappearing.
  const inlineLabel = labelStart === -1;
  const totalFor = (key: string): ReactNode => {
    if (key === 'schedLites') return sched;
    if (key === 'prodLites') return prod;
    if (key === 'reqLites') return req;
    if (key === 'm2') return fmtNum(m2, 2);
    return '';
  };
  return (
    <tr className="sch-row sch-total">
      {columns.map((c, i) => {
        if (spans && i >= labelStart && i < labelEnd) {
          if (i === labelStart) {
            return (
              // gridColumn drives the span on screen, colSpan under table
              // layout — each is inert in the other mode.
              <td
                key={c.key}
                className="sch-cell sch-total-label"
                colSpan={labelEnd - labelStart}
                style={{ gridColumn: `${labelStart + 1} / ${labelEnd + 1}` }}
              >
                {/* Inner wrapper carries the flex layout: a display:flex <td>
                    stops being a table-cell, and its colSpan goes with it. */}
                <span className="sch-total-label-in">
                  <span>Total</span>
                  <span className="faint small">{rows.length} ligne{rows.length > 1 ? 's' : ''}</span>
                </span>
              </td>
            );
          }
          return null;
        }
        const pin = pinnedAttrs(c);
        if (inlineLabel && i === 0) {
          return (
            <td key={c.key} className={`sch-cell ${c.cls} mono${pin.className}`} style={pin.style}>
              {/* Inner wrapper, not the cell itself: the cell has to stay a
                  table-cell under table layout. */}
              <span className="sch-total-inline">
                <span className="faint small">Total · {rows.length}</span>
                <strong>{totalFor(c.key)}</strong>
              </span>
            </td>
          );
        }
        let content: ReactNode = '';
        if (i === labelStart) content = <strong>Total · {rows.length}</strong>;
        else content = totalFor(c.key) === '' ? '' : <strong>{totalFor(c.key)}</strong>;
        return (
          <td key={c.key} className={`sch-cell ${c.cls} mono${pin.className}`} style={pin.style}>{content}</td>
        );
      })}
    </tr>
  );
}

interface RowDetailSheetProps {
  row: PMS230Record;
  mtoMts: string;
  onClose: () => void;
}

function fmtDateLong(yyyymmdd: string | null | undefined): string {
  if (!yyyymmdd || yyyymmdd.length !== 8) return '—';
  return `${yyyymmdd.slice(6)}/${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(0, 4)}`;
}

function fmtTime(hhmm: string | null | undefined): string {
  if (!hhmm) return '';
  if (hhmm.length === 4) return `${hhmm.slice(0, 2)}:${hhmm.slice(2)}`;
  return hhmm;
}

function RowDetailSheet({ row, mtoMts, onClose }: RowDetailSheetProps) {
  useEscapeToClose(onClose);

  const short = shortItemName(row.itemName);
  const format = row.largeur && row.longueur
    ? `${fmtNum(row.largeur, 0)} × ${fmtNum(row.longueur, 0)} mm`
    : '—';
  const start = row.startDate || row.startTime
    ? `${fmtDateLong(row.startDate)} ${fmtTime(row.startTime)}`.trim()
    : '—';
  const end = row.endDate || row.endTime
    ? `${fmtDateLong(row.endDate)} ${fmtTime(row.endTime)}`.trim()
    : '—';

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet sch-row-sheet" role="dialog" aria-modal="true" aria-label="Détail de ligne">
        <div className="grabber" />
        <div className="sheet-head">
          <div className="sch-row-sheet-title">
            <MtoBadge value={mtoMts} />
            <div className="sch-row-sheet-heading">
              <h3 className="mono sch-row-sheet-article">
                {row.itemName || <span className="faint">(sans nom)</span>}
                {short && short !== row.itemName && <span className="faint sch-row-sheet-short"> ({short})</span>}
              </h3>
              <div className="sch-row-sheet-sub faint small mono">
                <span>{row.mo}</span>
                <span aria-hidden="true">·</span>
                <span>{row.product}</span>
                {row.customer && (<><span aria-hidden="true">·</span><span className="sch-row-sheet-customer" title={row.customer}>{row.customer}</span></>)}
              </div>
            </div>
          </div>
          <button className="btn ghost icon" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        <dl className="sch-row-sheet-grid">
          <DetailField label="Planning" value={<span className="mono">{row.schedule}{row.schedSuffix ? `-${row.schedSuffix}` : ''}</span>} />
          {/* The report carries three op-step columns; only the second one means
              anything here — it's the step the whole page filters on (≠ 90). The
              other two stay in the tooltip rather than in the reader's way. */}
          <DetailField
            label="Status"
            value={row.opStepD
              ? <span className="sch-status-pill mono" title={row.opSteps ? `Étapes ${row.opSteps}` : undefined}>{row.opStepD}</span>
              : '—'}
          />
          <DetailField label="Centre de travail" value={row.workCenter || '—'} />
          <DetailField label="Date départ" value={<span className="mono">{fmtDateLong(row.dateDepart)}</span>} />
          <DetailField label="Qualité" value={<span className="mono">{row.qualite || '—'}</span>} />
          <DetailField label="PDP" value={row.pdp || '—'} />
          {/* Début / Fin sat in a section of their own at the very bottom; they
              are two dates like the ones above them, so they belong in the same
              grid — and the eight fields fill it exactly. */}
          <DetailField label="Début" value={<span className="mono">{start}</span>} />
          <DetailField label="Fin" value={<span className="mono">{end}</span>} />
        </dl>

        <div className="sch-row-sheet-section">
          <div className="sch-row-sheet-section-title">Quantités (lites)</div>
          <div className="sch-row-sheet-stats">
            <Stat label="L/Pack" value={row.litesPerPack ?? '—'} />
            <Stat
              label="P/REQ"
              value={row.litesPerPack && row.reqLites ? packsReq(row) : '—'}
              danger={packsReqShort(row)}
              dangerTitle={packsReqShort(row) ? `${row.reqLites - packsReq(row) * (row.litesPerPack ?? 0)} lite(s) hors pack` : undefined}
            />
            <Stat label="Req" value={row.reqLites} highlight />
            <Stat label="Sched" value={row.schedLites} />
            <Stat label="Prod" value={row.prodLites ?? 0} />
          </div>
        </div>

        <div className="sch-row-sheet-section">
          <div className="sch-row-sheet-section-title">Dimension</div>
          <div className="sch-row-sheet-stats">
            <Stat label="Largeur × Longueur" value={format} wide />
            {row.thickness && <Stat label="Épaisseur" value={`${row.thickness} mm`} />}
            {row.formatCode && <Stat label="Code format" value={<span className="mono">{row.formatCode}</span>} />}
            <Stat label="m² restant" value={fmtNum(row.m2, 2)} highlight />
          </div>
        </div>
      </div>
    </>
  );
}

interface DetailFieldProps {
  label: string;
  value: ReactNode;
}

function DetailField({ label, value }: DetailFieldProps) {
  return (
    <div className="sch-row-sheet-field">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

interface StatProps {
  label: string;
  value: ReactNode;
  highlight?: boolean;
  wide?: boolean;
  danger?: boolean;
  dangerTitle?: string;
}

function Stat({ label, value, highlight, wide, danger, dangerTitle }: StatProps) {
  return (
    <div
      className={`sch-row-sheet-stat ${highlight ? 'is-highlight' : ''} ${wide ? 'is-wide' : ''} ${danger ? 'is-danger' : ''}`}
      title={dangerTitle}
    >
      <span className="sch-row-sheet-stat-label">{label}</span>
      <strong className="mono">{value}</strong>
    </div>
  );
}

