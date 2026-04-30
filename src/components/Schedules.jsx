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
  const visibleRows = useMemo(() => {
    const rows = (data?.records ?? []).filter((r) => r.schedule === selected);
    const policyMap = policy?.map ?? {};
    return rows.map((r) => ({ ...r, mtoMts: policyMap[r.product] ?? '?' }));
  }, [data, selected, policy]);

  const coaterRows = useMemo(
    () => visibleRows.filter((r) => r.workCenter === 'Coater'),
    [visibleRows],
  );
  const coaterMin = minutesAt(coaterRows, vitesse);

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
      />

      {!data && (
        <div className="sch-empty">
          <h3>Aucun rapport importé</h3>
          <p className="faint">
            Ouvre PMS230, exécute le <em>Post Production Report</em>, puis Ctrl+A · Ctrl+C
            et colle ici.
          </p>
          <button className="btn primary" onClick={() => setImportMode('pms230')}>
            Importer rapport PMS230
          </button>
        </div>
      )}

      {data && (
        <div className="sch-body">
          <aside className="sch-rail">
            <h4 className="sch-rail-title">Schedules</h4>
            <ul className="sch-rail-list">
              {schedules.map((s) => (
                <li key={s.schedule}>
                  <button
                    type="button"
                    className={`sch-rail-item ${selected === s.schedule ? 'active' : ''}`}
                    onClick={() => setSelected(s.schedule)}
                    title={`${s.recordCount} lignes · ${s.totalM2.toFixed(2)} m²`}
                  >
                    <span className="mono">{s.schedule}</span>
                    <span className="faint small">{s.itemRoot || '—'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <section className="sch-detail">
            {selectedSchedule && (
              <header className="sch-detail-head">
                <h3>
                  <span className="mono">{selectedSchedule.schedule}</span>
                  <span className="faint"> — </span>
                  <span>{selectedSchedule.itemRoot}</span>
                </h3>
                <span className="faint small">
                  {selectedSchedule.recordCount} lignes · {selectedSchedule.totalLites} lites · {selectedSchedule.totalM2.toFixed(2)} m²
                </span>
              </header>
            )}

            <ScheduleTable rows={visibleRows} />

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

function SummaryBar({ data, policy, onImport, onPolicy }) {
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

function ScheduleTable({ rows }) {
  if (rows.length === 0) {
    return <div className="sch-empty-rows faint">Aucune ligne pour ce schedule.</div>;
  }

  return (
    <div className="sch-table" role="table">
      <div className="sch-row sch-head" role="row">
        {COLUMNS.map((c) => (
          <div key={c.key} className={`sch-cell ${c.cls}`} role="columnheader">{c.label}</div>
        ))}
      </div>
      {rows.map((r) => (
        <ScheduleRow key={r.id} row={r} />
      ))}
      <TotalRow rows={rows} />
    </div>
  );
}

const ScheduleRow = memo(function ScheduleRow({ row }) {
  const isQc = row.largeur === 0 && row.longueur === 0;
  return (
    <div className={`sch-row ${isQc ? 'is-qc' : ''}`} role="row" title={row.customer || undefined}>
      <div className="sch-cell col-mto" role="cell">
        <span className={`sch-mto sch-mto-${row.mtoMts.toLowerCase()}`}>{row.mtoMts}</span>
      </div>
      <div className="sch-cell col-date mono" role="cell">{fmtDate(row.dateDepart)}</div>
      <div className="sch-cell col-mo mono" role="cell">{row.mo}</div>
      <div className="sch-cell col-prod mono" role="cell">{row.product}</div>
      <div className="sch-cell col-name" role="cell">{row.itemName}</div>
      <div className="sch-cell col-num mono" role="cell">{row.schedLites || ''}</div>
      <div className="sch-cell col-num mono" role="cell">{row.prodLites || 0}</div>
      <div className="sch-cell col-num mono" role="cell">{row.reqLites || ''}</div>
      <div className="sch-cell col-num mono" role="cell">{row.scraps ? fmtNum(row.scraps, 2) : 0}</div>
      <div className="sch-cell col-num mono" role="cell">{row.largeur ? fmtNum(row.largeur, 0) : ''}</div>
      <div className="sch-cell col-num mono" role="cell">{row.longueur ? fmtNum(row.longueur, 0) : ''}</div>
      <div className="sch-cell col-q mono" role="cell">{row.qualite}</div>
      <div className="sch-cell col-num mono" role="cell">{row.litesPerPack ?? ''}</div>
      <div className="sch-cell col-pdp" role="cell">{row.pdp}</div>
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
      <div className="sch-cell col-mto" role="cell" />
      <div className="sch-cell col-date" role="cell" />
      <div className="sch-cell col-mo" role="cell" />
      <div className="sch-cell col-prod" role="cell" />
      <div className="sch-cell col-name" role="cell"><strong>Total</strong></div>
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
  return (
    <div className="sch-foot">
      <label className="sch-foot-vitesse">
        <span className="faint small">Vitesse</span>
        <input
          type="number"
          min="0.1"
          step="0.1"
          className="sch-vitesse-input mono"
          value={vitesse}
          onChange={(e) => onVitesseChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
        <span className="faint small">m/min</span>
      </label>
      <span className="sch-foot-arrow faint">→</span>
      <span className="sch-foot-time mono">
        <span className="faint small">à {vitesse || '?'} m/min</span>
        <strong>{fmtHMmin(minutes)}</strong>
      </span>
      <span className="sch-foot-time sch-foot-dt mono">
        <span className="faint small">+9% DT</span>
        <strong>{fmtHMmin(minutes != null ? minutes * DOWNTIME_FACTOR : null)}</strong>
      </span>
      <span className="faint small">{rows.length} lignes Coater</span>
    </div>
  );
}
