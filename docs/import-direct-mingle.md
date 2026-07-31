# Import direct depuis Mingle

Comment importer le rapport Operator Mashup dans Working Book **en un clic**,
depuis le portail Infor, sans Ctrl+A / Ctrl+C ni changement d'onglet.

Le copier-coller reste disponible et inchangé : c'est le repli quand l'import
direct est bloqué.

## Le principe

Working Book ne se connecte pas à Infor et ne détient aucun identifiant Infor.

C'est un **favori** (bookmarklet) installé dans le navigateur qui fait le
travail : cliqué depuis l'Operator Mashup, il lit le rapport dans la session
déjà ouverte de l'opérateur et l'envoie au serveur Working Book. Le serveur le
passe par le même analyseur que la zone de collage, puis le partage avec tous
les postes.

Conséquence : rien à demander à l'IT, aucun compte de service, aucun mot de
passe stocké nulle part.

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
2. Cliquer le favori **⇱ Working Book — importer**.
3. Un message confirme : `N lignes lues`, et l'état du rapport.
4. Revenir dans Working Book : le rapport est là. Si l'onglet était resté
   ouvert, il se met à jour tout seul au retour dessus.

### Rapport sur plusieurs pages

Le message indique `Page 1/4` le cas échéant. Passer à la page suivante dans le
mashup et recliquer le favori : les pages **s'ajoutent** les unes aux autres.

C'est le réglage **Auto** : la page 1 remplace le rapport, les suivantes le
complètent. Relancer une recherche et cliquer sur sa page 1 repart donc d'un
rapport propre. Les réglages **Ajouter** et **Remplacer** forcent l'un ou
l'autre comportement pour ceux qui préfèrent décider eux-mêmes.

## En cas de problème

| Message | Cause | Quoi faire |
| ------- | ----- | ---------- |
| *Aucune ligne de planning trouvée sur cette page* | La recherche n'a pas été lancée, ou le rapport est dans un cadre que le favori ne peut pas lire. | Lancer la recherche. Si le rapport est dans un cadre : clic droit dessus → **Ce cadre** → **Afficher uniquement ce cadre**, puis recliquer le favori. |
| *Le rapport a été copié dans le presse-papiers* | L'envoi au serveur a été bloqué (politique de sécurité du portail, ou réseau). | Coller dans Working Book → Planning → **Importer**. Le favori a déjà isolé le rapport, il n'y a plus qu'à coller. |
| *Échec de l'import (401 unauthorized)* | Un jeton est exigé par le serveur et celui du favori ne correspond pas. | Corriger le champ **Jeton** dans la feuille Import direct, puis réinstaller le favori (il embarque le jeton). |
| *Échec de l'import (422 no_records)* | La page a été lue mais aucune ligne n'a pu être décodée. | Vérifier qu'on est bien sur le rapport PMS230 et non sur un écran de recherche vide. Le rapport déjà chargé n'est pas touché. |

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
