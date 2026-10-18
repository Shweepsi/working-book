-- The line's own input, without a spreadsheet (Loading and Unloading tabs):
-- per (date, poste) a set of records — the shift's colours, the jumbos loaded,
-- the racks unloaded, the scraps — each one written whole, last write wins per
-- record. `v` is the record's JSON, NULL once deleted (kept, so that every
-- device hears of the deletion). `seq` orders every write within the shift:
-- clients poll for `seq > n`, like the shared workbooks' cells.
CREATE TABLE IF NOT EXISTS line_records (
  date TEXT NOT NULL,
  poste TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  v TEXT,
  seq INTEGER NOT NULL,
  client TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (date, poste, id)
);

CREATE INDEX IF NOT EXISTS line_records_by_seq ON line_records (date, poste, seq);
