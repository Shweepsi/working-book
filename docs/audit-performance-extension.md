# Audit — performance de l'extension d'import Operator Mashup

> **Statut : corrigé.** Tous les constats ci-dessous ont été traités ; le détail
> des correctifs et les mesures d'après-correction sont en fin de document
> (« Corrections »). Le texte des constats est laissé au présent, tel qu'il
> décrivait le comportement au moment de l'audit.

Portée : `extension/mashup.js` (résolution des critères, bouton Search,
pagination), `extension/content.js` (attentes, parcours des pages) et
`extension/background.js` (envoi). Version auditée : 2.2.2.

## Méthode

L'écran réel est derrière une session Infor : il n'est pas atteignable d'ici.
L'audit travaille donc sur un **écran PMS230 synthétique**, bâti d'après ce que
`mashup.js` et le README décrivent eux-mêmes de l'original — et notamment des
formes qui ont cassé le résolveur par le passé :

- contrôles Soho : le `<select>` natif masqué, un `div[role=combobox]` peint
  par-dessus ;
- les deux libellés de date portant le même `for="endDate"` ;
- une grille de données avec un champ de filtre par colonne ;
- un pager dont la taille de page est
  `<li><button class="btn-menu">5 Records per page</button></li>` ;
- une **seconde grille masquée**, avec son propre pager.

Trois tailles, pour voir l'effet de l'échelle : grille de 5 lignes (2 690
nœuds), de 50 lignes (4 085 nœuds), et de 50 lignes sous un shell de portail
plus fourni (8 397 nœuds).

Chromium piloté par Playwright, le fichier `mashup.js` injecté tel qu'il est
livré. Les valeurs citées sont des relevés dans la page, pas des estimations :

| relevé | comment |
| --- | --- |
| durée | `performance.now()`, médiane de 15 appels |
| mesures | `Element.prototype.getBoundingClientRect` compté par interception |
| lectures de texte | l'accesseur `Node.prototype.textContent`, idem |
| blocage | `PerformanceObserver` sur `longtask` — toute tâche de plus de 50 ms |

`getBoundingClientRect` est compté à part parce que c'est lui qui coûte :
l'appeler oblige le navigateur à connaître la géométrie de la page, donc à
terminer un calcul de mise en page qu'il aurait volontiers différé.

---

## Ce qui n'est pas en cause

Relevé d'abord, parce qu'il évitera d'optimiser au mauvais endroit : **les
attentes de `content.js` ne coûtent rien en calcul.** Sur la page la plus
lourde, le rapport fait 44 128 caractères et un tour de veille complet —
`document.body.innerText`, le comptage des schedules, l'empreinte djb2 —
prend **0,8 ms**, pour un tour toutes les 200 à 250 ms. La veille occupe donc
moins de 0,5 % du fil principal.

| opération | durée |
| --- | --- |
| `document.body.innerText` | 0,7 ms |
| `readReport()` complet | 0,7 ms |
| `hash()` sur 44 ko | 0,1 ms |

---

## P1 — Le résolveur mesure toute la page, quatre fois de suite

`resolveFields()` cherche chaque critère entre son libellé et le suivant. Pour
délimiter cette zone il parcourt `document.querySelectorAll('*')` — **toute la
page** — et teste chaque élément avec :

```js
const usable = (el) => reachable(el) && !claimed.has(el) && !el.closest?.(GRID_SEL);
…
for (const el of document.querySelectorAll('*')) {
  if (usable(el) && inRegion(el, label, next)) local.push(el);
}
```

Deux choses s'additionnent. D'abord la boucle est refaite **une fois par
critère**, soit quatre balayages complets. Ensuite `usable` est évalué en
premier, et sa première condition est `reachable` — qui mesure l'élément. Le
test le plus cher est donc appliqué à chaque cellule de la grille, alors
qu'aucune cellule n'est jamais un critère : `inRegion` et l'exclusion de la
grille l'auraient écartée pour rien.

`labelsInOrder()` ajoute sa part : il appelle `labelElements()` une fois par
nom, et chaque appel parcourt **tous les nœuds de texte de la page**. Le
rapport affiché à l'écran est donc relu quatre fois pour retrouver quatre
libellés.

Relevé, pour un seul appel à `locate()` :

