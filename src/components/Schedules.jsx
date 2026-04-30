import { memo, useEffect, useMemo, useState } from 'react';
import { load, save } from '../lib/storage.js';
import { mergePMS230, parsePMS230 } from '../lib/pms230Parser.js';
import { parsePolicy } from '../lib/policyParser.js';
import {
  DOWNTIME_FACTOR,
  fmtHMmin,
  minutesAt,
  totalLites,
  totalM2,
  totalReqLites,
} from '../lib/coaterMath.js';
import PasteImport from './PasteImport.jsx';

const KEY_DATA   = 'wb.schedules.v1';
const KEY_POLICY = 'wb.schedules.policy.v1';
const KEY_SPEED  = 'wb.schedules.vitesse';

const COLUMNS = [
  { key: 'mtoMts',     label: 'MTO/MTS',  cls: 'col-mto'  },
  { key: 'dateDepart', label: 'Date Départ', cls: 'col-date' },
  { key: 'mo',         label: 'MO',       cls: 'col-mo'   },
  { key: 'product',    label: 'Product',  cls: 'col-prod' },
  { key: 'itemName',   label: 'Item Name', cls: 'col-name' },
  { key: 'schedLites', label: 'Sched',    cls: 'col-num'  },
  { key: 'prodLites',  label: 'Prod',     cls: 'col-num'  },
  { key: 'reqLites',   label: 'Req',      cls: 'col-num'  },
  { key: 'scraps',     label: 'Scraps',   cls: 'col-num'  },
  { key: 'largeur',    label: 'Largeur',  cls: 'col-num'  },
  { key: 'longueur',   label: 'Longueur', cls: 'col-num'  },
  { key: 'qualite',    label: 'Qualité',  cls: 'col-q'    },
  { key: 'litesPerPack', label: 'Lites/Packs', cls: 'col-num' },
  { key: 'pdp',        label: 'PDP',      cls: 'col-pdp'  },
  { key: 'm2',         label: 'm² restants', cls: 'col-m2' },
];

function describePMS230(r) {
  const records = r.records?.length ?? 0;
  const schedules = r.schedules?.length ?? 0;
  const m2 = totalM2(r.records ?? []);
  const page = r.totalPages ? ` · page ${r.currentPage}/${r.totalPages}` : '';
  return `✓ ${records} lignes · ${schedules} schedule${schedules > 1 ? 's' : ''} · ${m2.toFixed(2)} m²${page}`;
}

function describePolicy(r) {
  return `✓ ${r.count} produits chargés`;
}

