# Extraction de la planning policy

Comment récupérer la table **Item number → planning policy** depuis M3 (MMS002)
et la charger dans Working Book, pour que la colonne MTO/MTS du Planning soit
renseignée.

À refaire quand des produits sont créés, retirés du catalogue, ou passent de
MTO à MTS. La table est partagée : un seul opérateur l'importe, tous les postes
la reçoivent.

## 1. Extraire depuis M3

1. Ouvrir le programme **MMS002** (sorting order).
2. Filtrer :

   | Champ         | Valeur |
   | ------------- | ------ |
   | `WH`          | `221`  |
   | `Item number` | `33*`  |

   Ça donne la liste de tous les items de verre à bascharage.
3. Exporter : **Tools → Export to Excel**, puis cocher l'option
   **Export all rows**.

   Sans cette option, seules les lignes affichées à l'écran sortent — la table
   est tronquée sans prévenir.
4. Dans le tableau Excel obtenu, filtrer manuellement les produits coater à
   l'aide de la colonne **Name**.

## 2. La colonne PP

C'est le code de planning policy. Trois valeurs :

| Code | Sens                                    |
| ---- | --------------------------------------- |
| `10` | MTO — *make to order*                   |
| `50` | MTS — *make to stock*                   |
| `90` | Inactif — le produit n'est plus actif   |

## 3. Importer dans Working Book

1. Onglet **Planning** → bouton **Importer rapport Operator Mashup**.
2. Dans l'en-tête de la feuille, cliquer le bouton **⚙ Politique MTO/MTS**.
3. Sélectionner dans Excel les trois colonnes **Item number**, **Name** et
   **Pp** (en-tête compris, il est ignoré), copier, coller dans la zone.
4. Vérifier la ligne verte : `✓ N produits chargés`. S'il y a des
   avertissements, les déplier avant d'importer — chaque ligne rejetée y est
   listée avec sa raison.
5. **Importer**.

La table **remplace** la précédente et part immédiatement vers les autres
postes. Le compteur `⚙ MTO/MTS · N` en haut de l'écran confirme ce qui est
chargé. En cas de fausse manœuvre, le bandeau qui apparaît propose *Annuler*
quelques secondes.

## Ce que le parseur accepte

- Les colonnes dans l'ordre **Item number, Name, policy** — les colonnes
  au-delà de la troisième sont ignorées.
- L'en-tête `Pp` ou `Planning policy`, ou pas d'en-tête du tout.
- La policy en code (`10` / `50` / `90`) **ou** en libellé (`MTO` / `MTS` /
  `Inactif`), sans distinction de casse.
- Un code produit à 9 chiffres commençant par `33`. Toute autre valeur en
  première colonne fait rejeter la ligne, avec un avertissement.

En cas de doublon sur un même produit, la première ligne gagne. Un
avertissement n'est levé que si les deux lignes se contredisent ; un doublon
identique passe en silence.

## Dans le tableau Planning

La colonne **MTO/MTS** affiche :

| Pastille  | Sens                                            |
| --------- | ----------------------------------------------- |
| `MTO`     | code 10                                         |
| `MTS`     | code 50                                         |
| `✕`       | code 90 — produit sorti du catalogue            |
| `?`       | produit absent de la table importée             |

Un `?` sur beaucoup de lignes veut dire que l'extraction ne couvre pas les
produits du schedule en cours : reprendre à l'étape 1 en vérifiant le filtre
`Item number` et l'option **Export all rows**.