| nœuds | durée | mesures de géométrie |
| --- | --- | --- |
| 2 690 | 17,6 ms | 5 387 |
| 4 085 | 27,8 ms | 8 177 |
| 8 397 | 56,9 ms | 16 801 |

Le nombre de mesures vaut deux fois le nombre de nœuds — les quatre balayages,
moins ce que la grille écarte.

**Ce que ça coûte vraiment**, c'est que `locate()` n'est pas appelé une fois.
Les contrôles sont re-résolus entre chaque écriture, délibérément — Angular
reconstruit la liste des Work Centers quand Facility change, et une référence
gardée pointerait sur un élément détaché. Une exécution sans cascade appelle
`locate()` **huit fois** ; une exécution qui réécrit Facility l'appelle **dix-
neuf fois**, parce que l'attente de la liste repeuplée interroge le formulaire
toutes les 150 ms — et chaque interrogation est un `locate()` entier.

Sur l'écran à 8 397 nœuds, 57 ms toutes les 150 ms, c'est **38 % du fil
principal** occupé pendant les huit secondes où l'extension attend
qu'Angular finisse de redessiner. Elle concurrence le travail qu'elle attend.

Mesuré sur une exécution complète avec cascade :

| | avant |
| --- | --- |
| durée | 2 854 ms |
| tâches de plus de 50 ms | 8 |
| fil principal bloqué | 995 ms |
| plus longue tâche | 342 ms |

Une tâche de 342 ms, c'est une vingtaine d'images sautées : sur l'onglet que
l'opérateur regarde, la grille se fige.

## P2 — Le bouton Search demande son texte à chaque `div` de la page

```js
Array.from(document.querySelectorAll('button, …, span, div')).filter((el) => {
  const text = el.tagName === 'INPUT' ? el.value : el.textContent;
  return wanted.includes(key(text)) && visible(el);
});
```

`el.textContent` sur un `div` renvoie le texte de **tout ce qu'il contient**. La
question est posée à chaque `div`, donc le texte d'une cellule de grille est
relu une fois par ancêtre au-dessus d'elle, et `key()` — trois opérations de
chaîne — est appliqué au résultat. Compté : **4 906 lectures de texte** par
appel sur la page à 8 397 nœuds, pour trouver un bouton qui affiche six
lettres.

## P3 — L'attente du pager sonde la page entière toutes les 150 ms

Après le clic sur Search, `maximiseRows()` attend que le pager soit dessiné —
jusqu'à 20 s, puisqu'il n'apparaît qu'au retour des lignes. L'attente sonde
`pagerTrigger()`, qui mesure et interroge chaque `button`, `a` et
`[role=button]` de la page.

C'est la pire fenêtre possible : le navigateur y construit la grille, et
l'extension lui réclame géométrie et texte trois fois par seconde. Relevé sur
3 s d'attente (une vingtaine de sondages) :

| | avant |
| --- | --- |
| mesures de géométrie | 34 294 |
| lectures de texte | 36 510 |

## P4 — Les boutons de pagination sont mesurés avant d'être lus

`nextPageButton()` et `firstPageButton()` parcourent tous les `button`, `a`,
`[role=button]` et `li` de la page — le menu de navigation du portail compris —
et commencent par `visible(el)`, c'est-à-dire par mesurer. Le libellé, qui
écarte tout sauf un ou deux candidats, n'est consulté qu'après.

Chacun lit aussi `el.textContent` **deux fois** par candidat : une fois pour
écarter le contrôle « Records per page », une fois dans `looksLikeNext()`.

| nœuds | durée | mesures | lectures de texte |
| --- | --- | --- | --- |
| 4 085 | 5,9 ms | 1 021 | 1 966 |
| 8 397 | 18,3 ms | 3 261 | 6 446 |

`nextPageButton()` tourne une fois par page : sur un rapport de 20 pages, c'est
une vingtaine de balayages complets de la page.

## P5 — Le rapport est sérialisé une fois par serveur

`ingest()` poste la même page aux deux adresses, et `post()` fait
`JSON.stringify({ text })` de son côté. Une page de grille pèse des dizaines de
kilo-octets ; sur une marche de 20 pages vers deux serveurs, c'est **40
sérialisations** du même contenu là où 20 suffisent.

