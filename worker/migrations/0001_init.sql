-- Logbook events, partitioned by (date, poste). The `events_json` column holds
-- the LogEvent[] array as JSON; the front replaces it wholesale on each PUT.
CREATE TABLE IF NOT EXISTS log_events (
  date TEXT NOT NULL,
  poste TEXT NOT NULL,
  events_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (date, poste)
);

-- Production tests, partitioned by (date, shift_key). Holds the full TestState
-- (tests array + activeId) as JSON.
CREATE TABLE IF NOT EXISTS production_tests (
  date TEXT NOT NULL,
  shift_key TEXT NOT NULL,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (date, shift_key)
);

-- Suivi is global (single row). The CHECK enforces the singleton invariant.
CREATE TABLE IF NOT EXISTS suivi (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
