# working-book — repères pour les prochaines itérations

PWA React/Vite (front, `src/`) + Cloudflare Worker/D1 (`worker/`) + extension navigateur d'import (`extension/`).

## Carte du dépôt
- `src/components/` : un fichier par écran/onglet (Schedules, Suivi, Logbook, ProductionTest, LineTabs…). Les plus gros (à découper un jour) : `Schedules.tsx`, `LineTabs.tsx`, `SuiviBilan.tsx`.
- `src/lib/` : logique sans UI. Sync : `sync.ts`, `lineSync.ts`, `sharedGrid.ts`. Parsing : `pms230Parser.ts`, `policyParser.ts`. Bilans : `suiviBilan.ts`, `lineBilan.ts`, `dayBilan.ts`.
- `src/styles/` : `tokens.css` (variables) et `app.css` (monolithe, tout le CSS des écrans).
- `worker/src/` : API (`index.ts`), `mcp/` = serveur MCP + moteur GridCraft (wasm). `worker/migrations/` : SQL D1 numéroté, ne jamais réécrire une migration appliquée.
- `docs/` : guides d'usage à la racine, `audits/` = audits terminés (statut « corrigé »).
- `docs/PATERNITE-ET-IP.md`, `preuve-*.sha256`, `.ots` : preuve d'antériorité. NE PAS déplacer, renommer ni modifier : le `.sha256` et l'horodatage `.ots` ne valent que si les fichiers restent identiques à l'octet (le `.sha256` cible un bundle git absent du dépôt, donc pas de contrôle automatique possible ici).

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
