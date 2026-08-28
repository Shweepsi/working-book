# Dossier paternité & propriété intellectuelle — working-book

> Document interne de constitution de preuve. Rédigé le 2026-08-02.
> Objet : établir qui a créé `working-book`, quand, avec quels moyens, et sur
> quel temps — en vue d'une valorisation (licence/cession) auprès d'un tiers.
> **Ce document décrit des faits vérifiables ; il ne constitue pas un avis
> juridique. Pour tout usage contentieux, le faire relire par un avocat en
> droit social / propriété intellectuelle.**

---

## 1. Auteur

- **Auteur / titulaire présumé :** Loïc Cancelotti (compte GitHub `Shweepsi`,
  `shweepsi@gmail.com`), exerçant sous l'enseigne **Studio Cancelotti**.
- **Outil d'assistance :** commits techniques co-signés `Claude` — un assistant
  de développement. Un outil logiciel n'est pas coauteur au sens du droit
  d'auteur : la direction créative, les choix fonctionnels et la validation
  sont ceux de l'auteur humain.
- **Aucun autre contributeur humain** n'apparaît dans l'historique.

## 2. Horodatage (extrait de l'historique Git au 2026-08-02)

| Élément | Valeur |
|---|---|
| Trace la plus ancienne dans ce dépôt | **2026-04-30** |
| Dernier commit | 2026-08-01 |
| Nombre total de commits | **184** |
| Commits sous le compte perso `Shweepsi` | 57 (pilotage/merge) |
| Commits techniques `Claude` (outil) | 127 |
| Volume de code | ~7 000 lignes (TypeScript strict, React, PWA) |
| Licence dans le dépôt | **aucune → « tous droits réservés » par défaut** |

> Commande de vérification : `git log --reverse --format="%ad | %an" --date=iso`

## 3. Développement hors temps de travail (faisceau d'indices)

Répartition des 184 commits selon leur horodatage :

- **81 commits (44 %) tombent un samedi ou un dimanche.**
- **71 commits (39 %) sont horodatés entre 19 h et 6 h.**

Ce profil (soirées + week-ends) est cohérent avec un développement **sur temps
personnel**, et non pendant les heures de service.

> Commande : `git log --format="%ad" --date=format:'%u %H'`

## 4. Moyens propres à l'auteur (indépendance vis-à-vis de l'employeur)

- **Backend :** Cloudflare Worker dont l'URL est injectée au build via
  `VITE_API_URL` (`src/lib/api.ts`). Aucune infrastructure, aucun nom de
  domaine, aucun identifiant de l'employeur n'est présent dans le code source.
- **Compte de développement :** GitHub personnel `Shweepsi`.
- **Hébergement / comptes cités dans le workspace :** Cloudflare, OVH, GitHub —
  tous au nom de l'auteur (cf. `studio-cancelotti-workspace/USER.md`).

Le code ne contient **aucun secret, credential, ni donnée nominative** de
l'employeur : les imports (extension, collage manuel) lisent la session déjà
ouverte côté poste opérateur ; rien n'est codé en dur.

## 5. Périmètre : hors mission salariale

À documenter par l'auteur (preuves à joindre en annexe) :

- [ ] **Fiche de poste / contrat de travail** — vérifier qu'aucune mission de
      développement logiciel n'y figure. En droit français, un logiciel créé
      par un salarié **dans l'exercice de ses fonctions ou d'après les
      instructions de l'employeur** est dévolu à l'employeur (art. **L113-9
      CPI**). Hors de ce cadre, les droits restent à l'auteur.
- [ ] **Absence de commande / d'instruction** : aucun e-mail, compte-rendu de
      réunion ou note de la hiérarchie demandant, spécifiant ou finançant
      l'outil. Rassembler tout échange qui le confirme (ou l'infirme).
- [ ] **Absence de moyens de l'employeur** : développé sur matériel et comptes
      personnels (cf. §4).
- [ ] **Absence de rémunération / prime** liée à ce développement.

> ⚠️ Point de vigilance honnête : l'outil est aujourd'hui **utilisé en
> production par des opérateurs avec des données réelles**. C'est un atout de
> valorisation (preuve d'usage), mais l'employeur pourra tenter d'y voir un
> outil « entré dans les fonctions ». D'où l'importance des preuves ci-dessus,
> qui datent la **création** bien avant tout usage officiel et hors de toute
> instruction.

## 6. Renforcement recommandé de la preuve de date

Le Git est une bonne preuve, mais horodatée par l'auteur lui-même. Pour une
date **opposable aux tiers**, au choix :

1. **Dépôt APP** (Agence pour la Protection des Programmes) — dépôt de code
   source horodaté, référence pour le logiciel.
2. **Enveloppe e-Soleau (INPI)** — horodatage simple et peu coûteux d'un
   dossier (archive du code + ce document).
3. **Horodatage qualifié** d'une archive (`git bundle` + hash SHA-256 scellé).

## 7. Prochaines étapes (hors de ce document)

1. Réunir les annexes du §5.
2. Choisir et réaliser un dépôt du §6.
3. Sur cette base saine, construire une **offre de licence/maintenance**
   chiffrée à présenter comme proposition commerciale (et non comme moyen de
   pression).

---
_Constitué à partir de l'état du dépôt au 2026-08-02. Reproductible via les
commandes Git citées._
