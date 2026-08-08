# Audit — tableau Schedule, aperçu d'impression et rendu papier

> **Statut : corrigé.** Tous les constats ci-dessous ont été traités ; le détail
> des correctifs et les mesures d'après-correction sont en fin de document
> (« Corrections »). Le texte des constats est laissé au présent, tel qu'il
> décrivait le comportement au moment de l'audit.

Portée : `src/components/Schedules.tsx`, le bloc unifié `:root.is-print-preview` /
`:root.is-printing` de `src/styles/app.css`, le bloc `@media print`, et le pilotage
depuis `src/App.tsx` (`is-printing`, `#wb-page-size`) / `src/components/Settings.tsx`
(bascule aperçu).

## Méthode

Build de production servi en local, Chromium piloté par Playwright, `localStorage`
amorcé avec un rapport PMS230 synthétique (57 lignes, 2 schedules, 5 groupes de
longueur, noms d'article de longueur réaliste) et une table MTO/MTS complète.
Quatre états mesurés séparément :

| état | comment |
| --- | --- |
| écran | media `screen`, aucune classe |
| aperçu | media `screen` + `.is-print-preview` sur `<html>` |
| impression réelle | media `print` + `.is-printing` (ce que pose `beforeprint`) |
| repli | media `print` **sans** `.is-printing` |

Les valeurs citées sont des `getComputedStyle` / `getBoundingClientRect` relevés dans
la page, pas des estimations. Géométrie papier de référence : A4 paysage, marges 5 mm
→ 287 mm ≈ **1084 px CSS** de large, **733 px** de haut par page.

Vérifié au passage : Chromium déclenche bien `beforeprint`, y compris via
`page.pdf()` — donc sous Chromium c'est le chemin `is-printing` qui s'exécute.

---

## P1 — Le repli `@media print` du schedule est intégralement neutralisé

`app.css:2054-2112` duplique le bloc unifié « au cas où `beforeprint` ne poserait pas
la classe à temps », avec le commentaire « Keep these in sync with the unified block ».
Ce repli ne s'applique jamais : ses sélecteurs sont de spécificité `(0,1,0)` et les
règles `.sch-*` de base vivent **plus bas** dans le fichier (à partir de `app.css:2323`),
donc l'ordre source les fait gagner.

Relevé en media `print` sans `is-printing` :

| déclaration du repli | visé | réel |
| --- | --- | --- |
| `.sch-body { display: block }` | `block` | **`grid`** (la piste du rail reste réservée) |
| `.sch-table { max-height: none }` | `none` | **`493px`** |
| `.sch-table { min-height: 0 }` | `0px` | **`320px`** |
| `.sch-table { overflow: visible }` | `visible` | **`auto`** |
| `.sch-table { background-image: none }` | `none` | **4 dégradés toujours peints** |
| `.sch-row { min-width: 0 }` | `0px` | **`1006px`** |
| `.sch-row { grid-template-columns: var(--sch-grid-print, …) }` | gabarit `fr` | **gabarit écran en px** |
| `.sch-head`, `.sch-total { position: static }` | `static` | **`sticky`** |
| `.sch-total { border-top: 0 }` | `0px` | **`2px`** |
| `.sch-cell { padding: 3pt 4pt; font-size: 8.5pt }` | `4px 5.33px` / `11.33px` | **`6px 8px` / `12px`** |
| `.sch-row.sch-head .sch-cell { padding: 4pt }` | `5.33px` | **`9px 5px`** |
| `.sch-group-break { min-height: 10pt; border-bottom: 0 }` | `13.3px` / `0` | **`22px` / `1px`** |
| `.sch-vitesse-print { display: inline }` | `inline` | **`none`** |

Ne survivent que les déclarations marquées `!important` (`.sch-detail-head`,
`.sch-col-resize`) ou sans concurrente plus bas (`border-radius`, `border-right` des
cellules).

**Conséquence mesurée.** Le tableau reste une boîte de défilement de 493 px de haut
alors que son contenu fait 1276 px : **13 lignes sur 38 atteignent le papier**, le reste
est coupé net. La ligne de total, elle, s'imprime et annonce toujours « Total · 38
lignes » — la perte est donc silencieuse. Et la vitesse ne s'imprime pas du tout :
`.sch-vitesse-input` est masqué par le repli, `.sch-vitesse-print` est masqué par
`app.css:2799`, la tuile n'affiche plus que « VITESSE » et « m/min ».

**Quand c'est atteint.** Dès que `beforeprint` ne pose pas `is-printing` avant la
capture de mise en page. Chromium, Firefox et Safari desktop le déclenchent (vérifié
pour Chromium). Safari iOS/iPadOS n'implémente pas `beforeprint` — non testable ici,
mais c'est exactement le scénario que le repli était censé couvrir, et sur une PWA
pensée pour la tablette il n'est pas théorique. Dans tous les cas, le repli ne protège
rien aujourd'hui.

**Correctif.** Remonter la spécificité du repli au-dessus des règles de base *et* des
règles de densité (voir P2) — le plus simple étant de préfixer chaque sélecteur par
`:root` et de déplacer le bloc en fin de fichier. Ou, plus sûr à long terme, supprimer
la duplication : générer les trois listes de sélecteurs depuis une seule source.

---

## P2 — La densité écran écrase la mise en page papier

`:root[data-density='compact'] .sch-cell` (`app.css:3154`) et
`:root[data-density='advanced'] .sch-cell` (`app.css:3180`) ont la **même** spécificité
que `:root.is-printing .sch-cell` (`app.css:1796`) mais viennent après. Elles gagnent.
Idem pour `.sch-row.sch-head`, `.sch-row.sch-total` et les paddings de leurs cellules.

L'auteur a déjà rencontré le problème pour `.sch-detail-head` et l'a réglé avec
`!important` (commentaire `app.css:1732-1735`) ; les cellules du tableau n'ont pas eu
le même traitement.

Relevé avec `is-printing` posé, A4 paysage, même jeu de données :

| | compact | **normal (visé)** | advanced |
| --- | --- | --- | --- |
| `.sch-cell` padding | `2px 6px` | `4px 5.33px` | `8px 10px` |
| `.sch-cell` font-size | `11px` | `11.33px` (8.5 pt) | `13px` |
| en-tête font-size | `9px` | `10px` (7.5 pt) | `11px` |
| total font-size | `12px` | `12px` (9 pt) | `14px` |
| hauteur du document | 887 px | 1114 px | 1871 px |
| **pages A4** | 2 | 2 | **3** |

En densité « Avancé », `.sch-customer` s'imprime aussi (`app.css:3083`, jamais annulé
en impression) : chaque ligne du tableau occupe deux lignes de texte sur le papier.

