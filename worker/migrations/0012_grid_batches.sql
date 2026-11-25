-- Les lots d'écriture du classeur Suivi déjà reçus (POST /api/grid/doc).
-- Un appareil dont la réponse s'est perdue renvoie le même lot : le Worker le
-- reconnaît (client + identifiant de lot) et redonne les mêmes seq au lieu de
-- réécrire les cellules, ce qui écraserait la valeur qu'un collègue a mise
-- entre-temps. Purgé après 7 jours à chaque nouvelle écriture.
CREATE TABLE IF NOT EXISTS grid_batches (
  client TEXT NOT NULL,
  batch TEXT NOT NULL,
  date TEXT NOT NULL,
  poste TEXT NOT NULL,
  seqs TEXT NOT NULL,      -- JSON : un seq par cellule du lot, null = refusée
  created_at INTEGER NOT NULL,
  PRIMARY KEY (client, batch)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS grid_batches_by_age ON grid_batches (created_at);
