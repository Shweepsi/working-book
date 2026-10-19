# Working Book — consignes

## Version

Toute mise en prod (PR vers `main` qui change ce que voit l'utilisateur) monte
la version affichée sous Réglages, dans le même PR :

- `npm version <x.y.z> --no-git-tag-version` (met à jour `package.json` et
  `package-lock.json`) ;
- mineure (0.3.0 → 0.4.0) pour une nouveauté, correctif (0.3.0 → 0.3.1) pour
  une correction ou un ajustement d'affichage.
