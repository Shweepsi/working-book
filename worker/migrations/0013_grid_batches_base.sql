-- Remplace grid_batches (0012, jamais en production) : au lieu de recopier les
-- seq rendus, on garde le plus grand seq du poste avant le lot. Les seq d'un lot
-- se suivent (une transaction, chaque écriture prend MAX+1) : un renvoi les
-- recalcule à partir de là, et l'enregistrement du lot est écrit dans la même
-- transaction que les cellules — deux envois du même lot ne peuvent pas passer
-- tous les deux.
DROP TABLE IF EXISTS grid_batches;
CREATE TABLE IF NOT EXISTS grid_batches (
  client TEXT NOT NULL,
  batch TEXT NOT NULL,
  date TEXT NOT NULL,
  poste TEXT NOT NULL,
  base INTEGER NOT NULL,   -- MAX(seq) du poste juste avant ce lot
  created_at INTEGER NOT NULL,
  PRIMARY KEY (client, batch)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS grid_batches_by_age ON grid_batches (created_at);
