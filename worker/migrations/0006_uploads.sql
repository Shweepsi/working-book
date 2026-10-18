-- Fichiers envoyés à Claude depuis l'appli (Réglages → Envoyer à Claude).
-- A row in `uploads` per file, its bytes cut into `upload_chunks`: D1 refuses
-- a value over 2 000 000 bytes, and a logbook .xlsm runs past that. The
-- metadata row is written last, so a file only lists once all of it is stored.
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL,
  note TEXT,
  chunks INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS upload_chunks (
  upload_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (upload_id, seq)
);

-- Key for reading a file's bytes back. Everything else in this API is open,
-- but these are whole files, not a line's figures. Drawn here, once per
-- database, so the value never sits in the repo; Claude reads it through its
-- authenticated D1 access and sends it as a Bearer token.
CREATE TABLE IF NOT EXISTS upload_access (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  token TEXT NOT NULL
);
INSERT OR IGNORE INTO upload_access (id, token) VALUES (1, lower(hex(randomblob(32))));
