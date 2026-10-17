// The shift's bilan (lib/suiviBilan.ts), computed from the cells on screen and
// up to date as they change: a sheet over the workbook with a tab per colour
// (BilanSheet), and the same content laid out for paper, every colour in turn
// (BilanPrint) — what the app prints from the Suivi tab.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { sharedGrid as grid, type Partition } from '../lib/sharedGrid';
import { computeBilan, type BilanColour, type BilanTotals, type SuiviBilan } from '../lib/suiviBilan';

const fmt = (v: number, digits = 3) => v.toLocaleString('fr-FR', { maximumFractionDigits: digits });
const m2 = (v: number) => fmt(v, 2);

/** The bilan of `part` while it's the shift on screen; null before it's open. */
export function useBilan(part: Partition | null): SuiviBilan | null {
  const snap = useSyncExternalStore(grid.subscribe, grid.getSnapshot);
  const date = part?.date;
  const poste = part?.poste;
  return useMemo(() => {
    if (!date || !poste) return null;
    const cells = grid.cells({ date, poste });
    return cells ? computeBilan(cells) : null;
    // `rev` says the cells changed; `status`, that the shift (re)opened.
  }, [date, poste, snap.rev, snap.status]);
}

function TotalsTable({ t, caption, sides = { dl: true, fl: true } }: { t: BilanTotals; caption?: string; sides?: { dl: boolean; fl: boolean } }) {
  const both = sides.dl && sides.fl;
  const cell = (v: number, show: boolean, unit: (n: number) => string) => <td>{show ? unit(v) : '—'}</td>;
  const delta = (v: number, unit: (n: number) => string) => <td className={both && v ? 'is-bad' : ''}>{both ? unit(v) : '—'}</td>;
  return (
    <table className="sb-table">
      {caption && <caption>{caption}</caption>}
      <thead>
        <tr>
          <th />
          <th>Début de ligne</th>
          <th>Fin de ligne</th>
          <th>Rejets</th>
          <th>Delta</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th>Lites</th>
          {cell(t.dl, sides.dl, fmt)}
          {cell(t.fl, sides.fl, fmt)}
          {cell(t.rejets, sides.fl, fmt)}
          {delta(t.delta, fmt)}
        </tr>
        <tr>
          <th>m²</th>
          {cell(t.dlM2, sides.dl, m2)}
          {cell(t.flM2, sides.fl, m2)}
          {cell(t.rejetsM2, sides.fl, m2)}
          {delta(t.deltaM2, m2)}
        </tr>
      </tbody>
    </table>
  );
}