Autrement dit, le même schedule sort sur 2 ou 3 feuilles selon un réglage d'affichage,
sans que rien ne le signale.

**Correctif.** `!important` sur le dimensionnement papier des cellules / lignes, ou
sélecteurs d'impression plus spécifiques (`:root.is-printing[data-density] .sch-cell`).
Et neutraliser explicitement `.sch-customer` en impression, ou l'assumer et le prévoir.

---

## P2 — L'en-tête de colonnes ne se répète pas d'une page à l'autre

Mesuré : la ligne d'en-tête occupe y = 35→59, la coupure de page tombe à y = 733,
et **16 lignes sur 38 atterrissent en page 2 sans aucun en-tête de colonne**. Sur une
feuille de 12 colonnes numériques (Sched / Prod / Req / L/Pack / P/REQ / m²), une page
sans titres de colonnes n'est pas lisible en poste.

La cause est structurelle : le tableau est une grille de `<div>`, pas un `<table>`,
donc `display: table-header-group` n'est pas disponible. La ligne de total ne
s'imprime elle aussi qu'une fois, tout à la fin.

**Pistes.** (a) rendre l'en-tête en `<thead>` d'un vrai `<table>` — le plus propre mais
c'est une refonte du rendu ; (b) un en-tête courant en `position: fixed` réservé à
l'impression ; (c) à défaut, répéter au minimum le numéro de schedule et la légende
des colonnes en pied de page.

À l'inverse, `page-break-inside: avoid` sur `.sch-row` fonctionne : aucune ligne n'est
coupée en deux à la pagination réelle.

---

## P2 — L'Article est tronqué sur le papier alors qu'il ne l'est pas à l'écran

`gridTemplatePrint` (`Schedules.tsx:1228-1230`) repondère chaque colonne par sa largeur
*intrinsèque par défaut*, lue par `columnPx`. Or pour une piste souple, `columnPx`
renvoie le plancher du `minmax`, pas la largeur réelle : Article vaut donc `180fr` alors
qu'il occupe 362 px à l'écran, et PDP `100fr` pour 226 px.

Largeurs mesurées de la colonne Article :

| | largeur | articles tronqués |
| --- | --- | --- |
| écran (1600 px) | 362 px | **4 / 38** |
| papier (287 mm) | 194 px | **30 / 38** |

`.sch-name` conserve `white-space: nowrap` + `text-overflow: ellipsis` en impression :
le champ le plus identifiant de la ligne part en « SOLARBAN 70XL LOW-E DOUB… » sans
recours possible sur papier. L'en-tête `MTO/MTS` est lui-même tronqué en « MTO/… »
(pondération 56fr trop faible pour son propre libellé).

**Correctif.** En impression, laisser `.col-name` passer à la ligne
(`white-space: normal; overflow: visible`) — les lignes portent déjà
`page-break-inside: avoid`, le débordement vertical est donc sans risque. Et/ou donner
à Article une pondération papier issue du `fr` déclaré (1.6) plutôt que du plancher.

---

## P2 — Imprimer depuis l'aperçu ne donne pas le même résultat qu'imprimer normalement

