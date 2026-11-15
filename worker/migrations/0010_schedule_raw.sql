-- Le texte brut de chaque page de PMS230 reçue de l'extension, pour rejouer le
-- décodeur sur la vraie lecture : sans lui, un problème de décodage se
-- diagnostique sur un rapport envoyé à la main.
-- Une page identique à une page déjà gardée n'est pas gardée deux fois : sa
-- date de dernière vue avance, et seule une page qui change ajoute une ligne.
-- Rien n'est effacé : l'historique du rapport est la matière du prochain diagnostic.
CREATE TABLE IF NOT EXISTS schedule_raw (
  hash TEXT PRIMARY KEY,           -- SHA-256 du texte
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  seen INTEGER NOT NULL DEFAULT 1, -- combien de fois cette page est revenue
  records INTEGER NOT NULL,        -- lignes lues
  dropped INTEGER NOT NULL DEFAULT 0,
  lost TEXT,                       -- cellules brutes des lignes ignorées, JSON
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedule_raw_last ON schedule_raw (last_at);
