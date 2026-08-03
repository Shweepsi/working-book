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
| Déclenchement | clic, à chaque page | un clic, ou automatique |
| Bloqué par la CSP du portail | possible | non (l'appel part du service worker) |

Le favori reste utile là où les extensions sont interdites.

## Installation

1. Récupérer le dossier `extension/` sur le poste (copie locale ou dézippage).
2. Dans Edge : `edge://extensions` — dans Chrome : `chrome://extensions`.
3. Activer **Mode développeur**.
4. **Charger l'extension non empaquetée**, puis désigner le dossier `extension/`.
5. C'est prêt : l'adresse du serveur, les critères et l'autorisation d'accès
   sont livrés avec l'extension.

Pour les changer — ou simplement vérifier — clic droit sur l'icône →
**Options**, puis **Tester la connexion**. `Connexion correcte` confirme que
tout est en place. Une adresse *différente* de celle livrée demande une
autorisation au navigateur, à accepter au moment d'enregistrer.

## Le panneau

Cliquer l'icône ouvre un panneau qui affiche, avant tout lancement, **ce qui va
être demandé** : installation, centre de charge et la fenêtre de dates calculée
pour aujourd'hui. Plus la version chargée — utile pour savoir d'un coup d'œil si le poste tourne bien sur la
dernière build.

Deux boutons, selon ce qu'on veut :

- **Rapport auto** enchaîne tout, jusqu'à l'envoi ;
- **Lancer la recherche** s'arrête après avoir préparé la grille — critères
  remplis, Search pressé, pagination élargie — et **n'envoie rien**.

Le second n'est pas une exécution amputée : le chemin est le même, seul l'envoi
est retenu. C'est aussi le seul des deux qui reste disponible sans adresse de
serveur configurée, puisqu'il ne touche que l'écran Mingle.

Une précaution y est attachée : préparer une grille sans l'envoyer devrait être
défait par l'envoi automatique, qui verrait la grille changer une seconde plus
tard et posterait ce qu'on venait justement de retenir. L'exécution enregistre
donc l'empreinte du rapport **sans l'envoyer**, ce qui le fait passer pour déjà
vu.

Pendant l'exécution les deux boutons se verrouillent, seul celui qui a été
pressé change de libellé, et le panneau compte les pages ; à la fin il affiche
le récapitulatif. Fermer le panneau **n'interrompt rien** : le rouvrir reprend
la progression là où elle en est.

Déclarer ce panneau a un prix, assumé : le navigateur cesse alors d'émettre
l'événement de clic sur l'icône, donc le clic ouvre le panneau au lieu de
lancer directement. Le lancement passe par le bouton.

L'enchaînement complet, lui, est inchangé :

1. **la recherche** — les quatre critères sont remplis puis Search est pressé ;
2. **l'agrandissement de la page** — la pagination est poussée à son maximum,
   ce qui décide de ce qui sera lu ;
3. **l'envoi** du rapport affiché ;
4. **la boucle** — page suivante, envoi, jusqu'à la dernière page ;
5. **le retour en page 1**, pour laisser l'écran comme il a été trouvé ;
6. **le récapitulatif**.

La pastille sur l'icône suit la même exécution : elle compte les pages, puis
affiche le nombre de lignes importées. Le récapitulatif se retrouve à trois
endroits — le panneau, le survol de l'icône, et les options sous **Dernière
exécution**.

Le décompte est celui que le **serveur** a effectivement enregistré, pas le
nombre de lignes que la grille affichait : les deux diffèrent dès qu'une ligne
ne se décode pas, et annoncer le second reviendrait à revendiquer un import qui
n'a pas eu lieu.

Pendant tout ce temps l'envoi automatique est suspendu — c'est l'exécution qui
possède les envois, sans quoi l'observateur reposterait chaque page une seconde
fois, et une fois le rapport précédent avant même que la recherche n'aboutisse.

Sur une page sans formulaire de recherche, le lancement retombe sur l'ancien
comportement : envoyer la grille affichée, telle quelle.

## Utilisation

Ouvrir l'Operator Mashup, cliquer l'icône, puis **Rapport auto**. C'est tout.

Rien ne part jamais tout seul d'une grille qu'on regarde : consulter le rapport
dans Mingle n'envoie rien. L'import est toujours demandé — par le bouton, ou
par la recherche automatique si elle est activée.

La pastille sur l'icône indique le résultat :

| Pastille | Sens |
| --- | --- |
| vert, un nombre | lignes importées |
| orange `0` | rapport lu mais aucune ligne décodée — le rapport stocké n'est pas touché |
| orange `vide` | aucune grille trouvée dans l'onglet |
| rouge `config` | adresse du serveur non renseignée |
| rouge `rés.` | serveur injoignable |
| vert `…` puis un chiffre | exécution en cours, le chiffre est la page atteinte |
| orange `form` | aucun écran PMS230 ouvert |
| orange `crit.` | un critère est resté vide — rien n'a été lancé |

Le panneau et le survol de l'icône donnent tous deux le détail de la dernière
exécution. Les réglages ne sont pas dans le panneau : clic droit sur l'icône →
**Options**. On y va une fois, ou jamais.

## Recherche automatique

L'extension peut aussi **remplir les critères et appuyer sur Search** elle-même,
pour que le rapport se rafraîchisse sans personne devant l'écran.

Dans les options, cocher **Relancer la recherche périodiquement** et régler :

| Réglage | Valeur d'usine | Sens |
| --- | --- | --- |
| Toutes les | `15` | minutes entre deux recherches |
| Facility | `221` | installation |
| Work Center | `COATER` | centre de charge |
| From Start Date | `-7` | début de fenêtre, **en jours depuis aujourd'hui** |
| To Start Date | `14` | fin de fenêtre, idem |
La pagination n'est pas réglable, et c'est délibéré : il n'y avait qu'une seule
bonne réponse — le maximum proposé, puis toutes les pages — et l'exposer n'a
jamais produit qu'une valeur oubliée qui cassait un import plus tard.

La grille est réglée sur **5 lignes par page** par défaut, et le rapport est lu
sur ce que la grille a réellement affiché. Cette pagination décide donc de ce
qui est importé, pas seulement du confort de lecture. Après chaque recherche,
l'extension pousse le sélecteur de pagination à la plus grande valeur proposée
par l'écran — 50 dans la liste actuelle.

Ce sélecteur est un contrôle Soho comme les autres : le `<select>` est masqué
et le texte « 5 Records per page » est peint dans un bloc voisin, pas à
l'intérieur. L'extension part donc de ce texte et remonte jusqu'au premier
`<select>` entièrement numérique.

Sur la grille PMS230, ce contrôle n'est **pas un `<select>` du tout** : c'est un
bouton qui ouvre un `ul.popupmenu`. Il n'y a donc rien où écrire — l'extension
l'ouvre et clique l'entrée, comme le ferait un opérateur. Si la valeur demandée
n'est pas au menu, elle prend la plus grande et le dit.

Deux garde-fous, appris à la dure. L'écran conserve **d'autres grilles
masquées** — une recherche PMS060 entre autres — chacune avec son propre
« Records per page » : seuls les pagers réellement affichés sont considérés.
Et un menu de taille de page **offre un choix**, donc un `<select>` à option
unique est écarté. Sans ces deux règles, `50` partait dans le pager d'une
grille invisible et vide, était rapporté comme accepté, pendant que la grille
visible restait à 5 lignes. Elle attend la pagination jusqu'à 20 s après
le clic sur Search, puisqu'elle n'est dessinée qu'au retour des lignes.

### Dépasser le maximum du menu

Le menu s'arrête à 50. Sur un `<select>`, une valeur supérieure peut être
ajoutée au contrôle et relue après coup — si l'écran la refuse, les options le
disent, car un plafond silencieux est un import tronqué sans avertissement.
Sur PMS230 le contrôle est un menu, où seule une entrée existante se clique :
50 y est le maximum réel.

Le **parcours des pages**, lui, n'a aucun plafond. L'extension envoie une page,
demande la suivante, et **attend que la grille ait réellement changé** avant de
lire — attendre qu'elle se stabilise ne suffit pas, puisqu'elle est déjà immobile
pendant l'aller-retour serveur : le parcours s'arrêtait alors au bout de deux
pages sur trente, croyant être arrivé au bout. Il s'arrête pour de bon quand un
clic ne change plus rien. Chaque envoi s'ajoute et une ligne revue est mise à
jour, jamais dupliquée, donc un recouvrement est sans conséquence. Réglé sur 20
pages, `1` pour désactiver.

Les dates sont des **décalages**, pas des dates fixes : `-7` / `14` demandent
en permanence la semaine écoulée et les deux à venir. Une date en dur
serait juste le premier jour et fausse tous les suivants, sans que personne s'en
aperçoive. Un critère laissé vide n'est pas écrit : l'écran garde sa valeur.

L'onglet Mingle doit rester ouvert et la session Infor valide — l'extension
pilote la page de l'opérateur, elle ne se connecte pas à Infor.

### Comment les champs sont retrouvés

Par **le libellé affiché** (« Facility », « Work Center », « From Start Date »,
« To Start Date », « Search »), jamais par un identifiant : Infor les génère et
les change d'une version à l'autre, les libellés non.

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

Un contrôle introuvable est rapporté **manquant** plutôt que remplacé par son
voisin, et le récapitulatif nomme le critère fautif : « Recherche non lancée —
workCenter vide ». C'est le seul diagnostic qui reste, et le seul dont on ait
besoin une fois l'écran compris.

## Garde-fous

- **Attente de stabilisation** : une page n'est lue qu'après 2 s sans
  modification, sinon une grille à moitié dessinée serait envoyée pendant que la
  recherche se résout.
- **Anti-répétition** : au cours d'un parcours, une page dont le contenu répète
  la précédente arrête la boucle — c'est ainsi que la dernière page est
  reconnue.
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
