# working-book — repères pour les prochaines itérations

PWA React/Vite (front, `src/`) + Cloudflare Worker/D1 (`worker/`) + extension navigateur d'import (`extension/`).

## Carte du dépôt
- `src/components/` : un fichier par écran/onglet (Schedules, Suivi, Logbook, ProductionTest, LineTabs…). Les gros : `Schedules.tsx` (~2700 l.), `LineTabs.tsx`, `SuiviBilan.tsx`.
- `src/lib/` : logique sans UI. Sync : `sync.ts`, `lineSync.ts`, `sharedGrid.ts`. Parsing : `pms230Parser.ts`, `policyParser.ts`. Bilans : `suiviBilan.ts`, `lineBilan.ts`, `dayBilan.ts`.
- `src/styles/` : `tokens.css` (variables) et `app.css` (monolithe ~6100 l.).
- `worker/src/` : API (`index.ts`), `mcp/` = serveur MCP + moteur GridCraft (wasm). `worker/migrations/` : SQL D1 numéroté, ne jamais réécrire une migration appliquée.
- `docs/` : guides d'usage à la racine, `audits/` = audits terminés (statut « corrigé »).
- `docs/PATERNITE-ET-IP.md`, `preuve-*.sha256`, `.ots` : preuve d'antériorité. NE PAS déplacer, renommer ni modifier.

## Règles
- Canaux : `VITE_CHANNEL=prod` sur `main`, `dev` partout ailleurs (Worker/D1 dev partagés). Voir `worker/README.md`.
- Chaque push de branche déclenche le déploiement Cloudflare (`.github/workflows/cloudflare.yml`) : ne pas supprimer une branche distante sans vérifier qu'aucun aperçu n'en dépend.
- Artefacts générés ignorés par git : `public/gridcraft/` (`npm run fetch:gridcraft`) et `worker/src/mcp/engine/` (`worker/scripts/fetch-engine.sh`).
- Vérification : `npm run typecheck`. Pas de build lourd ni de wasm en local ; pousser et laisser la CI/l'utilisateur tester.

## Chantiers de structure identifiés (non faits)
1. Passer à `src/features/<domaine>/` + `src/shared/` (déplacements purs, vérifiés par typecheck).
2. Découper `Schedules.tsx` et `app.css` par feature.
3. Branches `origin/claude/header-improvement-ideas-*` et `claude/test-cosmetic-page-repatriation-*` : non fusionnées, décision en attente.
