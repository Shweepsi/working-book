// The shift's bilan (lib/suiviBilan.ts), computed from the cells on screen and
// up to date as they change, or the day's, 06:00 to 06:00 (lib/dayBilan.ts):
// a sheet over the workbook (BilanSheet), the same content laid out for paper
// (BilanPrint, what printing from the Suivi tab gives), and the bar's button
// with the count of rows to look at (BilanButton).
//
// The rejects say three things, in that order: how much (rejected lites
// against what went through Fin de Ligne), what (the defects, largest first),
// and where (the reject rate per dimension).

import { useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { sharedGrid as grid, type Partition } from '../lib/sharedGrid';
import { refreshDay, useDayBilan, type DayBilan } from '../lib/dayBilan';
import { addDaysISO } from '../lib/shiftCalendar';
import { computeBilan, type BilanCheck, type BilanColour, type BilanRejects, type BilanTotals, type SuiviBilan } from '../lib/suiviBilan';

/** What the bilan covers: the shift on screen, or its whole day. */
export type BilanScope = 'poste' | 'jour';

const fmt = (v: number, digits = 3) => v.toLocaleString('fr-FR', { maximumFractionDigits: digits });
const m2 = (v: number) => fmt(v, 2);
const pct = (part: number, whole: number) => (whole > 0 ? `${(part / whole * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %` : '—');
/** A tint that grows with a reject rate, so the dimension and defect that lost the most stand out. */
const heat = (rate: number): CSSProperties | undefined =>
  rate > 0 ? { background: `color-mix(in srgb, var(--flag-unsched-bd) ${Math.min(55, Math.round(rate * 250))}%, transparent)` } : undefined;

// Every component showing the bilan asks for it on each change: computed once per change.
let cache: { key: string; cells: ReadonlyMap<string, unknown>; bilan: SuiviBilan } | null = null;

/** The bilan of `part` while it's the shift on screen; null before it's open. */
export function useBilan(part: Partition | null): SuiviBilan | null {
  const snap = useSyncExternalStore(grid.subscribe, grid.getSnapshot);
  if (!part) return null;
  const cells = grid.cells(part);
  if (!cells) return null;
  // `rev` says the cells changed; `status`, that the shift (re)opened.
  const key = `${part.date}|${part.poste}|${snap.rev}|${snap.status}`;
  if (!cache || cache.key !== key || cache.cells !== cells) cache = { key, cells, bilan: computeBilan(cells) };
  return cache.bilan;
}

/** Début de ligne, fin de ligne, rejects and their rate, the gap: lites, m² underneath. */
function Kpis({ t, sides = { dl: true, fl: true }, compact }: { t: BilanTotals; sides?: { dl: boolean; fl: boolean }; compact?: boolean }) {
  const both = sides.dl && sides.fl;
  const tile = (label: string, lites: number | null, area: number | null, extra?: string, bad?: boolean) => (
    <div className={`sb-kpi${bad ? ' is-bad' : ''}`}>
      <span className="sb-kpi-label">{label}</span>
      <strong className="sb-kpi-value">
        {lites === null ? '—' : fmt(lites)}
        {extra && <span className="sb-kpi-extra"> · {extra}</span>}
      </strong>
      <span className="sb-kpi-sub">{area === null ? 'lites' : `lites · ${m2(area)} m²`}</span>
    </div>
  );
  return (
    <div className={`sb-kpis${compact ? ' is-compact' : ''}`}>
      {tile('Début de ligne', sides.dl ? t.dl : null, sides.dl ? t.dlM2 : null)}
      {tile('Fin de ligne', sides.fl ? t.fl : null, sides.fl ? t.flM2 : null)}
      {tile('Rejets', sides.fl ? t.rejets : null, sides.fl ? t.rejetsM2 : null, sides.fl ? pct(t.rejets, t.fl + t.rejets) : undefined)}
      {tile('Delta', both ? t.delta : null, both ? t.deltaM2 : null, undefined, both && !!t.delta)}
    </div>
  );
}

/** How much, what, where. */
function Rejects({ r }: { r: BilanRejects }) {
  if (!r.passees) return <p className="sb-none">Rien n’est encore passé en fin de ligne.</p>;
  if (!r.rejets)
    return (
      <p className="sb-rej-head">
        <strong>Aucun rejet</strong> sur {fmt(r.passees)} lites passées en fin de ligne.
      </p>
    );
  const top = r.defects[0]?.total ?? 0;

  return (
    <>
      <p className="sb-rej-head">
        <strong>{fmt(r.rejets)} lites rejetées</strong> sur {fmt(r.passees)} passées en fin de ligne · <strong>{pct(r.rejets, r.passees)}</strong> · {m2(r.m2)} m²
      </p>

      <table className="sb-table sb-pareto">
        <thead>
          <tr>
            <th>Défaut</th>
            <th className="sb-bar-col" aria-hidden="true" />
            <th>Lites</th>
            <th>Part</th>
            <th>m²</th>
          </tr>
        </thead>
        <tbody>
          {r.defects.map((d) => (
            <tr key={d.defect}>
              <th>{d.defect}</th>
              <td className="sb-bar-col" aria-hidden="true">
                <span className="sb-bar" style={{ width: `${(d.total / top) * 100}%` }} />
              </td>
              <td className="sb-strong">{fmt(d.total)}</td>
              <td>{pct(d.total, r.rejets)}</td>
              <td>{m2(d.m2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h5>Par dimension</h5>
      {r.dims.length > 1 ? (
        <div className="sb-scroll">
          <table className="sb-table sb-matrix">
            <thead>
              <tr>
                <th>Défaut</th>
                {r.dims.map((d) => (
                  <th key={d.dim}>{d.dim}</th>
                ))}
              </tr>
              <tr className="sb-matrix-passed">
                <th>Passées</th>
                {r.dims.map((d) => (
                  <td key={d.dim}>{fmt(d.passees)}</td>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.defects.map((def) => (
                <tr key={def.defect}>
                  <th>{def.defect}</th>
                  {r.dims.map((d) => {
                    const q = def.byDim[d.dim] ?? 0;
                    return (
                      <td key={d.dim} style={heat(q / d.passees)} title={q ? `${pct(q, d.passees)} des ${d.dim}` : undefined}>
                        {q ? fmt(q) : ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>Taux de rejet</th>
                {r.dims.map((d) => (
                  <td key={d.dim} style={heat(d.rejets / d.passees)}>
                    {pct(d.rejets, d.passees)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <p className="sb-line">
          Une seule dimension, {r.dims[0]?.dim} : {fmt(r.dims[0]?.rejets ?? 0)} rejets sur {fmt(r.dims[0]?.passees ?? 0)} ({pct(r.dims[0]?.rejets ?? 0, r.dims[0]?.passees ?? 0)}).
        </p>
      )}

    </>
  );
}

/** The rows to look at; with `onPick` (on screen), each one selects its row in the workbook. */
function Checks({ checks, onPick }: { checks: BilanCheck[]; onPick?: (range: string) => void }) {
  if (!checks.length) return <p className="sb-none">Rien à signaler.</p>;
  return (
    <ul className="sb-checks">
      {checks.map((x, i) => (
        <li key={i}>
          {onPick && x.range ? (
            <button type="button" className="sb-check" onClick={() => onPick(x.range as string)} title="Voir la ligne dans le classeur">
              <span>{x.text}</span>
              <span className="sb-go" aria-hidden="true">
                ›
              </span>
            </button>
          ) : (
            <span className="sb-check is-static">{x.text}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="sb-section">
      <h4>
        {title}
        {count ? <span className="sb-count">{count}</span> : null}
      </h4>
      {children}
    </section>
  );
}

/** A tab's content: a colour's own figures above its rejects, or the whole shift's; then the
 * rows to look at, on screen only (`checks` isn't given on paper). */
function Panel({ colour, rejects, checks, onPick }: { colour?: BilanColour; rejects: BilanRejects; checks?: BilanCheck[]; onPick?: (range: string) => void }) {
  return (
    <>
      {colour && <Kpis t={colour.totals} sides={{ dl: colour.inDl, fl: colour.inFl }} compact />}
      <Section title="Rejets par défaut">
        <Rejects r={rejects} />
      </Section>
      {checks && (
        <Section title="À vérifier" count={checks.length}>
          <Checks checks={checks} onPick={onPick} />
        </Section>
      )}
    </>
  );
}

const dayLabel = (iso: string) => iso.split('-').reverse().join('/');
const shortDay = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/');
const ALL = -1;

/** 06:00 on `date` to 06:00 the next day. */
const daySpan = (date: string) => `du ${shortDay(date)} 06:00 au ${shortDay(addDaysISO(date, 1))} 06:00`;

/** The figures on top, then a tab per colour after the whole (when there are several). */
function BilanBody({ bilan, allLabel, onPick, showChecks, children }: { bilan: SuiviBilan; allLabel: string; onPick?: (range: string) => void; showChecks: boolean; children?: ReactNode }) {
  const [tab, setTab] = useState(ALL);
  const colours = bilan.colours;
  const several = colours.length > 1;
  const current = several && tab !== ALL ? colours[Math.min(tab, colours.length - 1)] : undefined;
  return (
    <>
      <Kpis t={bilan.totals} />
      {children}
      {several && (
        <div className="sb-tabs" role="tablist" aria-label="Couleurs">
          <button type="button" role="tab" aria-selected={!current} className={!current ? 'active' : ''} onClick={() => setTab(ALL)}>
            {allLabel}
          </button>
          {colours.map((c, i) => (
            <button
              key={c.name}
              type="button"
              role="tab"
              aria-selected={c === current}
              className={[c === current && 'active', c.inDl && c.inFl && c.totals.delta && 'is-bad', c.none && 'is-none'].filter(Boolean).join(' ')}
              onClick={() => setTab(i)}
            >
              {c.name}
              {showChecks && c.checks.length > 0 && (
                <span className="sb-count" aria-label={`${c.checks.length} à vérifier`}>
                  {c.checks.length}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      <div role={several ? 'tabpanel' : undefined} className="sb-panel" key={current?.name ?? 'all'}>
        {current ? (
          <Panel colour={current} rejects={current.rejects} checks={showChecks ? current.checks : undefined} onPick={onPick} />
        ) : (
          <Panel rejects={bilan.rejects} checks={showChecks ? bilan.checks : undefined} onPick={onPick} />
        )}
      </div>
    </>
  );
}

/** The day's three shifts side by side: who worked, what went through, the gap each left. */
function ShiftsTable({ day, live }: { day: DayBilan; live?: string }) {
  return (
    <Section title="Par poste">
      <div className="sb-scroll">
        <table className="sb-table sb-shifts">
          <thead>
            <tr>
              <th>Poste</th>
              <th>Début</th>
              <th>Fin</th>
              <th>Rejets</th>
              <th>Taux</th>
              <th>Delta</th>
            </tr>
          </thead>
          <tbody>
            {day.shifts.map((s) => {
              const t = s.bilan?.totals;
              return (
                <tr key={s.key} className={s.poste === live ? 'is-live' : ''}>
                  <th>
                    {s.label} · {s.poste}
                    <span className="sb-shift-hours">{s.hours}</span>
                  </th>
                  {!t || s.bilan?.empty ? (
                    <td colSpan={5} className="sb-shift-none">
                      {!s.started ? (day.status === 'loading' ? 'lecture…' : 'pas encore ouvert') : 'aucune ligne remplie'}
                    </td>
                  ) : (
                    <>
                      <td>{fmt(t.dl)}</td>
                      <td>{fmt(t.fl)}</td>
                      <td>{fmt(t.rejets)}</td>
                      <td>{pct(t.rejets, t.fl + t.rejets)}</td>
                      <td className={t.delta ? 'is-bad' : ''}>{fmt(t.delta)}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

interface BilanSheetProps {
  part: Partition;
  shiftLabel: string;
  scope: BilanScope;
  onScope: (scope: BilanScope) => void;
  onClose: () => void;
}

export function BilanSheet({ part, shiftLabel, scope, onScope, onClose }: BilanSheetProps) {
  const bilan = useBilan(part);
  const day = useDayBilan(part.date, part, scope === 'jour');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // A row to look at: the sheet makes way for the workbook, on that row.
  const pick = (range: string) => {
    onClose();
    grid.select(part, range);
  };
  const single = bilan && bilan.colours.length === 1 ? bilan.colours[0] : undefined;
  const printable = scope === 'jour' ? !!day && !day.bilan.empty : !!bilan && !bilan.empty;

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet sb-sheet" role="dialog" aria-modal="true" aria-label={scope === 'jour' ? `Bilan du ${dayLabel(part.date)}` : 'Bilan du poste'}>
        <div className="grabber" />
        <div className="sheet-head">
          <div className="sheet-head-titles">
            <h3>{scope === 'jour' ? `Bilan du ${dayLabel(part.date)}` : 'Bilan'}</h3>
            <span className="sheet-head-sub">
              {scope === 'jour'
                ? daySpan(part.date)
                : `Poste ${part.poste} du ${dayLabel(part.date)} · ${shiftLabel}${single && !single.none ? ` · ${single.name}` : ''}`}
            </span>
          </div>
          <div className="sheet-head-actions">
            <button type="button" className="btn ghost mini" onClick={() => window.print()} disabled={!printable}>
              Imprimer
            </button>
            <button type="button" className="btn ghost icon" onClick={onClose} aria-label="Fermer">
              ✕
            </button>
          </div>
        </div>

        <div className="seg sb-scope" role="group" aria-label="Période du bilan">
          <button type="button" className={scope === 'poste' ? 'active' : ''} aria-pressed={scope === 'poste'} onClick={() => onScope('poste')}>
            Poste {part.poste} · {shiftLabel}
          </button>
          <button type="button" className={scope === 'jour' ? 'active' : ''} aria-pressed={scope === 'jour'} onClick={() => onScope('jour')}>
            Journée du {shortDay(part.date)}
          </button>
        </div>

        {scope === 'jour' ? (
          !day ? null : (
            <div className="sb">
              <div className="sb-day-status">
                <span>
                  {day.status === 'loading'
                    ? 'Lecture des autres postes…'
                    : day.status === 'error'
                      ? `Autres postes illisibles (${day.error}) : le bilan ne compte que ceux affichés.`
                      : `Matin, après-midi et nuit du ${dayLabel(part.date)}.`}
                </span>
                <button type="button" className="btn ghost mini" onClick={() => void refreshDay(part.date)} disabled={day.status === 'loading'}>
                  Actualiser
                </button>
              </div>
              <BilanBody bilan={day.bilan} allLabel="Toute la journée" showChecks={false}>
                <ShiftsTable day={day} live={part.poste} />
              </BilanBody>
            </div>
          )
        ) : !bilan ? (
          <p className="sb-none">Le classeur du poste n’est pas encore chargé.</p>
        ) : bilan.empty ? (
          <p className="sb-none">Aucune ligne remplie pour ce poste.</p>
        ) : (
          <div className="sb">
            <BilanBody bilan={bilan} allLabel="Tout le poste" onPick={pick} showChecks />
          </div>
        )}
      </div>
    </>
  );
}

/** The bar's Bilan button, with the number of rows to look at. */
export function BilanButton({ part, onClick, disabled }: { part: Partition; onClick: () => void; disabled?: boolean }) {
  const bilan = useBilan(part);
  const n = bilan?.checks.length ?? 0;
  return (
    <button type="button" className="btn primary mini sb-open" onClick={onClick} disabled={disabled} title={n ? `${n} ligne${n > 1 ? 's' : ''} à vérifier` : undefined}>
      Bilan
      {n > 0 && (
        <span className="sb-count" aria-label={`${n} à vérifier`}>
          {n}
        </span>
      )}
    </button>
  );
}

interface BilanPrintProps {
  part: Partition;
  shiftLabel: string;
  dateLabel: string;
  scope: BilanScope;
}

/** The figures, then the rejects: for the whole, then every colour in turn when there are several. */
function PrintBody({ bilan, wholeTitle, children }: { bilan: SuiviBilan; wholeTitle: string; children?: ReactNode }) {
  if (bilan.empty) return <p className="sb-none">Aucune ligne remplie.</p>;
  const several = bilan.colours.length > 1;
  return (
    <>
      <Kpis t={bilan.totals} />
      {children}
      {several ? (
        <>
          <Section title={wholeTitle}>
            <Rejects r={bilan.rejects} />
          </Section>
          {bilan.colours.map((c) => (
            <div key={c.name} className="sb-print-colour">
              <h2>{c.name}</h2>
              <Panel colour={c} rejects={c.rejects} />
            </div>
          ))}
        </>
      ) : (
        <Panel rejects={bilan.rejects} />
      )}
    </>
  );
}

/** The bilan on paper, the shift's or the day's: what printing from the Suivi tab gives. */
export function BilanPrint({ part, shiftLabel, dateLabel, scope }: BilanPrintProps) {
  const bilan = useBilan(part);
  const day = useDayBilan(part.date, part, scope === 'jour');
  // The time it goes to paper (`beforeprint`, where the engine fires it; the
  // last render otherwise).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    window.addEventListener('beforeprint', tick);
    return () => window.removeEventListener('beforeprint', tick);
  }, []);
  const printed = now.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  const colourNames = (b: SuiviBilan) => b.colours.filter((c) => !c.none).map((c) => c.name).join(', ') || '—';

  if (scope === 'jour') {
    if (!day) return null;
    return (
      <section className="sb sb-print print-only">
        <div className="print-header">
          <h1>Bilan du {dateLabel}</h1>
          <div className="meta">
            <span>
              <strong>Période :</strong> {daySpan(part.date)}
            </span>
            <span>
              <strong>Postes :</strong> {day.shifts.map((s) => `${s.label} ${s.poste}`).join(', ')}
            </span>
            <span>
              <strong>Couleurs :</strong> {colourNames(day.bilan)}
            </span>
            <span>
              <strong>Imprimé le</strong> {printed}
            </span>
          </div>
        </div>
        <PrintBody bilan={day.bilan} wholeTitle="Rejets de la journée">
          <ShiftsTable day={day} />
        </PrintBody>
      </section>
    );
  }

  if (!bilan) return null;
  return (
    <section className="sb sb-print print-only">
      <div className="print-header">
        <h1>
          Bilan · Poste {part.poste} · {shiftLabel}
        </h1>
        <div className="meta">
          <span>
            <strong>Date :</strong> {dateLabel}
          </span>
          <span>
            <strong>Couleurs :</strong> {colourNames(bilan)}
          </span>
          <span>
            <strong>Imprimé le</strong> {printed}
          </span>
        </div>
      </div>
      <PrintBody bilan={bilan} wholeTitle="Rejets du poste" />
    </section>
  );
}
