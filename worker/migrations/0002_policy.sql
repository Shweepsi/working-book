-- MTO/MTS policy table — singleton like `suivi`. Holds the parsed Item-number
-- → Planning-policy lookup as JSON. Always synced regardless of the front's
-- "local-only" toggle so every client shares the same MTO/MTS classification.
CREATE TABLE IF NOT EXISTS policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
