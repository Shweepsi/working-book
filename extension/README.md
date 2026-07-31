# Working Book — extension d'import Operator Mashup

Envoie le rapport PMS230 vers Working Book **sans copier-coller et sans clic**,
depuis Mingle.

## Pourquoi une extension et pas seulement le favori

Dans Mingle, la grille M3 est servie par un **autre domaine** que
`mingle-portal`. La politique d'origine unique interdit à toute page — favori
compris — de lire le contenu d'un cadre d'un autre domaine. C'est une protection
du navigateur, pas un défaut de programmation : aucune écriture de favori ne la
contourne. Le favori se rabat donc sur le presse-papiers.

Une extension a une capacité que rien d'autre n'a : `all_frames`. Le navigateur
exécute une copie du script **à l'intérieur** du cadre de la grille, où la
lecture est légitime. D'où :

| | Favori | Extension |
| --- | --- | --- |
| Lire un cadre d'un autre domaine | impossible | oui |
| Copie manuelle du rapport | nécessaire | non |
| Déclenchement | clic | automatique dès que le rapport change |
| Bloqué par la CSP du portail | possible | non (l'appel part du service worker) |

Le favori reste utile là où les extensions sont interdites.

## Installation

1. Récupérer le dossier `extension/` sur le poste (copie locale ou dézippage).
2. Dans Edge : `edge://extensions` — dans Chrome : `chrome://extensions`.
3. Activer **Mode développeur**.
4. **Charger l'extension non empaquetée**, puis désigner le dossier `extension/`.
5. Ouvrir les **options** de l'extension et renseigner :
   - **Adresse du serveur** : l'URL du Worker (la même que `VITE_API_URL`).
   - **Jeton** : uniquement si `INGEST_TOKEN` est défini côté serveur.
6. Cliquer **Enregistrer** — le navigateur demande l'autorisation d'accéder au
   serveur, il faut l'accepter — puis **Tester la connexion**.

`Connexion et jeton corrects` confirme que tout est en place.

## Utilisation

Ouvrir l'Operator Mashup et lancer la recherche. C'est tout : l'extension
détecte que la grille a changé, attend qu'elle se stabilise, et envoie.

La pastille sur l'icône indique le résultat :

| Pastille | Sens |
| --- | --- |
| vert, un nombre | lignes importées |
| orange `0` | rapport lu mais aucune ligne décodée — le rapport stocké n'est pas touché |
| orange `vide` | aucune grille trouvée dans l'onglet |
| rouge `401` | jeton refusé |
| rouge `config` | adresse du serveur non renseignée |
| rouge `rés.` | serveur injoignable |

Un clic sur l'icône force un envoi immédiat, même si rien n'a changé.

L'envoi automatique se coupe dans les options ; l'icône reste alors le seul
déclencheur.

## Garde-fous

- **Attente de stabilisation** : rien ne part avant 2 s sans modification de la
  page, sinon une grille à moitié dessinée serait envoyée pendant que la
  recherche se résout.
- **Anti-répétition** : un contenu identique au dernier envoyé est ignoré, et
  deux envois automatiques sont séparés d'au moins 5 s.
- Le serveur refuse (`422`) un contenu dont aucune ligne ne se décode, **sans
  toucher** au rapport déjà stocké.
- Pagination : le mode `auto` fait remplacer par la page 1 et ajouter par les
  suivantes, exactement comme les autres voies d'import.

## Ce qui sort du poste

Uniquement le texte du rapport, vers l'adresse renseignée dans les options.
L'extension ne détient aucun identifiant Infor et ne parle jamais à Infor : elle
lit une page déjà ouverte dans la session de l'opérateur.
