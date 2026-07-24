-- PMS230 schedule report — singleton like `suivi` and `policy`. Stores the
-- parsed report (records, schedules, totals, importedAt) as JSON. Subject to
-- the user's local/sync mode toggle on the front (no alwaysSync flag).
CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
