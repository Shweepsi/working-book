# Import direct depuis Mingle

Comment envoyer le rapport Operator Mashup dans Working Book **sans quitter le
portail Infor**.

Une seule façon, l'extension navigateur : rien à faire à l'import, l'envoi part
tout seul.

Le copier-coller classique reste disponible et inchangé — c'est le repli quand
les extensions sont bloquées sur le poste.

**Tout import s'ajoute au rapport.** Il n'y a pas de « remplacer » : un rapport
en plusieurs pages se prend page par page, et réimporter une même page met
simplement ses lignes à jour au lieu de les dupliquer. Pour retirer un schedule,
faites-le glisser dans la liste de gauche de l'onglet Schedule.

## Le principe

Working Book ne se connecte pas à Infor et ne détient aucun identifiant Infor.
Le rapport est lu dans la session déjà ouverte de l'opérateur, puis envoyé au
serveur Working Book, qui le passe par le même analyseur que la zone de collage
et le partage avec tous les postes.

Rien à demander à l'IT, aucun compte de service, aucun mot de passe stocké.

## L'extension

Aucune manipulation à l'import : ouvrez l'Operator Mashup, lancez la recherche,
c'est envoyé.

C'est possible parce qu'une extension a une capacité que rien d'autre n'a : le
navigateur exécute son script **à l'intérieur** du cadre où vit la grille M3.
Dans Mingle, cette grille est servie par un **autre domaine** que le portail, et
le navigateur interdit à toute page ordinaire d'en lire le contenu. C'est la
protection de base du web, aucune astuce ne la contourne — d'où l'extension.

### Installer (une fois par poste)

1. Dans Working Book, onglet **Schedule** → **Importer rapport Operator Mashup**.
2. Dans l'en-tête de la feuille, cliquer **⇱ Import direct** : le chemin du
   dossier de l'extension y est affiché, avec un bouton pour le copier.
3. Suivre les trois étapes de la feuille (`edge://extensions` ou
   `chrome://extensions` → **Mode développeur** → **Charger l'extension non
   empaquetée**).

Installation et détails : [`extension/README.md`](../extension/README.md).

### Importer

1. Ouvrir l'Operator Mashup et lancer la recherche.
2. Cliquer l'icône de l'extension, puis **Rapport auto**.
3. Revenir dans Working Book : le rapport est là. Si l'onglet était resté ouvert,
   il se met à jour tout seul au retour dessus.

## En cas de problème

| Message | Cause | Quoi faire |
| ------- | ----- | ---------- |
| *Envoi impossible* | Serveur injoignable (réseau, ou politique de sécurité du portail). | **Rien n'a été importé.** Réessayer ; si ça persiste, coller dans Working Book → Schedule → **Importer**. |
| *Échec de l'import (422 no_records)* | Du texte a été lu mais aucune ligne n'a pu être décodée. | Vérifier qu'on est bien sur le rapport PMS230 et non sur un écran de recherche vide. Le rapport déjà chargé n'est pas touché. |

L'extension est livrée avec les deux adresses de serveur. Pour les changer — ou
simplement vérifier — clic droit sur l'icône → **Options**, puis **Tester la
connexion**.

## Pour l'administrateur

L'endpoint est `POST /api/schedules/ingest`. Il accepte les origines
`*.inforcloudsuite.com`, nécessaire pour que l'extension puisse écrire depuis le
portail, et n'exige aucune authentification — comme le reste de l'API. Détails
dans [`worker/README.md`](../worker/README.md).
