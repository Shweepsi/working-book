import { useEffect, useRef, useState } from 'react';
import { API_BASE, SYNC_ENABLED } from '../lib/api';
import { bookmarkletHref } from '../lib/bookmarklet';
import { useEscapeToClose } from '../lib/hooks';

// Set-up sheet for the direct import. Nothing here talks to Infor — it hands
// over the two ways in: the extension, which drives the search itself, and the
// bookmarklet, which still needs a copy-paste but installs from this page.

// Where the unpacked extension lives on the site's share. A browser cannot be
// made to install it from a web page — Chrome blocks navigation to file:// and
// to chrome:// from web content, and there is no install API outside the Web
// Store. So the honest button is one that hands over the path.
const EXTENSION_PATH = 'P:\\Bascharage\\Shared\\All\\extension';

interface PortalImportProps {
  onClose: () => void;
  onBack: () => void;
}

export default function PortalImport({ onClose, onBack }: PortalImportProps) {
  const [copied, setCopied] = useState<'link' | 'path' | null>(null);
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
    const t = setTimeout(() => setCopied(null), 2500);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy(what: 'link' | 'path', text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      // Clipboard blocked — the link can still be dragged, and the path is
      // written out in full on screen rather than hidden behind the button.
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
          Deux façons d’importer sans changer d’onglet. L’extension fait tout
          elle-même ; le favori demande un copier-coller. À installer une fois.
        </p>

        {!SYNC_ENABLED ? (
          <div className="sch-import-status sch-error">
            ⚠ Cette copie de Working Book est en mode local (aucun serveur
            configuré au build). L’import direct a besoin du serveur pour recevoir
            le rapport.
          </div>
        ) : (
          <>
            <h4 className="sch-portal-way">
              L’extension <span className="sch-portal-badge">recommandé</span>
            </h4>
            <p className="sch-portal-lead">
              Elle lance la recherche, élargit la grille et envoie le rapport
              toute seule. Aucun copier-coller.
            </p>
            <ol className="sch-portal-steps">
              <li>
                Ouvrez <code>chrome://extensions</code> (ou{' '}
                <code>edge://extensions</code>) et activez le{' '}
                <strong>mode développeur</strong>, en haut à droite.
              </li>
              <li>
                Cliquez <strong>« Charger l’extension non empaquetée »</strong>,
                puis collez ce chemin dans la barre d’adresse du sélecteur de
                dossier :
                <div className="sch-portal-drag">
                  <code className="sch-portal-path">{EXTENSION_PATH}</code>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => copy('path', EXTENSION_PATH)}
                  >
                    {copied === 'path' ? '✓ Copié' : 'Copier le chemin'}
                  </button>
                </div>
              </li>
              <li>
                L’icône apparaît dans la barre d’outils. Depuis l’Operator
                Mashup — ou n’importe quel onglet — cliquez-la puis{' '}
                <strong>« Rapport auto »</strong>.
              </li>
            </ol>

            <hr className="sch-portal-rule" />

            <h4 className="sch-portal-way">Le favori</h4>
            <p className="sch-portal-lead">
              Sans accès au partage. Il envoie le rapport affiché, mais la
              sélection reste à faire à la main.
            </p>
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
                  <button type="button" className="btn" onClick={() => copy('link', href)}>
                    {copied === 'link' ? '✓ Copié' : 'Copier le lien'}
                  </button>
                </div>
              </li>
              <li>
                Dans l’Operator Mashup : lancez la recherche, cliquez dans le
                rapport, <kbd>Ctrl</kbd> + <kbd>A</kbd> puis <kbd>Ctrl</kbd> +{' '}
                <kbd>C</kbd>, puis cliquez le favori et validez.
              </li>
            </ol>
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
