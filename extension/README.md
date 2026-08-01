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
5. Ouvrir les **options** de l'extension et renseigner l'**adresse du serveur** :
   l'URL du Worker, la même que `VITE_API_URL`.
6. Cliquer **Enregistrer** — le navigateur demande l'autorisation d'accéder au
   serveur, il faut l'accepter — puis **Tester la connexion**.

`Connexion correcte` confirme que tout est en place.

## Utilisation

Ouvrir l'Operator Mashup et lancer la recherche. C'est tout : l'extension
détecte que la grille a changé, attend qu'elle se stabilise, et envoie.

La pastille sur l'icône indique le résultat :

| Pastille | Sens |
| --- | --- |
| vert, un nombre | lignes importées |
| orange `0` | rapport lu mais aucune ligne décodée — le rapport stocké n'est pas touché |
| orange `vide` | aucune grille trouvée dans l'onglet |
| rouge `config` | adresse du serveur non renseignée |
| rouge `rés.` | serveur injoignable |
| orange `form` | recherche automatique : aucun écran PMS230 ouvert |
| orange `crit.` | un critère est resté vide — rien n'a été lancé |

Un clic sur l'icône force un envoi immédiat, même si rien n'a changé.

L'envoi automatique se coupe dans les options ; l'icône reste alors le seul
déclencheur.

## Recherche automatique

L'extension peut aussi **remplir les critères et appuyer sur Search** elle-même,
pour que le rapport se rafraîchisse sans personne devant l'écran.

Dans les options, cocher **Relancer la recherche périodiquement** et régler :

| Réglage | Valeur d'usine | Sens |
| --- | --- | --- |
| Toutes les | `15` | minutes entre deux recherches |
| Facility | `221` | installation |
| Work Center | `COATER` | centre de charge |
| From Start Date | `-14` | début de fenêtre, **en jours depuis aujourd'hui** |
| To Start Date | `14` | fin de fenêtre, idem |
| Maximum de lignes par page | coché | voir ci-dessous |

La grille est réglée sur **5 lignes par page** par défaut, et le rapport est lu
sur ce que la grille a réellement affiché. Cette pagination décide donc de ce
qui est importé, pas seulement du confort de lecture. Après chaque recherche,
l'extension pousse le sélecteur de pagination à la plus grande valeur proposée
par l'écran — 50 dans la liste actuelle.

Les dates sont des **décalages**, pas des dates fixes : `-14` / `14` demandent
en permanence les deux semaines écoulées et les deux à venir. Une date en dur
serait juste le premier jour et fausse tous les suivants, sans que personne s'en
aperçoive. Un critère laissé vide n'est pas écrit : l'écran garde sa valeur.

L'onglet Mingle doit rester ouvert et la session Infor valide — l'extension
pilote la page de l'opérateur, elle ne se connecte pas à Infor.

### Vérifier que les champs sont reconnus

Les champs sont retrouvés par **le libellé affiché** (« Facility », « Work
Center », « From Start Date », « To Start Date », « Search »), jamais par un
identifiant : Infor les génère et les change d'une version à l'autre, les
libellés non.

Avant de compter dessus, ouvrir l'écran PMS230 dans Mingle puis, dans les
options, cliquer **Vérifier les champs**. La réponse liste ce qui a été reconnu
et avec quelle valeur actuelle — sans rien écrire. `5/5 éléments reconnus`
confirme que le pilotage tiendra. **Lancer une recherche** fait ensuite un essai
complet.

### Ce que l'extension ne réécrit pas

Un champ qui affiche déjà la bonne valeur est **laissé tel quel**. Ce n'est pas
une optimisation : écrire Facility fait recharger la liste des Work Centers, qui
reste vide le temps de l'aller-retour. Ne pas toucher un champ déjà juste évite
la cascade entière.

Quand une écriture est nécessaire, l'ordre est Facility d'abord, puis Work
Center — et l'extension **attend** que la liste se soit repeuplée avant d'y
écrire, jusqu'à 8 secondes.