/** Rejects per defect, and per dimension when there's more than one. */
function Defects({ c }: { c: BilanColour }) {
  if (!c.defects.length) return <p className="sb-none">Aucun rejet.</p>;
  const dims = c.dims.length > 1 ? c.dims : [];
  return (
    <div className="sb-scroll">
      <table className="sb-table sb-defects">
        <thead>
          <tr>
            <th>Défaut</th>
            {dims.map((d) => (
              <th key={d}>{d}</th>
            ))}
            <th>{dims.length ? 'Total' : (c.dims[0] ?? 'Lites')}</th>
          </tr>
        </thead>
        <tbody>
          {c.defects.map((d) => (
            <tr key={d.defect}>
              <th>{d.defect}</th>
              {dims.map((dim) => (
                <td key={dim}>{d.byDim[dim] ? fmt(d.byDim[dim]) : ''}</td>
              ))}
              <td className="sb-strong">{fmt(d.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Restes({ c }: { c: BilanColour }) {
  if (!c.restes.length) return <p className="sb-none">Aucune plaque entamée.</p>;
  return (
    <div className="sb-scroll">
      <table className="sb-table">
        <thead>
          <tr>
            <th>Ligne</th>
            <th>N° TAG</th>
            <th>Date</th>
            <th>Lites</th>
            <th>Consommées</th>
            <th>Restantes</th>
          </tr>
        </thead>
        <tbody>
          {c.restes.map((r) => (
            <tr key={r.row}>
              <th>{r.row}</th>
              <td className="sb-left">{r.tag}</td>
              <td>{r.date}</td>
              <td>{fmt(r.lites)}</td>
              <td className={r.saisie ? '' : 'sb-missing'}>{r.saisie ? fmt(r.conso) : 'non saisies'}</td>
              <td className="sb-strong">{fmt(r.restantes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Checks({ c }: { c: BilanColour }) {
  if (!c.checks.length) return <p className="sb-none">Rien à signaler.</p>;
  return (
    <ul className="sb-checks">
      {c.checks.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ul>
  );
}

/** One colour: its totals, its rejects per defect, its plates left, its rows to look at. */
function ColourPanel({ c }: { c: BilanColour }) {
  return (
    <>
      <TotalsTable t={c.totals} sides={{ dl: c.inDl, fl: c.inFl }} />
      <h4>Rejets par défaut</h4>
      <Defects c={c} />
      <h4>Restes en début de ligne</h4>
      <Restes c={c} />
      <h4>À vérifier</h4>
      <Checks c={c} />
    </>
  );
}

const dayLabel = (iso: string) => iso.split('-').reverse().join('/');

interface BilanSheetProps {
  part: Partition;
  shiftLabel: string;
  onClose: () => void;
}

export function BilanSheet({ part, shiftLabel, onClose }: BilanSheetProps) {
  const bilan = useBilan(part);
  const [tab, setTab] = useState(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const colours = bilan?.colours ?? [];
  const current = colours[Math.min(tab, colours.length - 1)];

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet sb-sheet" role="dialog" aria-modal="true" aria-label="Bilan du poste">
        <div className="grabber" />
        <div className="sheet-head">
          <div className="sheet-head-titles">
            <h3>Bilan</h3>
            <span className="sheet-head-sub">
              Poste {part.poste} du {dayLabel(part.date)} · {shiftLabel}
            </span>
          </div>
          <div className="sheet-head-actions">
            <button type="button" className="btn ghost mini" onClick={() => window.print()} disabled={!bilan || bilan.empty}>
              Imprimer
            </button>
            <button type="button" className="btn ghost icon" onClick={onClose} aria-label="Fermer">
              ✕
            </button>
          </div>
        </div>

        {!bilan ? (
          <p className="sb-none">Le classeur du poste n’est pas encore chargé.</p>
        ) : bilan.empty ? (
          <p className="sb-none">Aucune ligne remplie pour ce poste.</p>
        ) : (
          <div className="sb">
            <h4>Production du poste</h4>
            <TotalsTable t={bilan.totals} />
            {current && (
              <>
                <div className="sb-tabs" role="tablist" aria-label="Couleurs">
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
                      {c.checks.length > 0 && <span className="sb-count" aria-label={`${c.checks.length} à vérifier`}>{c.checks.length}</span>}
                    </button>
                  ))}
                </div>
                <div role="tabpanel" className="sb-panel" aria-label={current.name}>
                  <ColourPanel c={current} />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

interface BilanPrintProps {
  part: Partition;
  shiftLabel: string;
  dateLabel: string;
}

/** The bilan on paper: what printing from the Suivi tab gives. */
export function BilanPrint({ part, shiftLabel, dateLabel }: BilanPrintProps) {
  const bilan = useBilan(part);
  // The time it goes to paper (`beforeprint`, where the engine fires it; the
  // last render otherwise).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    window.addEventListener('beforeprint', tick);
    return () => window.removeEventListener('beforeprint', tick);
  }, []);
  if (!bilan) return null;
  const printed = now.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
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
            <strong>Couleurs :</strong> {bilan.colours.filter((c) => !c.none).map((c) => c.name).join(', ') || '—'}
          </span>
          <span>
            <strong>Imprimé le</strong> {printed}
          </span>
        </div>
      </div>
      {bilan.empty ? (
        <p className="sb-none">Aucune ligne remplie pour ce poste.</p>
      ) : (
        <>
          <TotalsTable t={bilan.totals} caption="Production du poste" />
          {bilan.colours.map((c) => (
            <div key={c.name} className="sb-print-colour">
              <h2>{c.name}</h2>
              <ColourPanel c={c} />
            </div>
          ))}
        </>
      )}
    </section>
  );
}
