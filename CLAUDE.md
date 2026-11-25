# Working Book — consignes

## Version

Toute mise en prod (PR vers `main` qui change ce que voit l'utilisateur) monte
la version affichée sous Réglages, dans le même PR :

- `npm version <x.y.z> --no-git-tag-version` (met à jour `package.json` et
  `package-lock.json`) ;
- mineure (0.3.0 → 0.4.0) pour une nouveauté, correctif (0.3.0 → 0.3.1) pour
  une correction ou un ajustement d'affichage.

# Repères du dépôt

PWA React/Vite (front, `src/`) + Cloudflare Worker/D1 (`worker/`) + extension navigateur d'import (`extension/`).

## Carte du dépôt
- `src/components/` : un fichier par écran/onglet (Schedules, Suivi, Logbook, ProductionTest, LineTabs…). Les plus gros (à découper un jour) : `Schedules.tsx`, `LineTabs.tsx`, `SuiviBilan.tsx`.
- `src/lib/` : logique sans UI. Sync : `sync.ts`, `sharedGrid.ts` (classeur Suivi), `shiftCells.ts` (lecture des cellules d'un poste hors de l'onglet Suivi). Parsing : `pms230Parser.ts`, `policyParser.ts`. Loading/Unloading = vues en lecture seule du classeur Suivi : `suiviCells.ts` (cellules → lignes, colonnes du modèle), `shiftLine.ts` (hook), `line.ts` (types et règles). Bilans : `lineBilan.ts`, `dayBilan.ts`, `suiviBilan.ts` (types et totaux communs). Statistiques d'usage anonymes : `uiStats.ts` (voir « Bilan » ci-dessous).
- `src/styles/` : `tokens.css` (variables) et `app.css` (monolithe, tout le CSS des écrans).
- `worker/src/` : API (`index.ts`), `mcp/` = serveur MCP + moteur GridCraft (wasm). `worker/migrations/` : SQL D1 numéroté, ne jamais réécrire une migration appliquée.
- `docs/` : guides d'usage à la racine, `audits/` = audits terminés (statut « corrigé »).
- `docs/PATERNITE-ET-IP.md`, `preuve-*.sha256`, `.ots` : preuve d'antériorité. NE PAS déplacer, renommer ni modifier : le `.sha256` et l'horodatage `.ots` ne valent que si les fichiers restent identiques à l'octet (le `.sha256` cible un bundle git absent du dépôt, donc pas de contrôle automatique possible ici).

## Bilan (`components/SuiviBilan.tsx`)
- Modale (≈ 1000 px, bord haut fixe au-dessus de 600 px, feuille du bas sur téléphone) : à gauche la liste « Tout le poste » + une entrée par couleur (badge Δ) et les plaques de protection ; à droite quatre tuiles (m² arrondis, lites dessous) puis le tableau des scraps. La portée « Journée » met le tableau Par poste en tête. Le papier (`BilanPrint`, `Rejects`) a sa propre mise en page : pareto + matrice, par poids décroissant.
- Tableau (`RejectsTable`) : défauts triés de A à Z ; par défaut un défaut par ligne et les dimensions en colonnes, groupées par longueur (en-tête à deux niveaux) ; le bouton ⟳ du coin pivote (clé `localStorage` `wb-bilan-rotated`, par navigateur). Les m² d'une cellule ou d'un total sont en bulle.
- Bulles : `TipLayer`, une seule pour toute la modale, déclenchée par tout élément portant `data-tip` (survol ; focus clavier si `tabIndex`), rendue dans `document.body` pour ne pas être coupée. Pas d'interaction au toucher.
- Plaques de protection : « + Ajouter une dimension » → longueur × épaisseur → ✓ → champ Nombre ; une dimension n'est pas modifiable, on la retire et on la recrée.
- Statistiques anonymes du sens du tableau : `uiStats.ts` → `POST /api/stats` (liste fermée `STATS` dans `worker/src/index.ts`) → table `ui_stats` (migration 0014). Événements `open:defects|dims` (une fois par ouverture, quand le tableau s'affiche) et `rotate:defects|dims`, appareil `pc`/`touch` ; aucun identifiant ni poste. Lecture : `SELECT event, device, SUM(n) FROM ui_stats GROUP BY event, device` (D1 dev ou prod). Pour compter autre chose, ajouter l'événement à `STATS` côté Worker **et** au type `StatEvent` côté front.

## Règles
- Canaux : `VITE_CHANNEL=prod` sur `main`, `dev` partout ailleurs (Worker/D1 dev partagés). Voir `worker/README.md`.
- Chaque push de branche déclenche le déploiement Cloudflare (`.github/workflows/cloudflare.yml`) : ne pas supprimer une branche distante sans vérifier qu'aucun aperçu n'en dépend.
- Artefacts générés ignorés par git : `public/gridcraft/` (`npm run fetch:gridcraft`) et `worker/src/mcp/engine/` (`worker/scripts/fetch-engine.sh`).
- Vérification : `npm run typecheck`, mais la CI enchaîne aussi `fetch:gridcraft` et `npm run build` (un build dev peut échouer alors que le typecheck passe). Pas de build lourd ni de wasm en local ; pousser et laisser la CI/l'utilisateur tester.

## Chantiers de structure identifiés (non faits)
1. Passer à `src/features/<domaine>/` + `src/shared/` (déplacements purs, vérifiés par typecheck).
2. Découper `Schedules.tsx` et `app.css` par feature.

## Branches supprimées (récupérables par SHA)
Abandonnées (PR #77 et #88 fermées sans fusion), supprimées de GitHub le 2026-11-15 :
`claude/header-improvement-ideas-0shv7x` = `a7489e0` (boîte à idées), `claude/test-cosmetic-page-repatriation-48rxnx` = `4bbf0e7` (Logbook en sections). `git fetch origin <sha>` ou `refs/pull/<n>/head` les restaure.

Style 2027, remplacé par Papier / Verre / Céramique (PR #133), supprimées de GitHub le 2026-11-24 :
`claude/gracious-ramanujan-9bl9j6` = `23d4a15` (PR #125), `claude/modest-bell-86u3ox` = `3b0d2f5` (PR #124), `claude/practical-bardeen-gbviph` = `7e6643d` (PR #126).