`:root.is-print-preview .app-main` (`app.css:1638`, spécificité `(0,3,0)`) l'emporte sur
`@media print { .app-main { padding: 0; max-width: none } }` (`app.css:1896`,
spécificité `(0,1,0)`). Le bouton « Imprimer » de la barre d'aperçu (`App.tsx:352`)
appelle `window.print()` sans retirer la classe : l'habillage « feuille » de l'aperçu
part donc à l'imprimante.

Relevé en media `print`, avec puis sans `is-print-preview` :

| | impression normale | depuis l'aperçu |
| --- | --- | --- |
| `.app-main` padding | `0px` | **`18.9px` (5 mm)**, en plus des 5 mm de `@page` |
| `.app-main` margin | `0px` | **`24px 0 80px`** |
| largeur de ligne | 1082 px | **1044 px** |
| hauteur du document | 733 px | **1258 px** |

Les deux PDF produits sont bien différents (empreintes distinctes). Concrètement :
marges doublées à 10 mm, tableau 38 px plus étroit, et 104 px de blanc vertical qui,
sur un schedule qui finit près d'une coupure, coûtent une feuille supplémentaire.

**Correctif.** Soit neutraliser les règles d'aperçu sous `@media print`, soit retirer
`is-print-preview` avant l'appel à `window.print()` et le remettre sur `afterprint`.

---

## P3 — L'aperçu n'est fidèle qu'au-dessus d'environ 1123 px de fenêtre

`:root.is-print-preview .app-main:has(.sch)` fixe `max-width: 297mm` (= 1122,5 px) mais
laisse la largeur en `auto`. Au-dessus de ce seuil l'aperçu colle au papier (ligne de
1083 px contre 1082 px mesurés — excellent) ; en dessous, il rétrécit avec la fenêtre.

| largeur de fenêtre | largeur de ligne | écart au papier |
| --- | --- | --- |
| 1600 px | 1083 px | ≈ 0 |
| 1280 px | 1083 px | ≈ 0 |
| 900 px | 860 px | **−21 %** |

L'aperçu devient donc pessimiste : il montre plus de troncature qu'il n'y en aura.
Sur la cible tablette de l'application, il est systématiquement dans ce régime. Il
manque par ailleurs les trois repères qui font l'utilité d'un aperçu : les limites de
page, le nombre de pages, et une échelle fixe (zoom) indépendante de la fenêtre.

---

## P3 — Aucune métadonnée d'impression sur la feuille schedule

`Logbook.tsx:563` et `ProductionTest.tsx:296` rendent un bloc
`.print-header print-only` (titre, date, poste) et un `.print-signature`. `Schedules.tsx`
n'en rend aucun : la feuille sort sans date, sans poste, sans opérateur, sans « imprimé
le ». Seul l'en-tête `.sch-detail-head` subsiste (numéro de schedule, article dominant,
vitesse, temps de production) — utile, mais un planning papier sans date circule mal.

Le style `.print-only` existe pourtant dans les deux blocs d'impression : le crochet est
en place, il n'est simplement pas utilisé par cette vue.

---

## P3 — Un tableau filtré s'imprime sans dire qu'il l'est

`.sch-controls` porte `no-print` (`Schedules.tsx:1387`) et est masqué par les deux blocs.
Le commentaire d'`app.css:297-298` énonce l'intention pour la barre du Logbook :
« Hidden in print so the printout never shows a partial / filtered view ». Mais masquer
la barre ne défiltre rien : `visibleRows` est déjà filtré (`Schedules.tsx:412-417`) et
`TotalRow` totalise l'ensemble filtré. Le papier montre donc bien une vue partielle —
et on lui a retiré le seul indice qui permettait de s'en apercevoir. Même remarque pour
un tri non par défaut.

**Correctif.** Une ligne `print-only` récapitulant les filtres actifs et le tri, ou au
minimum une mention « Filtré » à côté du total.

---

## P3 — Cliquer une ligne en mode aperçu est un cul-de-sac

Les lignes restent des `<button>` en aperçu ; `RowDetailSheet` se monte bien, mais
`.sheet` et `.sheet-backdrop` sont en `display: none !important` (`app.css:1631-1632`).
Mesuré : la feuille est dans le DOM avec `display: none`. Rien ne s'ouvre, rien ne
signale pourquoi, et `openRowId` reste positionné jusqu'à la sortie de l'aperçu.

**Correctif.** Neutraliser le clic (et le curseur) sur les lignes en aperçu, ou laisser
la feuille de détail s'afficher.

---

## P4 — Dérive entre l'aperçu et l'impression réelle hors schedule

L'aperçu se présente comme un miroir de la feuille de style d'impression
(`app.css:1603-1607`). Il l'est pour le schedule ; il ne l'est pas ailleurs, parce que
les deux blocs sont maintenus à la main :

- **Puces de flag** : l'impression réelle n'affiche que la puce active
  (`app.css:1972-1988`) ; l'aperçu les affiche toutes.
