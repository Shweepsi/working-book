-- Coater speed per schedule — singleton like `suivi`, `policy` and `schedules`.
-- Holds a `{ [scheduleNumber]: m/min }` map as JSON: the speed belongs to the
-- schedule, not to the operator who typed it, so every client reads the same
-- value. Kept out of the `schedules` blob on purpose — that partition is
-- rewritten wholesale by the bookmarklet ingest, and a client PUTing its copy
-- of the report just to record a speed would race the import.
CREATE TABLE IF NOT EXISTS schedule_speeds (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
