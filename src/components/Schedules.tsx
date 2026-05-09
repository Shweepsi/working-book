import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { load, save } from '../lib/storage';
import { mergePMS230, parsePMS230, type PMS230Record, type PMS230Result } from '../lib/pms230Parser';
import { parsePolicy, type PolicyResult } from '../lib/policyParser';
import {
  DOWNTIME_FACTOR,
  fmtHMmin,
  minutesAt,
  totalLites,
  totalM2,
  totalReqLites,
} from '../lib/coaterMath';
import PasteImport, { type ImportMode } from './PasteImport';
import { useEscapeToClose } from '../lib/hooks';
import { useToast } from '../lib/toast';

const KEY_DATA   = 'wb.schedules.v1';
const KEY_POLICY = 'wb.schedules.policy.v1';
const KEY_SPEED  = 'wb.schedules.vitesse';
const KEY_TABLE  = 'wb.schedules.table.v1';

type DisplayRow = PMS230Record & { mtoMts: string };

type GroupedItem =
  | { kind: 'break'; id: string; longueur: number }
  | { kind: 'row'; row: DisplayRow };

interface RailStat {
  count: number;
  lites: number;
  m2: number;
}

type SortKey = 'longueur' | 'dateDepart' | 'product' | 'itemName' | 'schedLites' | 'prodLites' | 'reqLites' | 'scraps' | 'qualite' | 'pdp' | 'm2';
type SortDir = 'asc' | 'desc';

interface ColumnDef {
  key: string;
  label: string;
  cls: string;
  sortKey?: SortKey;
  optional?: boolean; // only optional cols can be hidden via the menu
}

const COLUMNS: ColumnDef[] = [
  { key: 'mtoMts',     label: 'MTO/MTS',  cls: 'col-mto'                                       },
  { key: 'dateDepart', label: 'Départ',   cls: 'col-date',                  sortKey: 'dateDepart', optional: true },
  { key: 'mo',         label: 'MO',       cls: 'col-mo',                                        optional: true },
  { key: 'product',    label: 'Produit',  cls: 'col-prod',                  sortKey: 'product'   },
  { key: 'itemName',   label: 'Article',  cls: 'col-name',                  sortKey: 'itemName'  },
  { key: 'schedLites', label: 'Sched',    cls: 'col-num',                   sortKey: 'schedLites' },
  { key: 'prodLites',  label: 'Prod',     cls: 'col-num',                   sortKey: 'prodLites' },
  { key: 'reqLites',   label: 'Req',      cls: 'col-num',                   sortKey: 'reqLites'  },
  { key: 'scraps',     label: 'Scraps',   cls: 'col-num',                   sortKey: 'scraps',   optional: true },
  { key: 'format',     label: 'Format',   cls: 'col-fmt',                   sortKey: 'longueur'  },
  { key: 'qualite',    label: 'Qualité',  cls: 'col-q',                     sortKey: 'qualite'   },
  { key: 'litesPerPack', label: 'L/Pack', cls: 'col-num',                                       optional: true },
  { key: 'pdp',        label: 'PDP',      cls: 'col-pdp',                   sortKey: 'pdp'       },
  { key: 'm2',         label: 'm² rest.', cls: 'col-m2',                    sortKey: 'm2'        },
];

const OPTIONAL_COLUMN_KEYS = COLUMNS.filter((c) => c.optional).map((c) => c.key);

interface TableSettings {
  sortKey: SortKey;
  sortDir: SortDir;
  hidden: string[];
  qualite: string[];
  pdp: string[];
  mtoMts: ('MTO' | 'MTS' | '?')[];
}

const DEFAULT_TABLE_SETTINGS: TableSettings = {
  sortKey: 'longueur',
  sortDir: 'desc',
  hidden: [],
  qualite: [],
  pdp: [],
  mtoMts: [],
};

