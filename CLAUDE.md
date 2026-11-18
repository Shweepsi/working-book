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
- `src/lib/` : logique sans UI. Sync : `sync.ts`, `lineSync.ts`, `sharedGrid.ts`. Parsing : `pms230Parser.ts`, `policyParser.ts`. Bilans : `suiviBilan.ts`, `lineBilan.ts`, `dayBilan.ts`.
- `src/styles/` : `tokens.css` (variables), `app.css` (monolithe, tout le CSS des écrans) et `style-2027.css` (le style optionnel « 2027 », voir Règles).
- `worker/src/` : API (`index.ts`), `mcp/` = serveur MCP + moteur GridCraft (wasm). `worker/migrations/` : SQL D1 numéroté, ne jamais réécrire une migration appliquée.
- `docs/` : guides d'usage à la racine, `audits/` = audits terminés (statut « corrigé »).
- `docs/PATERNITE-ET-IP.md`, `preuve-*.sha256`, `.ots` : preuve d'antériorité. NE PAS déplacer, renommer ni modifier : le `.sha256` et l'horodatage `.ots` ne valent que si les fichiers restent identiques à l'octet (le `.sha256` cible un bundle git absent du dépôt, donc pas de contrôle automatique possible ici).

## Règles
- Canaux : `VITE_CHANNEL=prod` sur `main`, `dev` partout ailleurs (Worker/D1 dev partagés). Voir `worker/README.md`.
- Chaque push de branche déclenche le déploiement Cloudflare (`.github/workflows/cloudflare.yml`) : ne pas supprimer une branche distante sans vérifier qu'aucun aperçu n'en dépend.
- Artefacts générés ignorés par git : `public/gridcraft/` (`npm run fetch:gridcraft`) et `worker/src/mcp/engine/` (`worker/scripts/fetch-engine.sh`).
- Styles : `classic` (le papier, le défaut) ou `2027` (verre), au choix dans Réglages ; `data-style` sur `<html>`, posé par `App` (qui le remet à `classic` pendant l'aperçu d'impression). Tout `style-2027.css` est dans `@media screen` et sous `:root[data-style='2027']` : le papier ne le voit jamais. Son bloc de jetons sombres est écrit deux fois (thème explicite / « auto » + préférence système) comme dans `tokens.css` : les garder identiques. Deux pièges déjà vécus :
  - `backdrop-filter` sur un conteneur en fait la « racine » du flou de ses enfants : un menu posé dedans ne floute plus la page. Le verre des conteneurs qui hébergent des menus (en-tête, carte du schedule) va donc sur un `::before`.
  - une animation en `fill-mode: both`/`forwards` sur `translate`/`scale` laisse l'élément en contexte d'empilement pour toujours (le tableau se peignait par-dessus les menus après un changement de schedule) : toujours `backwards`.
- Vérification visuelle : Playwright sur `npm run dev` avec `VITE_API_URL` = Worker dev, **ouvert sur `http://localhost:5173`** (le CORS du Worker n'accepte pas `127.0.0.1`), en interceptant toute requête non-GET pour ne rien écrire dans la base. Le papier se compare en PDF rastérisé (`pdftoppm`), pixel à pixel, aux références d'avant ; attention, la ligne « rapport importé le… » change quand la base dev est réimportée.
- Vérification : `npm run typecheck`, mais la CI enchaîne aussi `fetch:gridcraft` et `npm run build` (un build dev peut échouer alors que le typecheck passe). Pas de build lourd ni de wasm en local ; pousser et laisser la CI/l'utilisateur tester.

## Chantiers de structure identifiés (non faits)
1. Passer à `src/features/<domaine>/` + `src/shared/` (déplacements purs, vérifiés par typecheck).
2. Découper `Schedules.tsx` et `app.css` par feature.

## Branches supprimées (récupérables par SHA)
Abandonnées (PR #77 et #88 fermées sans fusion), supprimées de GitHub le 2026-11-15 :
`claude/header-improvement-ideas-0shv7x` = `a7489e0` (boîte à idées), `claude/test-cosmetic-page-repatriation-48rxnx` = `4bbf0e7` (Logbook en sections). `git fetch origin <sha>` ou `refs/pull/<n>/head` les restaure.