Les contrôles sont **re-résolus entre chaque écriture**. Angular reconstruit la
liste des Work Centers quand Facility change : l'ancien élément est détaché du
document, et une référence gardée du début de l'exécution ne pointe plus sur
rien. C'est ce qui obligeait à lancer la recherche deux fois — le premier
passage s'arrêtait après Facility, le second réussissait parce que Facility
était déjà bon et que rien n'était reconstruit.

Enfin, Search n'est cliqué que si les quatre critères sont effectivement
renseignés au moment du clic. Un formulaire incomplet ferait répondre à l'écran
*Facility, Work Center and Start Dates must be entered* et viderait la grille ;
mieux vaut ne rien lancer et dire quel champ manque.

### Si un critère reste vide

Le message des options nomme le champ fautif. Le plus souvent c'est une valeur
absente de la liste : la choisir **une fois à la main** dans Mingle suffit —
l'extension la reconnaîtra ensuite comme déjà correcte et cessera d'y toucher.

Chaque critère est cherché **entre son propre libellé et le suivant**, et un
élément déjà attribué à un critère ne peut pas l'être à un second. Sans cette
double borne, un contrôle non standard — Work Center en est un — était sauté et
le critère héritait de l'input du voisin : deux critères sur un même champ,
`5/5 reconnus` affiché, et rien d'écrit dans le bon.

Dans sa zone, l'extension prend le champ de formulaire s'il y en a un ; sinon
elle **descend dans le conteneur** jusqu'au contrôle qu'il enveloppe, y compris
à travers un shadow DOM.

L'écran est bâti sur l'Infor Design System (Soho), qui **masque le `<select>`
natif** et dessine par-dessus un `div[role=combobox]`. Le select masqué reste le
contrôle : c'est lui qui porte les options et la valeur lue au moment du Search.
Un `<select>` pourvu d'options est donc retenu même invisible — l'exiger visible
faisait retomber Work Center sur le `div` décoratif, qui n'a aucune valeur.

Les libellés `for` ne sont suivis que s'ils pointent dans la zone du critère :
sur cet écran les deux libellés de date portent le même `for="endDate"`.

Un contrôle introuvable est rapporté **manquant**, et un contrôle reconnu mais
**vide** l'est aussi : dans les deux cas le balisage qui l'entoure est affiché
tel quel dans les options, à copier pour faire corriger la reconnaissance. Le
second cas est le plus traître — il s'annonce reconnu et écrit à côté.

Si un champ manque, renseigner son sélecteur CSS dans **Sélecteurs manuels**,
une ligne `champ = sélecteur` par champ (`facility`, `workCenter`, `dateFrom`,
`dateTo`, `search`). Pour l'obtenir : clic droit sur le champ → Inspecter, puis
clic droit sur la ligne surlignée → Copy → Copy selector.

## Garde-fous

- **Attente de stabilisation** : rien ne part avant 2 s sans modification de la
  page, sinon une grille à moitié dessinée serait envoyée pendant que la
  recherche se résout.
- **Anti-répétition** : un contenu identique au dernier envoyé est ignoré, et
  deux envois automatiques sont séparés d'au moins 5 s.
- Le serveur refuse (`422`) un contenu dont aucune ligne ne se décode, **sans
  toucher** au rapport déjà stocké.
- **Tout envoi s'ajoute** au rapport, jamais ne le remplace. Réenvoyer une même
  page met ses lignes à jour au lieu de les dupliquer (clé `schedule|MO`), donc
  un envoi automatique de trop est sans conséquence. Retirer un schedule se fait
  depuis l'onglet Schedule de l'app.

## Ce qui sort du poste

Uniquement le texte du rapport, vers l'adresse renseignée dans les options.
L'extension ne détient aucun identifiant Infor et ne parle jamais à Infor : elle
lit une page déjà ouverte dans la session de l'opérateur.
