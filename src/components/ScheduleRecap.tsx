import { useMemo } from 'react';
import type { PMS230Record, PMS230Schedule } from '../lib/pms230Parser';
import { shortItemName } from '../lib/pms230Parser';
import { buildScheduleRecap } from '../lib/scheduleRecap';

// The schedule's second printout: a portrait sheet that groups what is left to
// produce by dimension and by thickness, with an empty column for the plate
// count the operator writes in front of the racks.
//
// Print-only by design. The detailed table stays on screen and stays the
// working tool — this is a paper form, not a second view of the planning, and
// showing it on screen would put a column nobody can fill in there.

interface ScheduleRecapProps {
  /** The rows the table itself shows: schedule-scoped, filtered, planning only. */
  rows: PMS230Record[];
  schedule: PMS230Schedule;
  /** Dominant short article name, as the detail header prints it. */
  shortName: string;
  importedAt?: string;
  /** Active filters, already summarised by the page ('' when none). */
  filterSummary: string;
}

const fmt = (n: number, digits = 0): string =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export default function ScheduleRecap({
  rows,
  schedule,
  shortName,
  importedAt,
  filterSummary,
}: ScheduleRecapProps) {
  const recap = useMemo(() => buildScheduleRecap(rows), [rows]);

  const name = shortName || shortItemName(schedule.itemRoot) || schedule.itemRoot;
  // Printed at, not imported at: the sheet is filled in by hand and filed, and
  // two of them on the same desk have to be tellable apart.
  const printedAt = new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

  return (
    <section className="sch-recap print-only">
      <header className="sch-recap-head">
        <h2 className="sch-recap-title">
          <span className="mono">{schedule.schedule}</span>
          <span className="sch-recap-title-sep"> — </span>
          <span>{name}</span>
          {recap.soleQualite && (
            <>
              <span className="sch-recap-title-sep"> — </span>
              <span>Qualité {recap.soleQualite}</span>
            </>
          )}
        </h2>
        {/* Same job as the detailed sheet's provenance line: off-screen the
            paper has to say where its figures came from and whether they are
            the whole picture. */}
        <div className="sch-recap-meta">
          {importedAt && (
            <span>
              rapport importé le{' '}
              {new Date(importedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
          )}
          <span>imprimé le {printedAt}</span>
          {filterSummary && <strong>filtré : {filterSummary}</strong>}
        </div>
      </header>

      <table className="sch-recap-table">
        <colgroup>
          <col style={{ width: '44%' }} />
          <col style={{ width: '15%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '25%' }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="sch-recap-col-label">Dimension · épaisseur</th>
            <th scope="col" className="sch-recap-col-num">Lites restantes</th>
            <th scope="col" className="sch-recap-col-fill">Plaques dispo.</th>
            <th scope="col" className="sch-recap-col-fill">Commentaires</th>
          </tr>
        </thead>

        {recap.lines === 0 ? (
          <tbody>
            <tr className="sch-recap-empty">
              <td colSpan={4}>Aucune ligne à produire sur ce schedule.</td>
            </tr>
          </tbody>
        ) : (
          recap.qualities.map((q) => (
            <QualityBlock key={q.qualite} group={q} showQualite={recap.multiQuality} />
          ))
        )}

        <tfoot>
          <tr className="sch-recap-total">
            <th scope="row">
              Total
              <span className="sch-recap-total-sub">
                {' '}· {fmt(recap.m2)} m² · {recap.groups} regroupement{recap.groups > 1 ? 's' : ''}
              </span>
            </th>
            <td className="sch-recap-num mono">{fmt(recap.reqLites)}</td>
            {/* No writing box on a total: plates are counted per dimension and
                thickness, and a box here would invite a figure nothing checks. */}
            <td className="sch-recap-blank" colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

function QualityBlock({
  group,
  showQualite,
}: {
  group: ReturnType<typeof buildScheduleRecap>['qualities'][number];
  showQualite: boolean;
}) {
  return (
    <>
      {/* A tbody of its own so the qualité banner can refuse to be the last
          thing on a page — `break-after: avoid` needs a box to hang off. */}
      {showQualite && (
        <tbody className="sch-recap-qgroup">
          <tr className="sch-recap-q">
            <th scope="colgroup">Qualité {group.qualite}</th>
            {/* In the lites column, like every other subtotal on the sheet —
                pushed further right it reads as a plate count. */}
            <td className="sch-recap-num mono">{fmt(group.reqLites)}</td>
            <td className="sch-recap-blank" colSpan={2} />
          </tr>
        </tbody>
      )}
      {group.dimensions.map((d) => (
        // One tbody per dimension: a group small enough to fit is never split
        // across two sheets, which is what makes the sheet usable at the racks.
        <tbody className="sch-recap-group" key={`${group.qualite}-${d.key}`}>
          <tr className="sch-recap-dim">
            <th scope="rowgroup">
              <span className="mono">{d.label}</span>
              <span className="sch-recap-unit"> mm</span>
            </th>
            <td className="sch-recap-num mono">{fmt(d.reqLites)}</td>
            {/* Same reason as the total row: the boxes to fill in belong to the
                thickness rows, where the plates are actually stacked. */}
            <td className="sch-recap-blank" colSpan={2} />
          </tr>
          {d.thicknesses.map((t) => (
            <tr className="sch-recap-th" key={`${group.qualite}-${d.key}-${t.key || 'nc'}`}>
              <th scope="row" className="sch-recap-th-label">
                <span className="mono">{t.label}</span>
              </th>
              <td className="sch-recap-num mono">{fmt(t.reqLites)}</td>
              <td className="sch-recap-fill" />
              <td className="sch-recap-fill" />
            </tr>
          ))}
        </tbody>
      ))}
    </>
  );
}