---

## Ce qui domine la durée, et qui n'a pas été touché

Le parcours d'un rapport de 4 pages prend **13,2 s**, dont l'essentiel n'est pas
du calcul mais de l'attente volontaire :

| par page | durée |
| --- | --- |
| stabilisation avant lecture (`SETTLE_MS`) | ≥ 2 000 ms |
| attente du changement après « page suivante » | l'aller-retour serveur |
| envoi aux deux serveurs | en parallèle |

À ce rythme, un rapport de 20 pages demande de l'ordre d'une minute. Le
plancher est la stabilisation : `sweep()` la refait en tête de chaque tour,
même après que `changed()` a déjà constaté l'arrivée de la nouvelle page.

C'est **le seul levier qui reste** sur la durée, et il n'est pas actionné ici.
Ces 2 s sont le garde-fou qui empêche d'envoyer une grille à moitié dessinée, et
le README rappelle qu'il a été réglé contre l'écran réel. Le raccourcir sur un
écran synthétique reviendrait à régler un garde-fou sans le cas qu'il garde.
La marche est lente parce qu'elle attend, pas parce qu'elle calcule — et
l'attente, elle, ne coûte rien à personne.

**Actionné ensuite, en 2.4.** L'attente fixe a été remplacée par des signaux
— redessin des lignes après la réponse de la requête M3 que la frame envoie,
numéro de page affiché par le pager, nombre de lignes annoncé, 300 ms sans
mutation structurelle — avec un seul plafond de 20 s et l'ancienne règle des
2 s en repli quand le pager ne se lit pas. Le piège rencontré en chemin :
relancer Search laisse l'ancienne grille affichée, complète en apparence,
jusqu'à la réponse ; tout ce qui la repeint entre-temps (le réglage de la
taille de page, notamment) passait pour cette réponse. D'où la taille de page
réglée *avant* Search, la page 1 lue seulement après la requête, et un
redémarrage du parcours si le numéro de page régresse. Mesuré sur PMS230 :
**4 pages en ~7 s** (page 1 à 3,0 s après le clic, les suivantes à ~0,35 s),
contre 13,2 s ici. Le détail est dans `extension/README.md`, « Garde-fous ».

---

## Corrections

### P1 — le résolveur

- `labelElements()` devient `firstByText()` : **un seul parcours** du texte de
  la page répond pour les quatre libellés à la fois, et s'arrête dès qu'ils sont
  tous trouvés.
- Les conditions de `usable` sont remises dans l'ordre de ce qu'elles coûtent :
  la grille est écartée d'abord, la mesure vient en dernier.
- `document.querySelectorAll('*')` est appelé **une fois** pour les quatre
  critères, et la zone d'un critère est prise comme une **tranche** de cette
  liste : `querySelectorAll` rend les éléments dans l'ordre du document, donc la
  zone entre deux libellés est un intervalle, pas un filtre sur toute la page.
  `inRegion` garde le dernier mot sur chaque candidat — un ancêtre du libellé
  suivant tombe dans la tranche et lui seul peut le dire — mais il n'est plus
  interrogé que sur une zone.
- `local.map(drill)` devient `firstDrilled(local)` : la descente dans les
  conteneurs s'arrête au premier contrôle trouvé au lieu de continuer une fois
  la réponse en main.

### P2 — le bouton Search

Retrouvé **depuis le texte**, comme les libellés le sont déjà : le parcours des
nœuds de texte lit les mêmes caractères une seule fois, puis remonte au premier
élément cliquable qui les porte. Le repli sur `input[type=button][value]` est
conservé — un libellé porté par un attribut, aucun parcours de texte ne le voit.

### P3 — l'attente du pager

`pagerTrigger()` passe par le même chemin : le texte d'abord, la mesure
seulement sur ce qui porte le libellé.

### P4 — les boutons de pagination

`visible()` passe en dernier, après les libellés. Le texte de chaque candidat
est lu une fois et passé à `looksLikeNext()` au lieu d'être relu.

### P5 — l'envoi

`ingest()` sérialise le corps une fois et le passe à chaque adresse.

### Mesures d'après-correction

Un appel à `locate()` :

