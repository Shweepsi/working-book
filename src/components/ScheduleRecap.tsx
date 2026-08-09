import { useMemo } from 'react';
import type { PMS230Record, PMS230Schedule } from '../lib/pms230Parser';
import { shortItemName } from '../lib/pms230Parser';
import { fmtHMmin, hasHMmin } from '../lib/coaterMath';
import { fmtNum, fmtStamp } from '../lib/format';
import { buildScheduleRecap } from '../lib/scheduleRecap';

// The schedule's second printout: a portrait sheet that groups what is left to
// produce by qualité, dimension and plate — each plate noting the PDPs that
// call for it — with an empty column for the plate count the operator writes in
// front of the racks.
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
  /** Schedule speed in m/min, 0 when nobody has set one. */
  vitesse: number;
  /** Minutes still needed on the Coater at that speed, null without one. */
  coaterMin: number | null;
  /** Same, plus the 9 % downtime factor. */
  coaterMinDt: number | null;
  /** Print each plate's PDP behind it, in parentheses. */
  showPdp: boolean;
}

export default function ScheduleRecap({
  rows,
  schedule,
  shortName,
  importedAt,
  filterSummary,
  vitesse,
  coaterMin,
  coaterMinDt,
  showPdp,
}: ScheduleRecapProps) {
  const recap = useMemo(() => buildScheduleRecap(rows), [rows]);

  const name = shortName || shortItemName(schedule.itemRoot) || schedule.itemRoot;

  return (
    <section className="sch-recap print-only">
      {/* Same furniture as the detailed sheet, in the same order: provenance
          first as a discreet line under the top margin, then the title in its
          band. Reference matter above content — and the sheet reads as the
          other one's sibling rather than as a document from elsewhere.
          Skipped entirely when it would say nothing: an empty line still costs
          the gap under it. */}
      {(importedAt || filterSummary) && (
        <div className="sch-recap-meta">
          {importedAt && <span>rapport importé le {fmtStamp(importedAt)}</span>}
          {filterSummary && <strong>filtré : {filterSummary}</strong>}
        </div>
      )}

      <header className="sch-recap-head">
        <h2 className="sch-recap-title">
          <span className="mono sch-recap-title-num">{schedule.schedule}</span>
          <span className="sch-recap-title-sep"> — </span>
          <span className="sch-recap-title-name">{name}</span>
        </h2>
        {/* The same three tiles the detailed sheet carries, computed from the
            same rows: what the line is set to run at, and how long the rest
            takes. The plates are prepared against that duration. */}
        <div className="sch-recap-stats">
          <div className="sch-recap-stat">
            <span className="sch-recap-stat-label">Vitesse</span>
            <strong className="sch-recap-stat-value mono">
              {vitesse}
              <span className="sch-recap-stat-unit"> m/min</span>
            </strong>
          </div>
          <div className="sch-recap-stat">
            <span className="sch-recap-stat-label">Production</span>
            <strong className={`sch-recap-stat-value mono ${hasHMmin(coaterMin) ? '' : 'is-empty'}`}>
              {fmtHMmin(coaterMin)}
            </strong>
          </div>
          <div className="sch-recap-stat">
            <span className="sch-recap-stat-label">+ DT 9 %</span>
            <strong className={`sch-recap-stat-value mono ${hasHMmin(coaterMinDt) ? '' : 'is-empty'}`}>
              {fmtHMmin(coaterMinDt)}
            </strong>
          </div>
        </div>
      </header>

      <table className="sch-recap-table">
        <colgroup>
          {/* The column that gets written in takes the widest share: the two
              others only have to hold a dimension label and a count. */}
          <col style={{ width: '32%' }} />
          <col style={{ width: '15%' }} />
          <col style={{ width: '53%' }} />
        </colgroup>
        {/* No column header. The sheet has three columns and each says what it
            is by what it holds — a label in the left one, a count in the
            middle, nothing in the right. The band it replaced cost a row of
            grey at the top of every page for names nobody read twice.
            Consequence to know: a récap running over several pages no longer
            carries column names on pages 2 and beyond. */}
        {recap.lines === 0 ? (
          <tbody>
            <tr className="sch-recap-empty">
              <td colSpan={3}>Aucune ligne à produire sur ce schedule.</td>
            </tr>
          </tbody>
        ) : (
          recap.qualities.map((q) => <QualityBlock key={q.qualite} group={q} showPdp={showPdp} />)
        )}

        <tfoot>
          <tr className="sch-recap-total">
            <th scope="row">
              Total
              <span className="sch-recap-total-sub"> · {fmtNum(recap.m2)} m²</span>
            </th>
            <td className="sch-recap-num mono">{fmtNum(recap.reqLites)}</td>
            {/* No writing box on a total: plates are counted one pile at a
                time, and a box here would invite a figure nothing checks. */}
            <td className="sch-recap-blank" />
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

function QualityBlock({
  group,
  showPdp,
}: {
  group: ReturnType<typeof buildScheduleRecap>['qualities'][number];
  showPdp: boolean;
}) {
  return (
    <>
      {/* The qualité stays a row of the table, even when the schedule has only
          one: moved up into the title it would leave a sheet whose columns no
          longer say what they are qualifying. A tbody of its own so the banner
          can refuse to be the last thing on a page — `break-after: avoid`
          needs a box to hang off. */}
      <tbody className="sch-recap-qgroup">
        <tr className="sch-recap-q">
          <th scope="colgroup" colSpan={3}>Qualité {group.qualite}</th>
        </tr>
      </tbody>
      {/* One group per dimension, heading included: a dimension and its plates
          are one pile to prepare, so they travel together or not at all. Keeping
          the heading in a box of its own would let a dimension too tall for what
          is left of the page break away from it, and leave a title alone at the
          bottom of a sheet. */}
      {group.dimensions.map((d) => (
        <tbody className="sch-recap-group" key={`${group.qualite}-${d.key}`}>
          <tr className="sch-recap-dim">
            <th scope="rowgroup">
              {/* A row the report gave no dimension for keeps its lites and
                  says so, in the words the rest of the sheet uses for a gap.
                  Dropping it would leave a total the detailed sheet
                  contradicts, which is the one thing this sheet can't do. */}
              {d.known ? (
                <>
                  <span className="mono">{d.label}</span>
                  <span className="sch-recap-unit"> mm</span>
                </>
              ) : (
                <span className="sch-recap-unknown">{d.label}</span>
              )}
            </th>
            {/* No subtotal, and no box to fill: the dimension row is a heading
                for what sits under it, and every figure on this sheet —
                counted or written — belongs to a plate. */}
            <td className="sch-recap-blank" colSpan={2} />
          </tr>
          {d.plates.map((p) => (
            <tr className="sch-recap-plate" key={`${group.qualite}-${d.key}-${p.key}`}>
              <th scope="row" className="sch-recap-plate-label">
                {p.makeup ? (
                  // A laminate is named by its make-up and nothing else: a
                  // 4.4.2 is picked from the 4 mm racks, and its finished
                  // 08 mm would send the operator to the wrong one. The
                  // total is not repeated here — it names the article, not
                  // the plate, and this sheet is about plates.
                  <span className="mono">{p.makeup}</span>
                ) : p.mm == null ? (
                  <span className="sch-recap-unknown">{p.label}</span>
                ) : (
                  <span className="mono">{p.label}</span>
                )}
                {/* The PDP rides behind the plate rather than heading a group
                    of its own: it says which plate to fetch, and the plate is
                    already named — so it is a note on the line, in the
                    quieter type a note wears. */}
                {showPdp && p.pdps.length > 0 && (
                  <span className="sch-recap-pdp-note mono"> ({p.pdps.join(', ')})</span>
                )}
              </th>
              <td className="sch-recap-num mono">{fmtNum(p.reqLites)}</td>
              <td className="sch-recap-fill" />
            </tr>
          ))}
        </tbody>
      ))}
    </>
  );
}