function compareRows(a: DisplayRow, b: DisplayRow, key: SortKey, dir: SortDir): number {
  const sign = dir === 'asc' ? 1 : -1;
  switch (key) {
    case 'longueur':   return sign * (a.longueur - b.longueur);
    case 'schedLites': return sign * (a.schedLites - b.schedLites);
    case 'prodLites':  return sign * ((a.prodLites ?? 0) - (b.prodLites ?? 0));
    case 'reqLites':   return sign * (a.reqLites - b.reqLites);
    case 'scraps':     return sign * ((a.scraps ?? 0) - (b.scraps ?? 0));
    case 'm2':         return sign * (a.m2 - b.m2);
    case 'dateDepart': return sign * String(a.dateDepart || '').localeCompare(String(b.dateDepart || ''));
    case 'product':    return sign * String(a.product || '').localeCompare(String(b.product || ''));
    case 'itemName':   return sign * String(a.itemName || '').localeCompare(String(b.itemName || ''));
    case 'qualite':    return sign * String(a.qualite || '').localeCompare(String(b.qualite || ''));
    case 'pdp':        return sign * String(a.pdp || '').localeCompare(String(b.pdp || ''));
  }
}

function describePMS230(r: PMS230Result): string {
  const records = r.records?.length ?? 0;
  const schedules = r.schedules?.length ?? 0;
  const m2 = totalM2(r.records ?? []);
  const page = r.totalPages ? ` · page ${r.currentPage}/${r.totalPages}` : '';
  return `✓ ${records} lignes · ${schedules} schedule${schedules > 1 ? 's' : ''} · ${m2.toFixed(2)} m²${page}`;
}

function describePolicy(r: PolicyResult): string {
  return `✓ ${r.count} produits chargés`;
}

function fmtDate(yyyymmdd: string | null | undefined): string {
  if (!yyyymmdd || yyyymmdd.length !== 8) return '';
  return `${yyyymmdd.slice(6)}/${yyyymmdd.slice(4, 6)}`;
}

