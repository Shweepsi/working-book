import { useEffect, useRef, useState } from 'react';
import { API_BASE, SYNC_ENABLED } from '../lib/api';
import { bookmarkletHref, bookmarkletSource, INGEST_MODES, type IngestMode } from '../lib/bookmarklet';
import { load, save } from '../lib/storage';
import { useEscapeToClose } from '../lib/hooks';

// Set-up sheet for the direct import. Nothing here talks to Infor — it builds
// the bookmarklet the operator installs once, then clicks from the Operator
// Mashup itself, where their session already is.

const KEY_TOKEN = 'wb.schedules.ingest.token';
const KEY_MODE = 'wb.schedules.ingest.mode';

const isMode = (v: unknown): v is IngestMode =>
  typeof v === 'string' && INGEST_MODES.some((m) => m.key === v);

interface PortalImportProps {
  onClose: () => void;
  onBack: () => void;
}

export default function PortalImport({ onClose, onBack }: PortalImportProps) {
  const [token, setToken] = useState(() => {
    const stored = load<unknown>(KEY_TOKEN, '');
    return typeof stored === 'string' ? stored : '';
  });
  const [mode, setMode] = useState<IngestMode>(() => {
    const stored = load<unknown>(KEY_MODE, 'auto');
    return isMode(stored) ? stored : 'auto';
  });
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<HTMLAnchorElement>(null);

  useEscapeToClose(onClose);
  useEffect(() => { save(KEY_TOKEN, token); }, [token]);
  useEffect(() => { save(KEY_MODE, mode); }, [mode]);

  const opts = { apiBase: API_BASE, token, mode };
  const href = SYNC_ENABLED ? bookmarkletHref(opts) : '';

  // Assigned through the DOM rather than as a prop: React refuses to render a
  // `javascript:` href and would strip it to about:blank.
  useEffect(() => {
    const el = linkRef.current;
    if (!el) return;
    if (href) el.setAttribute('href', href);
    else el.removeAttribute('href');
  }, [href]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(t);
  }, [copied]);

  async function copySource() {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
    } catch {
      // Clipboard blocked — the operator can still drag the link itself.
    }
  }

  const modeHelp = INGEST_MODES.find((m) => m.key === mode)?.help;

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet sch-portal" role="dialog" aria-modal="true">
        <div className="grabber" />
        <div className="sheet-head">
          <h3>Import direct depuis Mingle</h3>
          <div className="sheet-head-actions">
            <button className="btn ghost mini" onClick={onBack}>← Coller</button>
            <button className="btn ghost icon" onClick={onClose} aria-label="Fermer">✕</button>
          </div>
        </div>

        <p className="faint small sch-import-hint">
          À installer une fois. Ensuite, depuis l’Operator Mashup, un clic sur le
          favori envoie le rapport ici — plus de changement d’onglet ni de
          collage à la main.
        </p>

        {!SYNC_ENABLED ? (
          <div className="sch-import-status sch-error">
            ⚠ Cette copie de Working Book est en mode local (aucun serveur
            configuré au build). L’import direct a besoin du serveur pour recevoir
            le rapport.
          </div>
        ) : (
          <>
            <ol className="sch-portal-steps">
              <li>
                Affichez la barre de favoris du navigateur
                (<kbd>Ctrl</kbd> + <kbd>Maj</kbd> + <kbd>O</kbd> sur Edge et Chrome).
              </li>
              <li>
                Glissez ce bouton dessus — ou copiez-le et créez un favori dont
                l’adresse est le texte copié :
                <div className="sch-portal-drag">
                  <a
                    ref={linkRef}
                    className="btn primary sch-portal-bookmarklet"
                    draggable
                    onClick={(e) => e.preventDefault()}
                    title="Glisser vers la barre de favoris"
                  >
                    ⇱ Working Book — importer
                  </a>
                  <button type="button" className="btn" onClick={copySource}>
                    {copied ? '✓ Copié' : 'Copier le lien'}
                  </button>
                </div>
              </li>
              <li>
                Ouvrez l’Operator Mashup, lancez la recherche, puis cliquez dans
                le rapport et faites <kbd>Ctrl</kbd> + <kbd>A</kbd> puis{' '}
                <kbd>Ctrl</kbd> + <kbd>C</kbd>.
                <p className="faint small">
                  Le rapport M3 est affiché dans un cadre servi par un autre
                  domaine que le portail : le navigateur interdit au favori de le
                  lire directement, quelle qu’en soit l’écriture. Il passe donc
                  par le presse-papiers. Si le mashup est ouvert seul dans son
                  onglet, cette étape saute d’elle-même.
                </p>
              </li>
              <li>
                Cliquez le favori et validez. Un message confirme le nombre de
                lignes importées.
              </li>
              <li>
                Si le rapport tient sur plusieurs pages, passez à la suivante,
                recopiez et recliquez : elles s’ajoutent les unes aux autres.
              </li>
            </ol>

            <div className="sch-portal-field">
              <h4>Comportement</h4>
              <div className="seg" role="group" aria-label="Comportement de l’import">
                {INGEST_MODES.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    className={mode === m.key ? 'active' : ''}
                    onClick={() => setMode(m.key)}
                    aria-pressed={mode === m.key}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {modeHelp && <p className="faint small">{modeHelp}</p>}
            </div>

            <div className="sch-portal-field">
              <h4>
                Jeton <span className="faint">· optionnel</span>
              </h4>
              <input
                type="text"
                className="sch-portal-token mono"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="laisser vide si le serveur n’en demande pas"
                spellCheck={false}
                autoComplete="off"
              />
              <p className="faint small">
                À renseigner uniquement si <code>INGEST_TOKEN</code> a été défini
                sur le serveur. Il est alors recopié tel quel dans le favori.
              </p>
            </div>

            <details className="sch-import-warnings sch-portal-source">
              <summary>Voir ce que fait le favori</summary>
              <p className="faint small">
                Il envoie le texte du rapport à <code>{API_BASE}/api/schedules/ingest</code>.
                Rien d’autre ne quitte la page.
              </p>
              <pre className="mono small">{bookmarkletSource(opts)}</pre>
            </details>
          </>
        )}

        <div className="actions">
          <span style={{ flex: 1 }} />
          <button className="btn ghost" type="button" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </>
  );
}
