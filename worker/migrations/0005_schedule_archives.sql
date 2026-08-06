-- Schedules retirés du planning — singleton like `schedules` and
-- `schedule_speeds`. Holds a `{ [scheduleNumber]: ISO date }` map as JSON: the
-- rail gesture no longer drops a schedule from the report, it files it under
-- "terminés", and that decision belongs to the line rather than to the tablet
-- that made it. Kept out of the `schedules` blob for the same reason the speeds
-- are: that partition is rewritten wholesale by the bookmarklet ingest, and a
-- client PUTing its copy of the report just to retire one schedule would race
-- the import.
CREATE TABLE IF NOT EXISTS schedule_archives (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