- **Production Test** : `.pt-section header h3`, `.pt-header label/input/.field-*`,
  `.measure-cell` / `.lab-grid`, `.pt-comments textarea` ne sont mis en forme que dans
  le bloc réel (`app.css:2021-2043`).
- `.evt .time/.dur/… { grid-area: auto !important }` (`app.css:1967-1969`) n'existe que
  côté impression.

Les sélecteurs `.evt-filterbar`, `.pt-tests`, `.toast-viewport`, `.fab` listés dans le
bloc aperçu (`app.css:1621-1637`) sont en revanche redondants : ces éléments portent
déjà `no-print` dans le JSX, donc les deux blocs les masquent bien.

---

## P4 — Points de détail

- `.sch-total-label { grid-column: 1 / 6 }` (`app.css:2896`) est mort : `TotalRow`
  n'applique cette classe que dans la branche « fusionnée », qui pose toujours un
  `gridColumn` en style inline (`Schedules.tsx:1642`).
- `TotalRow` : si toutes les colonnes visibles portent un total (`labelStart === -1`),
  aucun libellé « Total » n'est rendu (`Schedules.tsx:1626-1652`). Atteignable en
  masquant tout sauf Sched / Prod / Req / m².
- `sanitiseTableSettings` caste `raw.sortKey` en `SortKey` sans vérifier l'appartenance
  (`Schedules.tsx:249`). Une valeur périmée fait retourner `undefined` à `compareRows` ;
  comme `primary !== 0` est vrai pour `undefined`, le comparateur sort immédiatement et
  les départages secondaires ne s'exécutent jamais.
- `@page { size: A4 portrait }` (`app.css:1866`) est toujours écrasé par l'élément
  `#wb-page-size` injecté (`App.tsx:170-178`), qui est ajouté à `<head>` après la
  feuille bundlée. Ça marche, mais ça repose sur l'ordre de chargement plutôt que sur
  une règle explicite.
- La pondération `56fr` de `col-mto` ne suffit pas à son propre libellé d'en-tête.

---

## Ce qui fonctionne (vérifié)

- La redirection de tokens (`tokens.css:182-293`) fait bien virer le thème sombre au
  noir-sur-blanc : test mené avec `wb.theme = "dark"`, sortie papier correcte.
- `print-color-adjust: exact` préserve la teinte m², les bandeaux en-tête/total et les
  pastilles MTO/MTS.
- P/REQ incomplet rend bien en gras souligné en monochrome (`app.css:1830-1831`).
- `page-break-inside: avoid` sur `.sch-row` : aucune ligne coupée à la pagination.
- La bascule d'orientation `@page` par onglet fonctionne, et le contournement du bug
  Chromium des `@page` nommées (commentaire `App.tsx:165-169`) tient : 38 lignes → 2
  feuilles, pas 39.
- Sur le chemin nominal (Chromium, densité « Normal »), la géométrie de l'aperçu est à
  1 px près celle du papier.

---

## Ordre de traitement suggéré

1. **P1** — spécificité du repli `@media print` : perte silencieuse de lignes.
2. **P2** — densité vs impression, puis troncature de l'Article : les deux altèrent le
   contenu du papier sans le signaler.
3. **P2** — répétition de l'en-tête de colonnes.
4. **P2** — impression depuis l'aperçu.
5. **P3/P4** — métadonnées, mention de filtrage, fidélité de l'aperçu, nettoyages.

---

# Corrections

Mêmes mesures, même harnais, après correctifs.

## Le tableau devient un vrai `<table>`

Le point structurel qui débloque le reste. Le rendu à l'écran est inchangé : la
boîte tableau est dissoute en flex/grid (`thead`/`tbody` en `display: contents`,
chaque `<tr>` redevient la grille pilotée par `--sch-grid`), et n'est rétablie
que pour l'aperçu et le papier. Les largeurs papier passent par un `<colgroup>`
en pourcentages au lieu du gabarit `fr` — `--sch-grid-print` disparaît.

Parité écran vérifiée avant/après sur six scénarios (défaut, colonnes épinglées
+ défilement horizontal, après un redimensionnement de colonne, densités
compact et avancé, feuille de détail ouverte) : largeurs de colonnes, hauteurs
de lignes, `scrollHeight`, positions collantes, décalages des colonnes
épinglées, tri, clic et navigation clavier **identiques au pixel près** — les
seuls écarts relevés sont le nom de la balise (`DIV` → `TABLE`) et la classe
`as-row` qui disparaît du `<tr>`.

Deux pièges rencontrés et corrigés au passage, tous deux dus au même mécanisme
(un `<td>` en `display: flex` cesse d'être une cellule de tableau et emporte son
`colSpan`) : le libellé du total et sa variante en ligne portent désormais leur
mise en page sur un `<span>` interne.

