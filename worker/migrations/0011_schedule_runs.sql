-- Le compte-rendu de chaque exécution de l'extension (2.9.0+) : ce que la
-- lecture a fait, à côté de ce qu'elle a lu (schedule_raw). Pages lues,
-- attentes page par page, pages refusées, grille remise en page 1, nettoyage
-- fait ou non et pourquoi, MO retirés ou laissés, version de l'extension.
-- Tel que l'extension l'a vu, en JSON ; rien n'est effacé.
CREATE TABLE IF NOT EXISTS schedule_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,     -- reçu par le serveur, ms
  version TEXT,            -- de l'extension
  trigger TEXT,            -- auto, button, prepare, scrape
  kind TEXT,               -- ok, warn, err : le verdict affiché
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedule_runs_at ON schedule_runs (at);