| nœuds | avant | après | mesures avant → après |
| --- | --- | --- | --- |
| 2 690 | 17,6 ms | **1,9 ms** | 5 387 → **19** |
| 4 085 | 27,8 ms | **2,3 ms** | 8 177 → **19** |
| 8 397 | 56,9 ms | **5,9 ms** | 16 801 → **19** |

Le nombre de mesures ne dépend plus de la taille de la page.

`nextPageButton()` :

| nœuds | avant | après | mesures avant → après |
| --- | --- | --- | --- |
| 4 085 | 5,9 ms | **3,9 ms** | 1 021 → **2** |
| 8 397 | 18,3 ms | **12,0 ms** | 3 261 → **2** |

Ce qui reste est la lecture du texte des candidats, qu'on ne peut pas éviter :
le bouton « page suivante » de Soho est une icône sans texte, et seul son
libellé accessible le distingue de « dernière page ».

Une exécution complète, critères déjà corrects :

| | avant | après |
| --- | --- | --- |
| mesures de géométrie | 66 483 | **163** |
| lectures de texte | 20 319 | **1 053** |
| durée | 1 060 ms | **855 ms** |

Une exécution avec cascade — Facility réécrit, liste des Work Centers
reconstruite :

| | avant | après |
| --- | --- | --- |
| durée | 2 854 ms | **2 486 ms** |
| tâches de plus de 50 ms | 8 | **1** |
| fil principal bloqué | 995 ms | **63 ms** |
| plus longue tâche | 342 ms | **63 ms** |

3 s d'attente du pager :

| | avant | après |
| --- | --- | --- |
| mesures de géométrie | 34 294 | **23** |
| lectures de texte | 36 510 | **2 637** |

Un parcours complet de 4 pages, de la recherche au retour en page 1 :

| | avant | après |
| --- | --- | --- |
| durée | 13,7 s | 13,2 s |
| fil principal bloqué | 594 ms | **81 ms** |
| pages / lignes / retour en page 1 | 4 / 200 / oui | 4 / 200 / oui |

La durée bouge peu — elle est faite d'attentes, et c'était le constat. Ce qui
change, c'est que l'onglet de l'opérateur n'est plus bloqué pendant que
l'extension travaille.

---

## Vérification d'équivalence

Aucune de ces corrections ne doit changer **ce qui est trouvé**, seulement le
chemin pour y arriver. Les deux versions de `mashup.js` sont donc chargées tour
à tour sur le même écran, et les six éléments résolus — les quatre critères, le
bouton Search, les boutons de pagination — sont comparés un à un, par balise,
`id`, classe et position dans le document.

Neuf écrans, chacun choisi pour une forme que le résolveur pourrait traiter
différemment :

| écran | écart |
| --- | --- |
| nominal | aucun |
| Search dans un `div[role=button]` | aucun |
| Search en `input[type=button][value]` | aucun |
| Search dans un `<label>` imbriqué | aucun |
| formulaire masqué en double, avant le vrai | aucun |
| Work Center sans `<select>` natif | aucun |
| grille en `role=treegrid` | aucun |
| libellés en français (« Centre de charge ») | aucun |
| grille vide | aucun |

Et le parcours complet, de bout en bout, rend le même résultat : 4 pages,
200 lignes, quatre envois de 50, grille remise en page 1.

## Ce qui reste

- **`deepQueryAll()`** parcourt `querySelectorAll('*')` à chaque niveau pour
  trouver les shadow roots. Il n'est plus appelé que rarement — la descente
  s'arrête au premier contrôle — mais il reste le plus cher des outils du
  fichier si un écran venait à l'emprunter souvent.
- **`ingest()` relit la configuration à chaque page** : une lecture de
  `storage.sync` par page envoyée, là où une par exécution suffirait. Quelques
  millisecondes, hors du fil de la page ; laissé tel quel, parce que relire est
  aussi ce qui fait qu'un changement d'options pris en cours de marche est
  respecté.
- **`badge()` pose un `setTimeout` de 600 s** dans un service worker que le
  navigateur arrête au bout de quelques dizaines de secondes d'inactivité : le
  minuteur ne survit pas, et `badgeTimer` non plus. Ce n'est pas un coût, c'est
  une pastille qui peut rester affichée ; hors périmètre de cet audit.
