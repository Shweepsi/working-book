// The Loading and Unloading tabs: the shift's Suivi workbook as lists. Loading
// is the jumbos loaded at the start of the line (Début de Ligne); Unloading the
// racks filled at its end (Fin de Ligne) and the scraps.
//
// Nothing is typed here: the rows are read off the workbook (lib/suiviCells.ts)
// and follow it as the tablets fill it in, 2 s behind. Both tabs list the
// shift's colours in the order they started, each with its rows; a row is
// checked with the bilan's own rules, its problems show under it (and in the
// bilan's « À vérifier »), and touching a row opens its cells in Suivi.

import type { KeyboardEvent, ReactNode } from 'react';
import {
  area,
  fmtNum,
  loadingFilled,
  loadingIssues,
  scrapFilled,
  scrapIssues,
  shortDate,
  unloadingFilled,
  unloadingIssues,
  type Colour,
  type LineData,
  type LoadingRow,
  type Scrap,
  type UnloadingRow,
} from '../lib/line';
import type { Partition } from '../lib/sharedGrid';
import { useShiftLine } from '../lib/shiftLine';

type Side = 'loading' | 'unloading';

const m2 = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const pct = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %` : '—');
const plural = (n: number, one: string, many = `${one}s`) => `${fmtNum(n)} ${n > 1 ? many : one}`;
const sum = (xs: (number | null)[]) => xs.reduce<number>((n, x) => n + (x ?? 0), 0);
const numText = (v: number | null) => (v === null ? '' : fmtNum(v));

// --- Rows -------------------------------------------------------------------

interface CellProps {
  label: string;
  /** Laid out by its column (`ln-c-…`). */
  col: string;
  value: string;
  invalid?: boolean;
}

/** A value with its label: the label shows on a phone, where a row is a card; the table's head says it otherwise. */
function Cell({ label, col, value, invalid }: CellProps) {
  return (
    <span className={`ln-f ln-c-${col}${invalid ? ' is-bad' : ''}`}>
      <span className="ln-f-label">{label}</span>
      <span className={`ln-val${value ? '' : ' is-empty'}`}>{value || '—'}</span>
    </span>
  );
}

interface ShellProps {
  cls: string;
  /** Its cells in Suivi. */
  range: string;
  onShow: (range: string) => void;
  issues: string[];
  /** A note beside it, under the row. */
  comment?: string;
  children: ReactNode;
}

/** A row: touched (or Entrée), it opens its cells in Suivi. */
function RowShell({ cls, range, onShow, issues, comment, children }: ShellProps) {
  const open = () => onShow(range);
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    open();
  };
  return (
    <div className={`ln-row ${cls}${issues.length ? ' has-issues' : ''}`} role="button" tabIndex={0} title="Ouvrir dans Suivi" onClick={open} onKeyDown={onKey}>
      {children}
      {issues.length > 0 && (
        <p className="ln-issues" role="note">
          {issues.join(' · ')}
        </p>
      )}
      {comment && <p className="ln-comment">{comment}</p>}
    </div>
  );
}

interface RowProps<T> {
  row: T;
  onShow: (range: string) => void;
}

function LoadingRowView({ row, onShow }: RowProps<LoadingRow>) {
  const issues = loadingIssues(row);
  const restantes = row.lites !== null && row.conso !== null ? row.lites - row.conso : null;
  return (
    <RowShell cls="ln-loading" range={row.range} onShow={onShow} issues={issues} comment={row.comment}>
      <Cell label="N° TAG" col="tag" value={row.tag} invalid={issues.some((x) => x.startsWith('N° TAG'))} />
      <Cell label="Lites" col="n" value={numText(row.lites)} />
      <Cell label="Dimension" col="dim" value={numText(row.dim)} />
      <Cell label="Épaisseur" col="ep" value={row.ep} />
      <Cell label="Origine" col="orig" value={row.origine} />
      <Cell label="Sens" col="seg" value={row.sens} />
      <Cell label="Polishing" col="seg" value={row.polishing} />
      <Cell label="Date" col="date" value={shortDate(row.date)} />
      <Cell label="Consommées" col="conso" value={numText(row.conso)} invalid={row.lites !== null && row.conso !== null && row.conso > row.lites} />
      <span className="ln-f ln-c-rest" title="Restantes : lites − consommées">
        <span className="ln-f-label">Restantes</span>
        <span className={`ln-rest${restantes ? ' has-rest' : ''}`}>{restantes === null ? '—' : fmtNum(restantes)}</span>
      </span>
    </RowShell>
  );
}

function UnloadingRowView({ row, onShow }: RowProps<UnloadingRow>) {
  const issues = unloadingIssues(row);
  return (
    <RowShell cls="ln-rack" range={row.range} onShow={onShow} issues={issues} comment={row.comment}>
      <Cell label="N° TAG" col="tag" value={row.tag} invalid={issues.some((x) => x.startsWith('N° TAG'))} />
      <Cell label="Frame" col="frame" value={row.frame} />
      <Cell label="Dimension" col="dim" value={numText(row.dim)} />
      <Cell label="Épaisseur" col="ep" value={row.ep} />
      <Cell label="Lites" col="n" value={numText(row.lites)} />
    </RowShell>
  );
}

function ScrapRowView({ row, onShow }: RowProps<Scrap>) {
  const issues = scrapIssues(row);
  return (
    <RowShell cls="ln-scrap" range={row.range} onShow={onShow} issues={issues} comment={row.comment}>
      <Cell label="Défaut" col="defect" value={row.defect} invalid={!row.defect} />
      <Cell label="Quantité" col="qty" value={numText(row.qty)} invalid={!row.qty} />
      <Cell label="Dimension" col="dim" value={numText(row.dim)} />
      <Cell label="Épaisseur" col="ep" value={row.ep} />
    </RowShell>
  );
}

// --- Colours ----------------------------------------------------------------

interface Block {
  /** Null: rows under no colour. */
  colour: Colour | null;
  loading: LoadingRow[];
  unloading: UnloadingRow[];
  scraps: Scrap[];
}

/** The shift's colours in order, each with its rows; then the rows under none, when there are some. */
function blocksOf(d: LineData): Block[] {
  const of = (id: string | null) => ({
    loading: d.loading.filter((r) => r.colour === id && loadingFilled(r)),
    unloading: d.unloading.filter((r) => r.colour === id && unloadingFilled(r)),
    scraps: d.scraps.filter((r) => r.colour === id && scrapFilled(r)),
  });
  const blocks: Block[] = d.colours.map((c) => ({ colour: c, ...of(c.id) }));
  const none = of(null);
  if (none.loading.length || none.unloading.length || none.scraps.length) blocks.push({ colour: null, ...none });
  return blocks;
}

function TableHead({ side }: { side: Side | 'scrap' }) {
  const cols =
    side === 'loading'
      ? [
          ['tag', 'N° TAG'],
          ['n', 'Lites'],
          ['dim', 'Dimension'],
          ['ep', 'Épaisseur'],
          ['orig', 'Origine'],
          ['seg', 'Sens'],
          ['seg', 'Polishing'],
          ['date', 'Date'],
          ['conso', 'Consommées'],
          ['rest', 'Rest.'],
        ]
      : side === 'unloading'
        ? [
            ['tag', 'N° TAG'],
            ['frame', 'Frame'],
            ['dim', 'Dimension'],
            ['ep', 'Épaisseur'],
            ['n', 'Lites'],
          ]
        : [
            ['defect', 'Défaut'],
            ['qty', 'Quantité'],
            ['dim', 'Dimension'],
            ['ep', 'Épaisseur'],
          ];
  return (
    <div className={`ln-row ln-head ${side === 'loading' ? 'ln-loading' : side === 'unloading' ? 'ln-rack' : 'ln-scrap'}`} aria-hidden="true">
      {cols.map(([c, label], i) => (
        <span key={i} className={`ln-c-${c}`}>
          {label}
        </span>
      ))}
    </div>
  );
}

interface BlockHeadProps {
  block: Block;
  side: Side;
  onShow: (range: string) => void;
}

function BlockHead({ block, side, onShow }: BlockHeadProps) {
  const lites = sum(block.unloading.map((r) => r.lites));
  const scrapped = sum(block.scraps.map((s) => s.qty));
  const summary =
    side === 'loading'
      ? `${plural(block.loading.length, 'jumbo')} · ${fmtNum(sum(block.loading.map((r) => r.conso)))} consommées · ${m2(block.loading.reduce((n, r) => n + area(r.dim, r.conso), 0))} m²`
      : `${plural(block.unloading.length, 'rack')} · ${fmtNum(lites)} lites · ${fmtNum(scrapped)} scraps (${pct(scrapped, lites + scrapped)})`;
  const colour = block.colour;
  return (
    <header className="ln-block-head">
      {colour ? (
        <button type="button" className="ln-colour-name" onClick={() => onShow(colour.range)} title="Ouvrir dans Suivi">
          {colour.name}
        </button>
      ) : (
        <span className="ln-colour-name is-none">Sans couleur</span>
      )}
      <span className="ln-block-sum">{summary}</span>
      {!colour && <span className="ln-none-hint">Écris la couleur en N° TAG sur la ligne au-dessus de ces lignes, dans Suivi.</span>}
    </header>
  );
}

// --- The tabs ---------------------------------------------------------------

export default function LineTab({ part, side, onShow }: { part: Partition | null; side: Side; onShow: (range: string) => void }) {
  const { data, status, started } = useShiftLine(part, true);

  if (!part) return <div className="ln ln-empty no-print">Choisis un shift dans l’en-tête : chaque poste a son classeur Suivi.</div>;
  if (!data)
    return (
      <div className="ln ln-empty no-print" role="status">
        {!navigator.onLine
          ? 'Hors ligne : ce poste n’a jamais été lu sur cette tablette. Il s’ouvrira au retour du réseau.'
          : status === 'error'
            ? 'Le poste ne se lit pas. Nouvel essai dans quelques secondes.'
            : 'Chargement du poste…'}
      </div>
    );
  if (!started)
    return (
      <div className="ln ln-empty no-print" role="status">
        <div className="ln-empty-body">
          <p>Rien n’est saisi sur ce poste.</p>
          <p className="ln-hint">Les lignes se tapent dans Suivi ; Loading et Unloading les listent.</p>
          <button type="button" className="btn primary" onClick={() => onShow('Suivi!B3')}>
            Ouvrir Suivi
          </button>
        </div>
      </div>
    );

  const blocks = blocksOf(data);
  return (
    <div className={`ln ln-${side} no-print`}>
      <p className="ln-readonly">Lecture seule : les lignes se tapent dans Suivi. Touche une ligne pour l’y retrouver.</p>
      {blocks.map((b) => (
        <section key={b.colour?.id ?? 'none'} className={`ln-block${b.colour ? '' : ' is-none'}`}>
          <BlockHead block={b} side={side} onShow={onShow} />
          {side === 'loading' ? (
            <>
              {b.loading.length > 0 && <TableHead side="loading" />}
              {b.loading.map((r) => (
                <LoadingRowView key={r.id} row={r} onShow={onShow} />
              ))}
            </>
          ) : (
            <>
              {b.unloading.length > 0 && <TableHead side="unloading" />}
              {b.unloading.map((r) => (
                <UnloadingRowView key={r.id} row={r} onShow={onShow} />
              ))}
              <div className="ln-scraps">
                <h4>
                  Scraps
                  {b.scraps.length > 0 && <span className="ln-count">{fmtNum(sum(b.scraps.map((s) => s.qty)))}</span>}
                </h4>
                {b.scraps.length > 0 && <TableHead side="scrap" />}
                {b.scraps.map((s) => (
                  <ScrapRowView key={s.id} row={s} onShow={onShow} />
                ))}
                {b.scraps.length === 0 && <p className="ln-none">Aucun scrap.</p>}
              </div>
            </>
          )}
        </section>
      ))}
    </div>
  );
}