Effet de bord évité : le `<button>` que les lignes traversaient portait
`border: 0`, ce qui neutralisait silencieusement le `border-bottom` de
`.sch-row`. Le passage au `<tr>` faisait réapparaître un filet qui n'a jamais
fait partie du dessin ; il est explicitement remis à zéro.

## Constat par constat

| constat | correctif | vérification |
| --- | --- | --- |
| **P1** repli `@media print` inerte | Les règles papier vivent maintenant en fin de `app.css`, après les règles de base et de densité, avec `!important` là où une règle de densité est plus spécifique. Du coup `@media print` gagne seul : `is-printing` et l'écouteur `beforeprint` d'`App.tsx` sont supprimés, et l'impression ne dépend plus d'un évènement que certains moteurs ne déclenchent pas. | En media `print` sans aucune classe : `max-height: none`, `overflow: visible`, `min-width: 0`, en-tête `static`, cellules `4px 5.33px` / `11.33px`, vitesse visible, **38 lignes sur 38** au papier |
| **P2** densité vs papier | Dimensionnement papier en `!important` sur cellules, en-tête, total, pastille MTO/MTS, tuiles de stat ; `.sch-customer` masqué à l'impression. | compact / normal / avancé donnent maintenant **la même feuille** : cellules `4px 5.33px`, police `11.33px`, en-tête `10px`, total `12px`, **2 pages dans les trois cas** (contre 3 en avancé) |
| **P2** en-tête non répété | `<thead>` réel en `display: table-header-group`. | texte extrait page par page du PDF : l'en-tête de colonnes est présent sur **les deux pages**, aux trois densités |
| **P2** Article tronqué | `.sch-name` passe en `white-space: normal` à l'impression, et les colonnes de texte reçoivent une pondération papier propre (`COL_PRINT_WEIGHT`) au lieu du plancher du `minmax`. | **0 cellule tronquée sur 38** (contre 30/38), et 0 cellule débordante aux trois densités, en-têtes compris |
| **P2** impression depuis l'aperçu | Les règles de l'aperçu sont neutralisées sous `@media print`. | même géométrie que l'impression normale (`padding: 0`, `margin: 0`, ligne à 1084 px, hauteur 1169 px) et rendu **identique au pixel près** |
| **P3** fidélité de l'aperçu | Largeur fixe (`210mm` / `297mm`) au lieu de `max-width`, plus un filet en repère de fin de page. | fenêtre de 1600 px et de 900 px : ligne de **1084 px dans les deux cas**, 0 troncature — l'aperçu ne dépend plus de la taille de la fenêtre |
| **P3** pas de métadonnées | Ligne `print-only` sous l'en-tête : nombre de lignes, date d'import du rapport, tri actif. | `38 lignes · rapport importé le 31/07/2026 08:00 · tri : Format ↓` |
| **P3** filtrage muet | La même ligne porte les filtres actifs, en gras. | vue filtrée : `19 lignes · … · tri : Article ↑ · filtré : Qualité A2` |
| **P3** clic mort en aperçu | `pointer-events: none` sur les lignes en aperçu. | `pointerEvents: none` |
| **P4** dérive aperçu / impression | Les règles manquantes sont reportées dans le bloc aperçu : puces de flag (seule l'active), `grid-area` des colonnes d'évènement, et toute la mise en forme Production Test. | — |
| **P4** `grid-column` mort | Déclaration retirée ; le commentaire dit que la portée vient de `TotalRow`. | — |
| **P4** total sans libellé | Si toutes les colonnes visibles portent un total, le libellé partage la première cellule avec sa valeur. | colonnes réduites à Sched/Prod/Req/m² → `Total · 38 2798 741 2057 7 162,79` |
| **P4** `sortKey` non validé | `SORT_KEYS`, dérivé de `COLUMNS`, filtre ce qui vient de `localStorage`. | `sortKey: 'bogus'` en stock → retombe sur `longueur`, tri par dimension appliqué |
| **P4** `@page` portrait | Commentaire expliquant que la règle n'est qu'un défaut, réécrit par `#wb-page-size`. | — |
| **P4** en-têtes trop étroits | Pondérations papier pour MTO/MTS, Qualité et Format, et les libellés d'en-tête peuvent passer à la ligne plutôt que d'être coupés. | 0 en-tête débordant aux trois densités |

## Retours d'usage

Deux points remontés à l'essai, corrigés dans la foulée.

**Élargir une colonne comprimait toutes les autres à l'impression.** Les
pondérations papier laissaient passer les largeurs redimensionnées à l'écran.
Mesuré, Article tiré à 1100 px : MTO/MTS tombait de 82 à 50 pt, Qualité de 79 à
47 pt, m² de 79 à 47 pt, et **152 cellules débordaient** sur la feuille. Le
gabarit papier ignore désormais complètement `widths` et `autoWidths` : il ne
dépend plus que de `COL_PRINT_WEIGHT` et des colonnes visibles. Vérifié —
Article à 700 px puis à 1100 px donne exactement la même feuille qu'un tableau
jamais redimensionné, à toutes les colonnes près.

**L'aperçu quitte la roulette des paramètres** pour un bouton dédié dans
l'en-tête, à côté de l'aide et du réglage. Vérifier la mise en page papier est
un geste récurrent, pas une préférence à régler une fois. Le bouton est un
`aria-pressed` avec une icône d'imprimante dessinée en CSS — comme
`.sch-cols-icon`, les caractères d'imprimante ayant une couverture de police
inégale et la version emoji s'affichant en couleur. La sortie reste la barre
flottante. Vérifié à 1600 px et à 600 px, en thème clair et sombre ; la section
« Impression » a disparu du popover, qui ne porte plus que Thème et Densité.

**Second passage, sur captures réelles** (schedule 2213000219, 11 lignes) :

- *Élargir Article comprimait encore le papier* — la correction précédente
  n'excluait que les largeurs auto-gelées, pas celles glissées explicitement.
  Article à 1100 px : Qualité passait de 79 à 47 pt, 152 cellules en
  débordement. Le gabarit papier ne lit plus **aucune** largeur écran, seulement
  `COL_PRINT_WEIGHT`. Vérifié : gabarits strictement identiques avec et sans
  redimensionnement.
- *Marge avant le titre* — marges `@page` du schedule portées à 8 mm haut/bas
  (les côtés restent à 5 mm, le tableau a besoin de la largeur), plus 2 mm de
  marge de flux sur l'en-tête. Les pages suivantes en profitent aussi :
  l'en-tête de colonnes répété ne colle plus au bord.
- *Ligne méta intégrée* — le filet de clôture passe de `.sch-detail-head` à
  `.sch-print-meta` : titre, stats et ligne méta forment un seul bloc d'en-tête
  fermé par la règle, le tableau démarre dessous.
- *Bordures* — la bande d'en-tête de colonnes fusionnait avec la première bande
  de groupe (même gris, aucun filet) : elle est close par un filet 0.75 pt. Les
  séparateurs forts hérités de l'écran (ombres internes avant Qualité / PDP) ne
  continuaient pas dans le corps et lisaient comme des défauts : supprimés au
  papier. Filets 0.5 pt entre lignes de données et sous les étiquettes de
  groupe ; règle comptable 1 pt au-dessus du Total.
- *m² total tronqué* — le total (« 115 875,59 » sur le jeu reconstitué, qui
  s'arrondit à un centième du rapport réel) sortait « 115 875,… » : le 9 pt gras
  débordait la pondération héritée des cellules de données. Pondération m²
  88 → 100 ; plus aucune cellule tronquée aux trois densités.
- *Feuille d'aperçu* — elle s'étirait à la hauteur de la fenêtre
  (`min-height: 100dvh` de `.app` fuyait dans l'aperçu) et son repère de fin de
  page était calé à 180 mm au lieu de la vraie hauteur utile. La feuille fait
  désormais exactement une page physique (297 × 210 mm paysage, 210 × 297
  portrait) et le repère suit les marges réelles (194 mm / 287 mm). La
  prédiction du repère a été validée contre la pagination réelle de Chromium :
  les 22 lignes prédites en page 1 y sont toutes.

**Vérification adversariale du second passage** (trois relecteurs indépendants —
cascade CSS, QA visuelle sur captures, audit de régression) ; leurs trouvailles,
toutes corrigées :

- La carte d'en-tête gardait à l'impression son fond gris, ses coins arrondis et
  ses bordures latérales, dont le bas restait ouvert une fois le filet déplacé
  sous la ligne méta. Le chrome de carte est retiré au papier : l'en-tête est un
  en-tête de document — texte sur blanc, un seul filet de clôture.
- La règle au-dessus du Total, déclarée 1 pt, s'arrondissait au même pixel que
  les filets 0.5 pt et l'arbitrage `border-collapse` donnait alors l'arête à la
  couleur du filet du dessus : elle sortait indiscernable des lignes ordinaires.
  Passée à 1.5 pt (2 px), elle gagne l'arbitrage et se lit comme une vraie règle.
- Le dégradé du repère de fin de page peignait aussi sa queue dans le padding
  haut de la feuille d'aperçu (ligne parasite au-dessus du titre), et une
  feuille d'exactement une page peignait son propre repère collé au bord bas.
  `background-clip: content-box` et une hauteur raccourcie de 2 px règlent les
  deux ; un balayage pixel confirme zéro ligne parasite.
- Préexistant : avec une colonne épinglée, le séparateur `is-pinned-last`
  (1 px, plus spécifique) l'emportait sur le filet uniforme du papier dans le
  bloc `@media print` mais pas dans l'aperçu — divergence aperçu/papier.
  Restaté dans les deux blocs.
- Les décomptes de pages par densité manquaient à la suite : ajoutés — 11 lignes
  → 1 page, 38 lignes → 2 pages, aux trois densités, en-tête de colonnes présent
  sur chaque page de chaque PDF.
- Les deux PDF « impression normale » et « impression depuis l'aperçu » ne sont
  jamais identiques octet à octet (métadonnées de création) ; l'identité est
  établie sur le texte positionné : 190 éléments, positions au dixième de point
  près, strictement égaux.

**Retour direct de l'utilisateur** : il préférait la direction artistique
d'origine de l'en-tête à celle de la passe de polish — carte grise à coins
arrondis, sans filets horizontaux dans le corps du tableau ni au-dessus du
Total. Restaurée :

- L'en-tête (bandeau + titre + stats) garde son fond gris, ses coins arrondis
  et ses bordures latérales sur le papier ; la ligne méta (nombre de lignes,
  date d'import, tri) devient la **deuxième ligne de cette même carte**, avec
  le même bandeau et les mêmes rails, fermée par le filet 1 pt qui la sépare du
  tableau. C'est ce que montrait la capture d'origine, moins l'absence de la
  ligne méta.
- Suppression des filets horizontaux entre lignes de données, sous les
  étiquettes de groupe et au-dessus du Total, ajoutés par la passe précédente.
  La séparation redevient celle de la maquette d'origine : bandes teintées et
  filets verticaux de colonnes uniquement.
- Le filet fermant la bande d'en-tête de colonnes est retiré : les séparateurs
  de groupe hérités de l'écran (ombres internes avant Qualité / PDP)
  redeviennent visibles dans le corps, comme sur la capture d'origine.
- Seul survit de la passe précédente ce qui ne touchait pas au style visuel :
  marges `@page` 8 mm haut/bas, pondération papier de m² et retrait de la
  lecture des largeurs glissées à l'écran, feuille d'aperçu à une page
  physique exacte.

Revérifié après restauration : 38 lignes → 2 pages avec en-tête sur chaque
page aux trois densités, redimensionner Article sans effet sur le papier,
impression depuis l'aperçu strictement identique à l'impression normale,
aucune ligne parasite dans l'aperçu, et écran inchangé au pixel près.

**Troisième passage, quatre retours ciblés** sur le schedule 2213000514
(SGNRGAR, 4 lignes) :

- *Marge avant le titre* — 8 mm de marge `@page` plus 2 mm de marge de flux sur
  l'en-tête (14 mm de la révision précédente) restaient visuellement quasi
  invisibles : le titre en 17 pt gras occupait la respiration à lui seul. La
  marge de flux passe à 6 mm — la mesure confirme un vrai espace blanc de 14 mm
  avant le titre (8 + 6), plus perceptible qu'un simple padding technique.
- *« Format » renommé « Dimension »* partout où il est visible : le libellé de
  colonne, le titre de section dans la fiche de détail d'une ligne, et le tri
  qui en découle (« tri : Dimension ↓ » dans la ligne méta). La clé interne
  `format` est conservée pour ne pas invalider les préférences de colonnes déjà
  enregistrées.
- *Nombre de lignes retiré de la ligne méta* — redondant avec le total qui
  l'affiche déjà (« Total · 4 lignes »). La ligne méta ne porte plus que la
  date d'import, le tri actif et, le cas échéant, les filtres.
- *Bordure plus épaisse autour de Qualité* — un doublon entre le filet uniforme
  entre colonnes (0.5 pt, propre au papier) et le séparateur de groupe hérité
  de l'écran (ombre interne avant Qualité / Dimension) faisait ressortir cette
  frontière plus que les autres. Le séparateur de groupe est neutralisé au
  papier ; les filets uniformes suffisent à porter le rythme des colonnes.

Revérifié après ces quatre changements : 38 lignes → 2 pages avec en-tête sur
chaque page aux trois densités, redimensionner une colonne toujours sans effet
sur le papier, impression depuis l'aperçu toujours identique à l'impression
normale, aucune ligne parasite dans l'aperçu. Écran : deux différences
relevées, toutes deux attendues et vérifiées — le libellé « FORMAT » devenu
« DIMENSION » dans l'en-tête de colonne (densité avancée) et dans le titre de
section de la fiche de détail ; rien d'autre n'a bougé au pixel près.

## Limites connues

- L'aperçu ne peut pas montrer l'en-tête revenir à chaque saut de page : c'est un
  comportement de média paginé, qui n'existe pas sur un écran défilant. Il marque
  en revanche la fin de chaque feuille.
- Les lignes de données sont des `<tr tabindex="0">` et non plus des `<button>` :
  focusables, activables à Entrée / Espace et nommées par `aria-label`, mais une
  synthèse vocale ne les annonce plus comme boutons. C'est le compromis habituel
  d'une ligne de tableau cliquable, et la répétition de l'en-tête l'imposait.
- Tout a été mesuré sous Chromium. Le repli fragile ayant disparu, plus rien ne
  dépend de `beforeprint`, mais la répétition de `<thead>` et les sauts de page
  restent à confirmer sur un autre moteur.

---

# Second rendu papier — récap plaques (portrait)

Ajouté après cet audit, à côté du tableau détaillé et sans rien y changer.
La feuille détaillée répond à « qu'y a-t-il à produire, ligne par ligne » ; le
récap répond à la question posée devant les racks : « pour chaque dimension et
chaque épaisseur, combien de lites reste-t-il, et ai-je les plaques ». Il
regroupe donc les lignes de planning par qualité → dimension → épaisseur, et
laisse une colonne vide (`Plaques dispo.`) remplie au stylo.

Les trois niveaux restent dans la colonne de gauche, y compris la qualité quand
le schedule n'en a qu'une : remontée dans le titre, elle laisserait une feuille
dont les colonnes ne disent plus ce qu'elles qualifient. Seules les lignes
d'épaisseur portent un chiffre et une case à remplir — qualité et dimension
sont des intitulés, et tout ce qui se compte ou s'écrit ici appartient à une
dimension *et* à une épaisseur. Trois colonnes, donc, et un en-tête réduit au
schedule, à l'article et à la provenance du rapport, sur une seule ligne de
base.

Pas de grille complète : le rythme horizontal des lignes, et un seul filet
vertical devant chaque colonne de chiffres — celle qui se lit, celle qui
s'écrit. Le reste tenait de la copie de tableur. Les trois niveaux se
distinguent alors par trois textures plutôt que par trois gris : la qualité est
une bande soutenue précédée d'un filet fort, la dimension une bande légère qui
court sur toute la largeur, l'épaisseur une ligne blanche en retrait. Posée en
clair — filet et fond blanc — la qualité perdait contre les bandes de dimension
placées juste dessous ; inversée en noir elle prenait toute la feuille. Deux
crans de gris entre les deux niveaux suffisent. Le total ferme la feuille sur un filet et non sur une
quatrième bande grise.

## Choix de mise en œuvre

- **Les deux rendus sont montés en même temps.** L'écran garde son tableau —
  c'est l'outil de travail, et le récap n'a rien à y faire : il porte une
  colonne que personne ne peut remplir sur un écran. `ScheduleRecap` est
  `print-only` ; le CSS papier masque le tableau quand `.sch.is-print-recap`.
- **`@page` garde une source unique.** L'orientation reste décidée par le seul
  élément `wb-page-size` d'`App.tsx` — d'où l'état `schedPrintMode` hébergé
  dans `App` plutôt que dans `Schedules`. Deux composants réécrivant `@page`
  auraient reproduit exactement la fragilité que le reste de ce document
  documente. Portrait, marges 10 mm / 8 mm : la feuille est tenue et écrite,
  pas seulement lue.
- **Un seul jeu de règles CSS**, contrairement à la section `.sch-*` qui doit
  être écrite deux fois. Le namespace `.sch-recap-*` est neuf et n'a aucune
  règle écran à écraser : `print-only` suffit à le tenir hors de l'écran, et
  l'aperçu comme le papier définissent les mêmes tokens `--print-*`. Ni
  duplication ni `!important`.
- **Bascule dans l'aperçu, et là seulement.** Le sélecteur `Détail | Récap`
  vit dans la barre d'aperçu d'impression. Choisir sa feuille est une décision
  de papier : elle a sa place au dernier arrêt avant la boîte d'impression, pas
  dans la barre d'outils du tableau, qui n'imprime rien. Le choix est persisté
  (`wb.sched.printMode`) : qui imprime le récap chaque matin ne le réarme pas
  chaque matin.
- **Les chiffres viennent de `visibleRows`**, les lignes que compte déjà la
  ligne Total du tableau : mêmes filtres, mêmes exclusions (échantillons QC,
  lignes terminées). Les deux feuilles ne peuvent donc pas se contredire, et
  les filtres actifs sont rappelés en tête de récap comme sur l'autre feuille.
- **Une ligne sans épaisseur décodée** n'est pas perdue : elle tombe dans un
  bucket « ép. n. c. » en fin de groupe, qui nomme le trou au lieu de le
  cacher dans une épaisseur réelle.

## Vérifié (Chromium, même harnais)

`<thead>` répété sur chacune des 4 pages d'un récap de 24 dimensions, aucun
groupe dimension coupé en deux (un `<tbody>` par dimension, `break-inside:
avoid`), total imprimé une seule fois en fin de document (`tfoot` remis en
`table-row-group` — en groupe de pied il se serait répété à chaque page et lu
comme un sous-total). Total récap = total `Req` du tableau détaillé à filtres
identiques (637 lites, 11 164 m² sur le jeu de test). Aller-retour entre les
deux modes : orientation, largeur de feuille d'aperçu et contenu suivent, sans
trace de l'autre rendu. Écran inchangé dans les deux modes.

## Limites connues

- Le récap ne couvre que le schedule sélectionné, comme la feuille détaillée.
  Préparer les plaques de plusieurs schedules demande autant d'impressions.
- Mesuré sous Chromium uniquement, comme le reste de ce document.