function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return '';
  return n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default function Schedules() {
  const [data, setData] = useState<PMS230Result | null>(() => load<PMS230Result | null>(KEY_DATA, null));
  const [policy, setPolicy] = useState<PolicyResult | null>(() => load<PolicyResult | null>(KEY_POLICY, null));
  const [vitesse, setVitesse] = useState<number | string>(() => load<number | string>(KEY_SPEED, 6));
  const [selected, setSelected] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<'pms230' | 'policy' | null>(null);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [tableSettings, setTableSettings] = useState<TableSettings>(
    () => ({ ...DEFAULT_TABLE_SETTINGS, ...(load<Partial<TableSettings>>(KEY_TABLE, {})) }),
  );
  const [colsMenuOpen, setColsMenuOpen] = useState(false);
  const toast = useToast();

  useEffect(() => { save(KEY_TABLE, tableSettings); }, [tableSettings]);

  const openRow = useMemo(
    () => (data?.records ?? []).find((r) => r.id === openRowId) ?? null,
    [data, openRowId],
  );

  const handleRowOpen = useCallback((row: DisplayRow) => setOpenRowId(row.id), []);

  // Persist datasets and speed.
  useEffect(() => { save(KEY_DATA, data); }, [data]);
  useEffect(() => { save(KEY_POLICY, policy); }, [policy]);
  useEffect(() => { save(KEY_SPEED, vitesse); }, [vitesse]);

  // Auto-select the first schedule once data loads.
  useEffect(() => {
    const first = data?.schedules?.[0]?.schedule ?? null;
    if (data && (!selected || !data.schedules.some((s) => s.schedule === selected))) {
      setSelected(first);
    }
  }, [data, selected]);

  const schedules = data?.schedules ?? [];

  // Filtered rows for the selected schedule. Mirrors the planner's Excel formula:
  //   - drop QC samples (item name starting with "Vacuum")
  //   - drop "off-coater" operations (second op-step = 90)
  //   - drop rows with no remaining requirement (reqLites = 0)
  // Then layer the user-driven filters (qualité / pdp / mtoMts) and the
  // active sort. Default sort matches the planner's Excel formula
  // (longueur DESC, PDP DESC, name ASC).
  const visibleRows: DisplayRow[] = useMemo(() => {
    const policyMap = policy?.map ?? {};
    const baseFiltered = (data?.records ?? [])
      .filter((r) => r.schedule === selected)
      .filter((r) => !/^Vacuum/i.test(r.itemName))
      .filter((r) => r.opStepD !== 90)
      .filter((r) => (r.reqLites ?? 0) > 0);

    const decorated: DisplayRow[] = baseFiltered.map((r) => ({ ...r, mtoMts: policyMap[r.product] ?? '?' }));

    const userFiltered = decorated.filter((r) => {
      if (tableSettings.qualite.length > 0 && !tableSettings.qualite.includes(r.qualite)) return false;
      if (tableSettings.pdp.length > 0 && !tableSettings.pdp.includes(r.pdp)) return false;
      if (tableSettings.mtoMts.length > 0 && !tableSettings.mtoMts.includes(r.mtoMts as 'MTO' | 'MTS' | '?')) return false;
      return true;
    });

    userFiltered.sort((a, b) => {
      const primary = compareRows(a, b, tableSettings.sortKey, tableSettings.sortDir);
      if (primary !== 0) return primary;
      // Stable secondary tiebreakers preserving the planner's intent.
      if (tableSettings.sortKey !== 'longueur' && b.longueur !== a.longueur) return b.longueur - a.longueur;
      if ((b.pdp || '') !== (a.pdp || '')) return (b.pdp || '').localeCompare(a.pdp || '');
      return (a.itemName || '').localeCompare(b.itemName || '');
    });

    return userFiltered;
  }, [data, selected, policy, tableSettings]);

  // Available filter values come from the unfiltered, schedule-scoped pool so
  // the menu doesn't shrink as the user picks options.
  const availableFilters = useMemo(() => {
    const policyMap = policy?.map ?? {};
    const pool = (data?.records ?? [])
      .filter((r) => r.schedule === selected)
      .filter((r) => !/^Vacuum/i.test(r.itemName))
      .filter((r) => r.opStepD !== 90)
      .filter((r) => (r.reqLites ?? 0) > 0);
    const qualites = new Set<string>();
    const pdps = new Set<string>();
    const mtos = new Set<string>();
    for (const r of pool) {
      if (r.qualite) qualites.add(r.qualite);
      if (r.pdp) pdps.add(r.pdp);
      mtos.add(policyMap[r.product] ?? '?');
    }
    return {
      qualites: [...qualites].sort(),
      pdps: [...pdps].sort(),
      mtos: [...mtos].sort(),
    };
  }, [data, selected, policy]);

  const filteringActive =
    tableSettings.qualite.length > 0 ||
    tableSettings.pdp.length > 0 ||
    tableSettings.mtoMts.length > 0;

  function toggleSort(key: SortKey) {
    setTableSettings((s) => {
      if (s.sortKey === key) {
        return { ...s, sortDir: s.sortDir === 'asc' ? 'desc' : 'asc' };
      }
      // Numeric/date columns default to descending; text to ascending.
      const numeric: SortKey[] = ['longueur', 'schedLites', 'prodLites', 'reqLites', 'scraps', 'm2', 'dateDepart'];
      return { ...s, sortKey: key, sortDir: numeric.includes(key) ? 'desc' : 'asc' };
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

  function toggleColumnVisibility(key: string) {
    setTableSettings((s) => {
      const hidden = s.hidden.includes(key) ? s.hidden.filter((k) => k !== key) : [...s.hidden, key];
      return { ...s, hidden };
    });
  }

  const visibleColumns = useMemo(
    () => COLUMNS.filter((c) => !tableSettings.hidden.includes(c.key)),
    [tableSettings.hidden],
  );

  // Insert a break marker before each new longueur group (including the first).
  // Carries the longueur so the break row can render a section label.
  const groupedRows: GroupedItem[] = useMemo(() => {
    const out: GroupedItem[] = [];
    let prevLongueur: number | null = null;
    for (const r of visibleRows) {
      if (r.longueur !== prevLongueur) {
        out.push({ kind: 'break', id: `break-${prevLongueur}->${r.longueur}`, longueur: r.longueur });
      }
      out.push({ kind: 'row', row: r });
      prevLongueur = r.longueur;
    }
    return out;
  }, [visibleRows]);

  const coaterRows = useMemo(
    () => visibleRows.filter((r) => r.workCenter === 'Coater'),
    [visibleRows],
  );
  const coaterMin = minutesAt(coaterRows, vitesse);

  // Stats per schedule, recomputed against the same filters so the rail and
  // detail header mirror what the user actually sees in the table.
  const railStats = useMemo(() => {
    const stats = new Map<string, RailStat>();
    for (const r of data?.records ?? []) {
      if (/^Vacuum/i.test(r.itemName)) continue;
      if (r.opStepD === 90) continue;
      if ((r.reqLites ?? 0) <= 0) continue;
      const cur = stats.get(r.schedule) ?? { count: 0, lites: 0, m2: 0 };
      cur.count += 1;
      cur.lites += r.schedLites ?? 0;
      cur.m2 += r.m2;
      stats.set(r.schedule, cur);
    }
    return stats;
  }, [data]);

  const selectedSchedule = schedules.find((s) => s.schedule === selected);

  function handlePms230Confirm(parsed: PMS230Result, mode: ImportMode) {
    const snapshot = data;
    const snapshotSelected = selected;
    setData((prev) => (mode === 'append' ? mergePMS230(prev, parsed) : parsed));
    setImportMode(null);
    if (mode === 'replace' && snapshot) {
      toast.show({
        message: 'Rapport remplacé',
        undo: () => {
          setData(snapshot);
          setSelected(snapshotSelected);
        },
      });
    }
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
    <div className="sch">
      <SummaryBar
        data={data}
        policy={policy}
        onImport={() => setImportMode('pms230')}
        onPolicy={() => setImportMode('policy')}
        onClear={() => {
          const snapshot = data;
          const snapshotSelected = selected;
          setData(null);
          setSelected(null);
          if (!snapshot) return;
          toast.show({
            message: 'Rapport Operator Mashup effacé',
            undo: () => {
              setData(snapshot);
              setSelected(snapshotSelected);
            },
          });
        }}
      />

      {!data && (
        <div className="sch-empty">
          <h3>Aucun rapport importé</h3>
        </div>
      )}

      {data && !policy && (
        <div className="sch-hint">
          <span>↪ Importer la table <strong>Item number → Planning policy</strong> pour voir la colonne MTO/MTS.</span>
          <button className="btn mini" onClick={() => setImportMode('policy')}>Importer</button>
        </div>
      )}

      {data && (
        <div className="sch-body">
          <aside className="sch-rail">
            <h4 className="sch-rail-title">
              Planning <span className="faint">· {schedules.length}</span>
            </h4>
            <ul className="sch-rail-list">
              {schedules.map((s) => {
                const stat = railStats.get(s.schedule) ?? { count: 0, lites: 0, m2: 0 };
                return (
                  <li key={s.schedule}>
                    <button
                      type="button"
                      className={`sch-rail-item ${selected === s.schedule ? 'active' : ''}`}
                      onClick={() => setSelected(s.schedule)}
                    >
                      <div className="sch-rail-top">
                        <span className="mono sch-rail-num">{s.schedule}</span>
                        <span className="sch-rail-root">{s.itemRoot || '—'}</span>
                      </div>
                      <div className="sch-rail-meta faint small mono">
                        {stat.count} ligne{stat.count > 1 ? 's' : ''} · {fmtNum(stat.m2, 0)} m²
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          <section className="sch-detail">
            {selectedSchedule && (() => {
              const stat = railStats.get(selectedSchedule.schedule) ?? { count: 0, lites: 0, m2: 0 };
              return (
                <header className="sch-detail-head">
                  <h3>
                    <span className="mono">{selectedSchedule.schedule}</span>
                    <span className="faint"> — </span>
                    <span>{selectedSchedule.itemRoot}</span>
                  </h3>
                  <span className="faint small">
                    {stat.count} ligne{stat.count > 1 ? 's' : ''} · {stat.lites} lites · {stat.m2.toFixed(2)} m²
                  </span>
                </header>
              );
            })()}

            <TableControls
              settings={tableSettings}
              available={availableFilters}
              filteringActive={filteringActive}
              colsMenuOpen={colsMenuOpen}
              onColsMenuToggle={() => setColsMenuOpen((v) => !v)}
              onColsMenuClose={() => setColsMenuOpen(false)}
              onToggleFilterValue={toggleFilterValue}
              onClearFilters={clearFilters}
              onToggleColumn={toggleColumnVisibility}
            />

            <ScheduleTable
              items={groupedRows}
              totals={visibleRows}
              onRowOpen={handleRowOpen}
              columns={visibleColumns}
              sortKey={tableSettings.sortKey}
              sortDir={tableSettings.sortDir}
              onSort={toggleSort}
            />

            <ThroughputFooter
              rows={coaterRows}
              vitesse={vitesse}
              onVitesseChange={setVitesse}
              minutes={coaterMin}
            />
          </section>
        </div>
      )}

      {importMode === 'pms230' && (
        <PasteImport<PMS230Result>
          title="Importer le rapport Operator Mashup"
          hint="Dans l'Operator Mashup, ouvrir Post Production Report. Ctrl+A puis Ctrl+C, et coller ci-dessous."
          parser={parsePMS230}
          describe={describePMS230}
          showAppend={!!data}
          onConfirm={handlePms230Confirm}
          onClose={() => setImportMode(null)}
        />
      )}
      {importMode === 'policy' && (
        <PasteImport<PolicyResult>
          title="Importer la table MTO/MTS"
          hint="Colle les colonnes Item number / Name / Planning policy depuis ton tableur."
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
    </div>
  );
}

interface SummaryBarProps {
  data: PMS230Result | null;
  policy: PolicyResult | null;
  onImport: () => void;
  onPolicy: () => void;
  onClear: () => void;
}

function SummaryBar({ data, policy, onImport, onPolicy, onClear }: SummaryBarProps) {
  const records = data?.records?.length ?? 0;
  const schedules = data?.schedules?.length ?? 0;
  const m2 = data ? totalM2(data.records).toFixed(2) : null;
  const policyCount = policy?.count ?? 0;
  const importedAt = data?.importedAt ? new Date(data.importedAt) : null;
  const pageWarn = data?.totalPages && data.totalPages > 1;

  return (
    <div className="sch-summary">
      <div className="sch-summary-actions">
        <button className="btn primary" onClick={onImport}>
          {data ? 'Réimporter rapport Operator Mashup' : 'Importer rapport Operator Mashup'}
        </button>
        <button className={`btn ${policy ? 'ghost' : ''}`} onClick={onPolicy}>
          {policy ? `Politique MTO/MTS · ${policyCount} produits` : 'Importer politique MTO/MTS'}
        </button>
        {data && (
          <button
            className="btn destructive"
            onClick={onClear}
            style={{ marginLeft: 'auto' }}
            title="Effacer le rapport Operator Mashup (la table MTO/MTS est conservée)"
          >
            ⚠ Vider
          </button>
        )}
      </div>
      {data && (
        <div className="sch-summary-stats">
          <span><strong className="mono">{schedules}</strong> schedules</span>
          <span><strong className="mono">{records}</strong> lignes</span>
          <span><strong className="mono">{m2}</strong> m²</span>
          {importedAt && (
            <span className="faint small">
              importé {importedAt.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
          )}
          {pageWarn && (
            <span className="sch-warn-chip" title="Le paste ne couvre qu'une partie du rapport">
              ⚠ Page {data.currentPage}/{data.totalPages} — colle les pages suivantes (bouton Ajouter)
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
  onRowOpen: (row: DisplayRow) => void;
  columns: ColumnDef[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
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
  scraps: '72px',
  format: '116px',
  qualite: '68px',
  litesPerPack: '68px',
  pdp: 'minmax(100px, 1fr)',
  m2: '88px',
};

function ScheduleTable({ items, totals, onRowOpen, columns, sortKey, sortDir, onSort }: ScheduleTableProps) {
  if (totals.length === 0) {
    return (
      <div className="sch-empty-rows faint">
        Aucune ligne pour ce schedule.
      </div>
    );
  }

  const gridTemplate = columns.map((c) => COL_WIDTHS[c.key] || 'auto').join(' ');
  // Sum the numeric components to set a reasonable min-width that keeps the
  // table from collapsing in narrow viewports.
  const minPx = columns.reduce((acc, c) => {
    const w = COL_WIDTHS[c.key] || '';
    const m = /^(\d+)px$/.exec(w);
    if (m) return acc + parseInt(m[1], 10);
    if (w.includes('minmax')) {
      const mm = /minmax\((\d+)px/.exec(w);
      if (mm) return acc + parseInt(mm[1], 10);
    }
    return acc + 80;
  }, 0);

  return (
    <div
      className="sch-table"
      role="table"
      style={{ ['--sch-grid' as string]: gridTemplate, ['--sch-min' as string]: `${minPx}px` }}
    >
      <div className="sch-row sch-head" role="row">
        {columns.map((c) => {
          const sortable = !!c.sortKey;
          const isSorted = sortable && c.sortKey === sortKey;
          const dirIndicator = isSorted ? (sortDir === 'asc' ? '▲' : '▼') : '';
          return (
            <div
              key={c.key}
              className={`sch-cell ${c.cls} ${sortable ? 'is-sortable' : ''} ${isSorted ? 'is-sorted' : ''}`}
              role="columnheader"
              aria-sort={isSorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
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
            >
              {c.label}
              {dirIndicator && <span className="sch-sort-arrow" aria-hidden="true">{dirIndicator}</span>}
            </div>
          );
        })}
      </div>
      {items.map((it) =>
        it.kind === 'break'
          ? (
            <div key={it.id} className="sch-row sch-group-break" role="row">
              <div className="sch-group-label">{fmtNum(it.longueur, 0)} mm</div>
            </div>
          )
          : <ScheduleRow key={it.row.id} row={it.row} onOpen={onRowOpen} columns={columns} />
      )}
      <TotalRow rows={totals} columns={columns} />
    </div>
  );
}

interface TableControlsProps {
  settings: TableSettings;
  available: { qualites: string[]; pdps: string[]; mtos: string[] };
  filteringActive: boolean;
  colsMenuOpen: boolean;
  onColsMenuToggle: () => void;
  onColsMenuClose: () => void;
  onToggleFilterValue: (field: 'qualite' | 'pdp' | 'mtoMts', value: string) => void;
  onClearFilters: () => void;
  onToggleColumn: (key: string) => void;
}

function TableControls({
  settings,
  available,
  filteringActive,
  colsMenuOpen,
  onColsMenuToggle,
  onColsMenuClose,
  onToggleFilterValue,
  onClearFilters,
  onToggleColumn,
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
      <div className="sch-cols-wrap" ref={colsBtnRef} style={{ marginLeft: 'auto' }}>
        <button
          type="button"
          className="btn ghost mini"
          onClick={onColsMenuToggle}
          aria-expanded={colsMenuOpen}
        >
          Colonnes ⌄
        </button>
        {colsMenuOpen && (
          <div className="popover sch-cols-menu" role="menu">
            <h4>Afficher les colonnes</h4>
            {OPTIONAL_COLUMN_KEYS.map((k) => {
              const col = COLUMNS.find((c) => c.key === k)!;
              const visible = !settings.hidden.includes(k);
              return (
                <label key={k} className="sch-cols-opt">
                  <input
                    type="checkbox"
                    checked={visible}
                    onChange={() => onToggleColumn(k)}
                  />
                  <span>{col.label}</span>
                </label>
              );
            })}
          </div>
        )}
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
  columns: ColumnDef[];
}

function renderRowCell(col: ColumnDef, row: DisplayRow): ReactNode {
  switch (col.key) {
    case 'mtoMts':
      return <span className="sch-mto" data-mto={row.mtoMts}>{row.mtoMts}</span>;
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
    case 'scraps':       return row.scraps ?? 0;
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
    case 'pdp':          return row.pdp;
    case 'm2':           return fmtNum(row.m2, 2);
    default:             return null;
  }
}

const ScheduleRow = memo(function ScheduleRow({ row, onOpen, columns }: ScheduleRowProps) {
  const isQc = row.largeur === 0 && row.longueur === 0;
  const open = () => onOpen(row);
  return (
    <button
      type="button"
      className={`sch-row sch-row-clickable as-row ${isQc ? 'is-qc' : ''}`}
      onClick={open}
      aria-label={`Détails ${row.product} ${row.itemName}`}
    >
      {columns.map((c) => {
        const monoExtra =
          c.key === 'dateDepart' || c.key === 'mo' || c.key === 'product' ||
          c.key === 'schedLites' || c.key === 'prodLites' || c.key === 'reqLites' ||
          c.key === 'scraps' || c.key === 'format' || c.key === 'qualite' ||
          c.key === 'litesPerPack' || c.key === 'm2'
            ? 'mono'
            : '';
        const titleAttr = c.key === 'pdp' ? row.pdp : undefined;
        return (
          <span
            key={c.key}
            className={`sch-cell ${c.cls} ${monoExtra}`}
            title={titleAttr}
          >
            {renderRowCell(c, row)}
          </span>
        );
      })}
    </button>
  );
});

function TotalRow({ rows, columns }: { rows: DisplayRow[]; columns: ColumnDef[] }) {
  const sched = totalLites(rows);
  const prod = rows.reduce((s, r) => s + (r.prodLites ?? 0), 0);
  const req = totalReqLites(rows);
  const m2 = totalM2(rows);
  const labelEndIdx = columns.findIndex((c) => c.key === 'schedLites');
  return (
    <div className="sch-row sch-total" role="row">
      {columns.map((c, i) => {
        if (labelEndIdx > 0 && i < labelEndIdx) {
          if (i === 0) {
            return (
              <div
                key={c.key}
                className="sch-cell sch-total-label"
                role="cell"
                style={{ gridColumn: `1 / ${labelEndIdx + 1}` }}
              >
                <span>Total</span>
                <span className="faint small">{rows.length} ligne{rows.length > 1 ? 's' : ''}</span>
              </div>
            );
          }
          return null;
        }
        let content: ReactNode = '';
        if (c.key === 'schedLites') content = <strong>{sched}</strong>;
        else if (c.key === 'prodLites') content = <strong>{prod}</strong>;
        else if (c.key === 'reqLites') content = <strong>{req}</strong>;
        else if (c.key === 'm2') content = <strong>{fmtNum(m2, 2)}</strong>;
        return (
          <div key={c.key} className={`sch-cell ${c.cls} mono`} role="cell">{content}</div>
        );
      })}
    </div>
  );
}

interface ThroughputFooterProps {
  rows: PMS230Record[];
  vitesse: number | string;
  onVitesseChange: (v: number | string) => void;
  minutes: number | null;
}

function ThroughputFooter({ rows, vitesse, onVitesseChange, minutes }: ThroughputFooterProps) {
  const validSpeed = Number.isFinite(Number(vitesse)) && Number(vitesse) > 0;
  return (
    <div className="sch-foot">
      <label className={`sch-foot-vitesse ${!validSpeed ? 'is-invalid' : ''}`}>
        <span className="sch-foot-label">Vitesse</span>
        <input
          type="number"
          min="0.1"
          step="0.1"
          className="sch-vitesse-input mono"
          value={vitesse}
          onChange={(e) => onVitesseChange(e.target.value === '' ? '' : Number(e.target.value))}
          aria-label="Vitesse en m/min"
        />
        <span className="sch-foot-unit">m/min</span>
      </label>
      <span className="sch-foot-arrow" aria-hidden="true">→</span>
      <div className="sch-foot-times">
        <div className="sch-foot-time">
          <span className="sch-foot-time-label">Théorique</span>
          <strong className="mono">{fmtHMmin(minutes)}</strong>
        </div>
        <div
          className="sch-foot-time sch-foot-dt"
          title="Temps théorique majoré du facteur d'arrêts (DT, downtime) de 9 %"
        >
          <span className="sch-foot-time-label">+DT 9 %</span>
          <strong className="mono">{fmtHMmin(minutes != null ? minutes * DOWNTIME_FACTOR : null)}</strong>
        </div>
      </div>
      <span className="faint small sch-foot-meta">{rows.length} lignes Coater</span>
    </div>
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

  const format = row.largeur && row.longueur
    ? `${fmtNum(row.largeur, 0)} × ${fmtNum(row.longueur, 0)} mm`
    : '—';
  const formatInch = row.largeurInch && row.longueurInch
    ? `${row.largeurInch} × ${row.longueurInch} in`
    : '';
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
            <span className="sch-mto" data-mto={mtoMts}>{mtoMts}</span>
            <h3 className="mono">{row.product}</h3>
            <span className="faint small mono">{row.mo}</span>
          </div>
          <button className="btn ghost icon" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        <div className="sch-row-sheet-name">
          <div className="sch-row-sheet-itemname">{row.itemName || <span className="faint">(sans nom)</span>}</div>
          {row.customer && <div className="faint small">{row.customer}</div>}
        </div>

        <dl className="sch-row-sheet-grid">
          <DetailField label="Planning" value={<span className="mono">{row.schedule}{row.schedSuffix ? `-${row.schedSuffix}` : ''}</span>} />
          <DetailField label="Étapes" value={<span className="mono">{row.opSteps || '—'}</span>} />
          <DetailField label="Centre de travail" value={row.workCenter || '—'} />
          <DetailField label="Date départ" value={<span className="mono">{fmtDateLong(row.dateDepart)}</span>} />
          <DetailField label="Qualité" value={<span className="mono">{row.qualite || '—'}</span>} />
          <DetailField label="PDP" value={row.pdp || '—'} />
        </dl>

        <div className="sch-row-sheet-section">
          <div className="sch-row-sheet-section-title">Quantités (lites)</div>
          <div className="sch-row-sheet-stats">
            <Stat label="Sched" value={row.schedLites} />
            <Stat label="Prod" value={row.prodLites ?? 0} />
            <Stat label="Req" value={row.reqLites} highlight />
            <Stat label="Scraps" value={row.scraps ?? 0} />
            <Stat label="L/Pack" value={row.litesPerPack ?? '—'} />
          </div>
        </div>

        <div className="sch-row-sheet-section">
          <div className="sch-row-sheet-section-title">Format</div>
          <div className="sch-row-sheet-stats">
            <Stat label="Largeur × Longueur" value={format} wide />
            <Stat label="m² restant" value={fmtNum(row.m2, 2)} highlight />
            {row.thickness && <Stat label="Épaisseur" value={`${row.thickness} mm`} />}
            {formatInch && <Stat label="Pouces" value={formatInch} wide />}
            {row.formatCode && <Stat label="Code format" value={<span className="mono">{row.formatCode}</span>} />}
          </div>
        </div>

        {(row.startDate || row.endDate) && (
          <div className="sch-row-sheet-section">
            <div className="sch-row-sheet-section-title">Planning</div>
            <dl className="sch-row-sheet-grid">
              <DetailField label="Début" value={<span className="mono">{start}</span>} />
              <DetailField label="Fin" value={<span className="mono">{end}</span>} />
            </dl>
          </div>
        )}
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
}

function Stat({ label, value, highlight, wide }: StatProps) {
  return (
    <div className={`sch-row-sheet-stat ${highlight ? 'is-highlight' : ''} ${wide ? 'is-wide' : ''}`}>
      <span className="sch-row-sheet-stat-label">{label}</span>
      <strong className="mono">{value}</strong>
    </div>
  );
}