function fmtDate(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length !== 8) return '';
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6)}`;
}

function fmtNum(n, digits = 0) {
  if (n == null || !Number.isFinite(n)) return '';
  return n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default function Schedules() {
  const [data, setData] = useState(() => load(KEY_DATA, null));
  const [policy, setPolicy] = useState(() => load(KEY_POLICY, null));
  const [vitesse, setVitesse] = useState(() => load(KEY_SPEED, 6));
  const [selected, setSelected] = useState(() => null);
  const [importMode, setImportMode] = useState(null); // null | 'pms230' | 'policy'

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
  // Sort by longueur DESC, PDP DESC, item name ASC — same keys as the formula.
  const visibleRows = useMemo(() => {
    const policyMap = policy?.map ?? {};
    const filtered = (data?.records ?? [])
      .filter((r) => r.schedule === selected)
      .filter((r) => !/^Vacuum/i.test(r.itemName))
      .filter((r) => r.opStepD !== 90)
      .filter((r) => (r.reqLites ?? 0) > 0);

    filtered.sort((a, b) => {
      if (b.longueur !== a.longueur) return b.longueur - a.longueur;
      if ((b.pdp || '') !== (a.pdp || '')) return (b.pdp || '').localeCompare(a.pdp || '');
      return (a.itemName || '').localeCompare(b.itemName || '');
    });

    return filtered.map((r) => ({ ...r, mtoMts: policyMap[r.product] ?? '?' }));
  }, [data, selected, policy]);

  // Insert a break marker before each new longueur group (skip the first).
  // Renders as a blank divider row, mirroring the formula's blankRow VSTACK.
  const groupedRows = useMemo(() => {
    const out = [];
    let prevLongueur = null;
    for (const r of visibleRows) {
      if (prevLongueur !== null && r.longueur !== prevLongueur) {
        out.push({ kind: 'break', id: `break-${prevLongueur}->${r.longueur}` });
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
    const stats = new Map();
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

  function handlePms230Confirm(parsed, mode) {
    setData((prev) => (mode === 'append' ? mergePMS230(prev, parsed) : parsed));
    setImportMode(null);
  }
  function handlePolicyConfirm(parsed) {
    setPolicy(parsed);
    setImportMode(null);
  }

  return (
    <div className="sch">
      <SummaryBar
        data={data}
        policy={policy}
        onImport={() => setImportMode('pms230')}
        onPolicy={() => setImportMode('policy')}
        onClear={() => {
          if (window.confirm('Effacer le rapport PMS230 ?')) {
            setData(null);
            setSelected(null);
          }
        }}
      />

      {!data && (
        <div className="sch-empty">
          <h3>Aucun rapport importé</h3>
          <p className="faint">
            Ouvre PMS230, exécute le <em>Post Production Report</em>, puis Ctrl+A · Ctrl+C
            et colle ici. Importe aussi la table <strong>Item number → Planning policy</strong>{' '}
            depuis ton tableur pour afficher la colonne MTO/MTS.
          </p>
          <div className="row gap-2">
            <button className="btn primary" onClick={() => setImportMode('pms230')}>
              Importer rapport PMS230
            </button>
            <button className="btn" onClick={() => setImportMode('policy')}>
              {policy ? `Politique chargée (${policy.count})` : 'Importer politique MTO/MTS'}
            </button>
          </div>
        </div>
      )}

      {data && !policy && (
        <div className="sch-hint">
          <span>↪ Importe la table <strong>Item number → Planning policy</strong> pour voir la colonne MTO/MTS.</span>
          <button className="btn mini" onClick={() => setImportMode('policy')}>Importer</button>
        </div>
      )}

      {data && (
        <div className="sch-body">
          <aside className="sch-rail">
            <h4 className="sch-rail-title">
              Schedules <span className="faint">· {schedules.length}</span>
            </h4>
            <ul className="sch-rail-list">
              {schedules.map((s) => {
                const stat = railStats.get(s.schedule) ?? { count: 0, m2: 0 };
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

            <ScheduleTable items={groupedRows} totals={visibleRows} />

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
        <PasteImport
          title="Importer le rapport PMS230"
          hint="Sur PMS230, va dans Post Production Report. Ctrl+A puis Ctrl+C, et colle ci-dessous."
          parser={parsePMS230}
          describe={describePMS230}
          showAppend={!!data}
          onConfirm={handlePms230Confirm}
          onClose={() => setImportMode(null)}
        />
      )}
      {importMode === 'policy' && (
        <PasteImport
          title="Importer la table MTO/MTS"
          hint="Colle les colonnes Item number / Name / Planning policy depuis ton tableur."
          parser={parsePolicy}
          describe={describePolicy}
          onConfirm={handlePolicyConfirm}
          onClose={() => setImportMode(null)}
        />
      )}
    </div>
  );
}

function SummaryBar({ data, policy, onImport, onPolicy, onClear }) {
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
          {data ? 'Réimporter rapport PMS230' : 'Importer rapport PMS230'}
        </button>
        <button className={`btn ${policy ? 'ghost' : ''}`} onClick={onPolicy}>
          {policy ? `Politique MTO/MTS · ${policyCount} produits` : 'Importer politique MTO/MTS'}
        </button>
        {data && (
          <button
            className="btn ghost danger"
            onClick={onClear}
            style={{ marginLeft: 'auto' }}
            title="Effacer le rapport PMS230 (la table MTO/MTS est conservée)"
          >
            Vider
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

function ScheduleTable({ items, totals }) {
  if (totals.length === 0) {
    return (
      <div className="sch-empty-rows faint">
        Aucune ligne pour ce schedule (après filtres : pas de QC, op-step ≠ 90, requis &gt; 0).
      </div>
    );
  }

  return (
    <div className="sch-table" role="table">
      <div className="sch-row sch-head" role="row">
        {COLUMNS.map((c) => (
          <div key={c.key} className={`sch-cell ${c.cls}`} role="columnheader">{c.label}</div>
        ))}
      </div>
      {items.map((it) =>
        it.kind === 'break'
          ? <div key={it.id} className="sch-row sch-group-break" role="separator" aria-hidden="true" />
          : <ScheduleRow key={it.row.id} row={it.row} />
      )}
      <TotalRow rows={totals} />
    </div>
  );
}

const ScheduleRow = memo(function ScheduleRow({ row }) {
  const isQc = row.largeur === 0 && row.longueur === 0;
  return (
    <div className={`sch-row ${isQc ? 'is-qc' : ''}`} role="row">
      <div className="sch-cell col-mto" role="cell">
        <span className="sch-mto" data-mto={row.mtoMts}>{row.mtoMts}</span>
      </div>
      <div className="sch-cell col-date mono" role="cell">{fmtDate(row.dateDepart)}</div>
      <div className="sch-cell col-mo mono" role="cell">{row.mo}</div>
      <div className="sch-cell col-prod mono" role="cell">{row.product}</div>
      <div className="sch-cell col-name" role="cell">
        <div className="sch-name" title={row.itemName}>{row.itemName}</div>
        {row.customer && <div className="sch-customer faint" title={row.customer}>{row.customer}</div>}
      </div>
      <div className="sch-cell col-num mono" role="cell">{row.schedLites || ''}</div>
      <div className="sch-cell col-num mono" role="cell">{row.prodLites ?? 0}</div>
      <div className="sch-cell col-num mono" role="cell">{row.reqLites || ''}</div>
      <div className="sch-cell col-num mono" role="cell">{row.scraps ?? 0}</div>
      <div className="sch-cell col-num mono" role="cell">{row.largeur ? fmtNum(row.largeur, 0) : ''}</div>
      <div className="sch-cell col-num mono" role="cell">{row.longueur ? fmtNum(row.longueur, 0) : ''}</div>
      <div className="sch-cell col-q mono" role="cell">{row.qualite}</div>
      <div className="sch-cell col-num mono" role="cell">{row.litesPerPack ?? ''}</div>
      <div className="sch-cell col-pdp" role="cell" title={row.pdp}>{row.pdp}</div>
      <div className="sch-cell col-m2 mono" role="cell">{fmtNum(row.m2, 2)}</div>
    </div>
  );
});

function TotalRow({ rows }) {
  const sched = totalLites(rows);
  const req = totalReqLites(rows);
  const m2 = totalM2(rows);
  return (
    <div className="sch-row sch-total" role="row">
      <div className="sch-cell sch-total-label" role="cell">
        <span>Total</span>
        <span className="faint small">{rows.length} ligne{rows.length > 1 ? 's' : ''}</span>
      </div>
      <div className="sch-cell col-num mono" role="cell"><strong>{sched}</strong></div>
      <div className="sch-cell col-num mono" role="cell" />
      <div className="sch-cell col-num mono" role="cell"><strong>{req}</strong></div>
      <div className="sch-cell col-num mono" role="cell" />
      <div className="sch-cell col-num mono" role="cell" />
      <div className="sch-cell col-num mono" role="cell" />
      <div className="sch-cell col-q" role="cell" />
      <div className="sch-cell col-num" role="cell" />
      <div className="sch-cell col-pdp" role="cell" />
      <div className="sch-cell col-m2 mono" role="cell"><strong>{fmtNum(m2, 2)}</strong></div>
    </div>
  );
}

function ThroughputFooter({ rows, vitesse, onVitesseChange, minutes }) {
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
        <span className="faint small">m/min</span>
      </label>
      <div className="sch-foot-times">
        <div className="sch-foot-time">
          <span className="sch-foot-time-label">à {validSpeed ? vitesse : '?'} m/min</span>
          <strong className="mono">{fmtHMmin(minutes)}</strong>
        </div>
        <div className="sch-foot-time sch-foot-dt">
          <span className="sch-foot-time-label">+9% DT</span>
          <strong className="mono">{fmtHMmin(minutes != null ? minutes * DOWNTIME_FACTOR : null)}</strong>
        </div>
      </div>
      <span className="faint small sch-foot-meta">{rows.length} lignes Coater</span>
    </div>
  );
}
