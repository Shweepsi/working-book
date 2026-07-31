# Import direct depuis Mingle

Comment envoyer le rapport Operator Mashup dans Working Book **sans quitter le
portail Infor**.

Deux façons, selon ce qui est autorisé sur le poste :

| | Ce qu'il faut faire | À installer |
| --- | --- | --- |
| **Extension** | rien, l'envoi part tout seul | une extension navigateur |
| **Favori** | Ctrl+A, Ctrl+C, un clic | un favori (marche partout) |

Le copier-coller classique reste disponible et inchangé.

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

## Option 1 — l'extension (le plus simple à l'usage)

Aucune manipulation à l'import : ouvrez l'Operator Mashup, lancez la recherche,
c'est envoyé.

C'est possible parce qu'une extension a une capacité que rien d'autre n'a : le
navigateur exécute son script **à l'intérieur** du cadre où vit la grille M3.

Installation et détails : [`extension/README.md`](../extension/README.md).

## Option 2 — le favori

À utiliser quand les extensions sont bloquées par l'IT.

### Pourquoi il faut copier le rapport

Dans Mingle, la grille M3 est affichée dans un **cadre servi par un autre
domaine** que le portail. Le navigateur interdit à toute page — favori compris —
de lire le contenu d'un tel cadre. C'est la protection de base du web, aucune
astuce ne la contourne.

Le favori passe donc par le presse-papiers. Ce qui disparaît quand même : le
changement d'onglet, l'ouverture de la feuille, le collage et le bouton.

### Installer (une fois par poste)

1. Dans Working Book, onglet **Schedule** → **Importer rapport Operator Mashup**.
2. Dans l'en-tête de la feuille, cliquer **⇱ Import direct**.
3. Afficher la barre de favoris : <kbd>Ctrl</kbd> + <kbd>Maj</kbd> + <kbd>O</kbd>
   sur Edge et Chrome.
4. Glisser le bouton **⇱ Working Book — importer** sur la barre de favoris.

   Si le glisser-déposer ne passe pas (poste verrouillé, tablette) : cliquer
   **Copier le lien**, créer un favori à la main et coller le texte copié dans le
   champ **Adresse**.

### Importer

1. Ouvrir l'Operator Mashup et lancer la recherche.
2. Cliquer dans le rapport, puis <kbd>Ctrl</kbd> + <kbd>A</kbd> et
   <kbd>Ctrl</kbd> + <kbd>C</kbd>.
3. Cliquer le favori. Il annonce ce qu'il a trouvé et demande validation.
4. Revenir dans Working Book : le rapport est là. Si l'onglet était resté ouvert,
   il se met à jour tout seul au retour dessus.

La première fois, le navigateur demande l'autorisation de lire le
presse-papiers. Accepter, sinon le favori ne peut rien recevoir.

Pour un rapport en plusieurs pages : passer à la page suivante, recopier,
recliquer.

## En cas de problème

| Message | Cause | Quoi faire |
| ------- | ----- | ---------- |
| *Le presse-papiers ne contient pas de rapport* | Rien de copié, ou une copie d'autre chose. | Cliquer dans le rapport, <kbd>Ctrl</kbd> + <kbd>A</kbd> / <kbd>Ctrl</kbd> + <kbd>C</kbd>, recliquer le favori. |
| *Lecture du presse-papiers refusée* | L'autorisation navigateur a été refusée. | La réactiver via l'icône dans la barre d'adresse, puis recliquer. |
| *Envoi impossible* | Serveur injoignable (réseau, ou politique de sécurité du portail). | **Rien n'a été importé.** Réessayer ; si ça persiste, coller dans Working Book → Schedule → **Importer**. |
| *Échec de l'import (422 no_records)* | Du texte a été lu mais aucune ligne n'a pu être décodée. | Vérifier qu'on est bien sur le rapport PMS230 et non sur un écran de recherche vide. Le rapport déjà chargé n'est pas touché. |

Le favori embarque l'adresse du serveur au moment où il est installé. Si elle
change, refaire l'installation.

## Pour l'administrateur

L'endpoint est `POST /api/schedules/ingest`. Il accepte les origines
`*.inforcloudsuite.com`, nécessaire pour que le favori et l'extension puissent
écrire depuis le portail, et n'exige aucune authentification — comme le reste de
l'API. Détails dans [`worker/README.md`](../worker/README.md).
