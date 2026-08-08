import { Fragment, useMemo } from 'react';
import type { PMS230Record, PMS230Schedule } from '../lib/pms230Parser';
import { shortItemName } from '../lib/pms230Parser';
import { fmtHMmin, hasHMmin } from '../lib/coaterMath';
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
  /** Schedule speed in m/min, 0 when nobody has set one. */
  vitesse: number;
  /** Minutes still needed on the Coater at that speed, null without one. */
  coaterMin: number | null;
  /** Same, plus the 9 % downtime factor. */
  coaterMinDt: number | null;
}

const fmt = (n: number, digits = 0): string =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export default function ScheduleRecap({
  rows,
  schedule,
  shortName,
  importedAt,
  filterSummary,
  vitesse,
  coaterMin,
  coaterMinDt,
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
          {importedAt && (
            <span>
              rapport importé le{' '}
              {new Date(importedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
          )}
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
          recap.qualities.map((q) => <QualityBlock key={q.qualite} group={q} />)
        )}

        <tfoot>
          <tr className="sch-recap-total">
            <th scope="row">
              Total
              <span className="sch-recap-total-sub"> · {fmt(recap.m2)} m²</span>
            </th>
            <td className="sch-recap-num mono">{fmt(recap.reqLites)}</td>
            {/* No writing box on a total: plates are counted per dimension and
                thickness, and a box here would invite a figure nothing checks. */}
            <td className="sch-recap-blank" />
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

function QualityBlock({
  group,
}: {
  group: ReturnType<typeof buildScheduleRecap>['qualities'][number];
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
      {group.dimensions.map((d) => (
        <Fragment key={`${group.qualite}-${d.key}`}>
          {/* Heading in a group of its own, like the qualité banner: it must
              not be the last thing on a page. */}
          <tbody className="sch-recap-dimgroup">
            <tr className="sch-recap-dim">
              <th scope="rowgroup">
                <span className="mono">{d.label}</span>
                <span className="sch-recap-unit"> mm</span>
              </th>
              {/* No subtotal, and no box to fill: the dimension row is a
                  heading for what sits under it, and every figure on this
                  sheet — counted or written — belongs to a leaf. */}
              <td className="sch-recap-blank" colSpan={2} />
            </tr>
          </tbody>
          {d.pdps.map((p) => (
            // The unbreakable unit is the PDP and its thicknesses, not the whole
            // dimension: that is what gets picked in one go at the racks, and a
            // smaller unit leaves a smaller gap when it is pushed onto the next
            // sheet — the engine stretches the last row of a page fragment, so
            // whatever is pushed is paid for in blank paper above it.
            <tbody className="sch-recap-group" key={`${group.qualite}-${d.key}-${p.key || 'nc'}`}>
              <tr className="sch-recap-pdp">
                <th scope="rowgroup">
                  <span className="sch-recap-pdp-tag">PDP</span>
                  {p.key
                    ? <span className="mono"> {p.label}</span>
                    : <span className="sch-recap-th-unknown"> non renseigné</span>}
                </th>
                <td className="sch-recap-blank" colSpan={2} />
              </tr>
              {p.thicknesses.map((t) => (
                <tr className="sch-recap-th" key={`${group.qualite}-${d.key}-${p.key}-${t.key || 'nc'}`}>
                  <th scope="row" className="sch-recap-th-label">
                    {t.makeup ? (
                      // A laminate is named by its make-up and nothing else: a
                      // 4.4.2 is picked from the 4 mm racks, and its finished
                      // 08 mm would send the operator to the wrong one. The
                      // total is not repeated here — it names the article, not
                      // the plate, and this sheet is about plates.
                      <span className="mono">{t.makeup}</span>
                    ) : t.mm == null ? (
                      <span className="sch-recap-th-unknown">{t.label}</span>
                    ) : (
                      <span className="mono">{t.label}</span>
                    )}
                  </th>
                  <td className="sch-recap-num mono">{fmt(t.reqLites)}</td>
                  <td className="sch-recap-fill" />
                </tr>
              ))}
            </tbody>
          ))}
        </Fragment>
      ))}
    </>
  );
}
