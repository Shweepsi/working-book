import { useEffect, useState } from 'react';
import { SYNC_ENABLED } from '../lib/api';
import { useEscapeToClose } from '../lib/hooks';

// Set-up sheet for the direct import. Nothing here talks to Infor — it hands
// over the one way in: the extension, which drives the search itself.

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
  const [copied, setCopied] = useState(false);

  useEscapeToClose(onClose);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(t);
  }, [copied]);

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(EXTENSION_PATH);
      setCopied(true);
    } catch {
      // Clipboard blocked — the path is written out in full on screen rather
      // than hidden behind the button.
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
          Importer sans changer d’onglet ni copier-coller. L’extension fait tout
          elle-même. À installer une fois.
        </p>

        {!SYNC_ENABLED ? (
          <div className="sch-import-status sch-error">
            ⚠ Cette copie de Working Book est en mode local (aucun serveur
            configuré au build). L’import direct a besoin du serveur pour recevoir
            le rapport.
          </div>
        ) : (
          <>
            <h4 className="sch-portal-way">L’extension</h4>
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
                  <button type="button" className="btn primary" onClick={copyPath}>
                    {copied ? '✓ Copié' : 'Copier le chemin'}
                  </button>
                </div>
              </li>
              <li>
                L’icône apparaît dans la barre d’outils. Depuis l’Operator
                Mashup — ou n’importe quel onglet — cliquez-la puis{' '}
                <strong>« Rapport auto »</strong>.
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
