import { useEffect, useRef, useState } from 'react';
import { API_BASE, SYNC_ENABLED } from '../lib/api';
import { bookmarkletHref, bookmarkletSource } from '../lib/bookmarklet';
import { useEscapeToClose } from '../lib/hooks';

// Set-up sheet for the direct import. Nothing here talks to Infor — it builds
// the bookmarklet the operator installs once, then uses from the Operator
// Mashup itself, where their session already is.

interface PortalImportProps {
  onClose: () => void;
  onBack: () => void;
}

export default function PortalImport({ onClose, onBack }: PortalImportProps) {
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<HTMLAnchorElement>(null);

  useEscapeToClose(onClose);

  const href = SYNC_ENABLED ? bookmarkletHref(API_BASE) : '';

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
          À installer une fois. Ensuite, depuis l’Operator Mashup :{' '}
          <kbd>Ctrl</kbd> + <kbd>A</kbd>, <kbd>Ctrl</kbd> + <kbd>C</kbd>, un clic
          sur le favori. Plus de changement d’onglet ni de collage.
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
                Dans l’Operator Mashup : lancez la recherche, cliquez dans le
                rapport, <kbd>Ctrl</kbd> + <kbd>A</kbd> puis <kbd>Ctrl</kbd> +{' '}
                <kbd>C</kbd>, puis cliquez le favori et validez.
              </li>
            </ol>

            <p className="faint small">
              Chaque import <strong>s’ajoute</strong> au rapport : un rapport en
              plusieurs pages se prend page par page, et réimporter la même page
              met simplement ses lignes à jour. Pour retirer un schedule, faites-le
              glisser dans la liste de gauche.
            </p>

            <details className="sch-import-warnings sch-portal-source">
              <summary>Voir ce que fait le favori</summary>
              <p className="faint small">
                Il lit le presse-papiers et l’envoie à{' '}
                <code>{API_BASE}/api/schedules/ingest</code>. Rien d’autre ne
                quitte la page.
              </p>
              <pre className="mono small">{bookmarkletSource(API_BASE)}</pre>
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
