# Import direct depuis Mingle

Comment envoyer le rapport Operator Mashup dans Working Book **sans quitter le
portail Infor** : plus de changement d'onglet, plus de collage à la main.

Le copier-coller complet reste disponible et inchangé : c'est le repli quand
l'import direct est bloqué.

## Le principe

Working Book ne se connecte pas à Infor et ne détient aucun identifiant Infor.

C'est un **favori** (bookmarklet) installé dans le navigateur qui fait le
travail : cliqué depuis l'Operator Mashup, il récupère le rapport dans la
session déjà ouverte de l'opérateur et l'envoie au serveur Working Book. Le
serveur le passe par le même analyseur que la zone de collage, puis le partage
avec tous les postes.

Conséquence : rien à demander à l'IT, aucun compte de service, aucun mot de
passe stocké nulle part.

### Pourquoi il faut copier le rapport d'abord

Dans Mingle, le rapport M3 est affiché dans un **cadre servi par un autre
domaine** que le portail. Le navigateur interdit à toute page — favori compris —
de lire le contenu d'un cadre d'un autre domaine : c'est la protection de base
du web, et aucune écriture du favori ne peut la contourner.

Le favori passe donc par le presse-papiers : <kbd>Ctrl</kbd> + <kbd>A</kbd>,
<kbd>Ctrl</kbd> + <kbd>C</kbd> dans le rapport, là où l'opérateur se trouve
déjà, puis un clic. Ce qui disparaît, c'est le changement d'onglet, l'ouverture
de la feuille, le collage et le bouton Importer.

Si le mashup est ouvert **seul dans son onglet**, il n'y a plus de cadre : le
favori lit la page directement et la copie devient inutile.

### Se passer aussi de la copie : l'extension

Une seule chose au monde peut lire un cadre d'un autre domaine : une **extension
navigateur**, via `all_frames`. Le navigateur exécute alors le script *à
l'intérieur* du cadre de la grille.

Si les extensions sont autorisées sur le poste, c'est la meilleure option : plus
de copie, plus de clic, l'envoi part tout seul dès que la recherche aboutit.
Voir [`extension/README.md`](../extension/README.md).

Le favori décrit ci-dessous reste la solution quand les extensions sont
bloquées par l'IT.

## 1. Installer le favori (une seule fois, par poste)

1. Dans Working Book, onglet **Planning** → bouton **Importer rapport Operator
   Mashup**.
2. Dans l'en-tête de la feuille, cliquer **⇱ Import direct**.
3. Afficher la barre de favoris du navigateur : <kbd>Ctrl</kbd> +
   <kbd>Maj</kbd> + <kbd>O</kbd> sur Edge et Chrome.
4. Glisser le bouton **⇱ Working Book — importer** sur la barre de favoris.

   Si le glisser-déposer ne passe pas (poste verrouillé, tablette) : cliquer
   **Copier le lien**, créer un favori à la main et coller le texte copié dans
   le champ **Adresse**.

Le champ **Jeton** ne sert que si un jeton a été configuré côté serveur
(`INGEST_TOKEN`). Sinon, le laisser vide.

## 2. Importer

1. Ouvrir l'Operator Mashup et lancer la recherche habituelle.
2. Cliquer dans le rapport, puis <kbd>Ctrl</kbd> + <kbd>A</kbd> et
   <kbd>Ctrl</kbd> + <kbd>C</kbd>.
3. Cliquer le favori **⇱ Working Book — importer**. Il annonce ce qu'il a trouvé
   et demande validation.
4. Un message confirme : `N lignes lues`, et l'état du rapport.
5. Revenir dans Working Book : le rapport est là. Si l'onglet était resté
   ouvert, il se met à jour tout seul au retour dessus.

La première fois, le navigateur demande l'autorisation de lire le
presse-papiers. Accepter, sinon le favori ne peut rien recevoir.

### Rapport sur plusieurs pages

Le message indique `Page 1/4` le cas échéant. Passer à la page suivante dans le
mashup, recopier et recliquer le favori : les pages **s'ajoutent** les unes aux
autres.

C'est le réglage **Auto** : la page 1 remplace le rapport, les suivantes le
complètent. Relancer une recherche et cliquer sur sa page 1 repart donc d'un
rapport propre. Les réglages **Ajouter** et **Remplacer** forcent l'un ou
l'autre comportement pour ceux qui préfèrent décider eux-mêmes.

## En cas de problème

| Message | Cause | Quoi faire |
| ------- | ----- | ---------- |
| *Aucune ligne de planning lisible sur cette page* | Ni la page ni le presse-papiers ne contiennent de rapport. | Lancer la recherche, cliquer dans le rapport, <kbd>Ctrl</kbd> + <kbd>A</kbd> / <kbd>Ctrl</kbd> + <kbd>C</kbd>, puis recliquer le favori. |
| *Lecture du presse-papiers refusée* | L'autorisation navigateur a été refusée. | La réactiver via l'icône dans la barre d'adresse, puis recliquer. |
| *Envoi impossible* | Le serveur n'a pas été joignable (réseau, ou politique de sécurité du portail). | **Rien n'a été importé.** Réessayer ; si ça persiste, coller dans Working Book → Planning → **Importer**. |
| *Échec de l'import (401 unauthorized)* | Un jeton est exigé par le serveur et celui du favori ne correspond pas. | Corriger le champ **Jeton** dans la feuille Import direct, puis réinstaller le favori (il embarque le jeton). |
| *Échec de l'import (422 no_records)* | Du texte a été lu mais aucune ligne n'a pu être décodée. | Vérifier qu'on est bien sur le rapport PMS230 et non sur un écran de recherche vide. Le rapport déjà chargé n'est pas touché. |

Le favori embarque l'adresse du serveur et le jeton au moment où il est
installé. Si l'un des deux change, refaire l'étape 1.

## Pour l'administrateur

L'endpoint est `POST /api/schedules/ingest`. Comme il accepte les origines
`*.inforcloudsuite.com` — nécessaire pour que le favori puisse écrire depuis le
portail — il est recommandé de le protéger par un jeton :

```bash
cd worker
npx wrangler secret put INGEST_TOKEN --env production
```

Détails dans [`worker/README.md`](../worker/README.md).
