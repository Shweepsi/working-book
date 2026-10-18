-- GridCraft shared workbooks. A workbook is an uploaded .xlsx template plus the
-- cells edited on top of it, one workbook per (date, poste) like the logbook.

-- Uploaded templates, immutable once stored. The newest is the one new
-- workbooks start from; replacing the template is uploading a new row.
CREATE TABLE IF NOT EXISTS grid_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  bytes BLOB NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- The template a (date, poste) workbook was started from. Pinned on first
-- open, so uploading a new template never reshuffles a shift already filled in.
CREATE TABLE IF NOT EXISTS grid_docs (
  date TEXT NOT NULL,
  poste TEXT NOT NULL,
  template_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (date, poste)
);

-- Edited cells, last write wins per cell. `content` is GridCraft's cell
-- content JSON ({f, a, v, s}) or NULL for a cell emptied on top of the
-- template. `seq` orders every write within its workbook: clients poll for
-- `seq > n` and so never miss a write, whichever isolate stamped it.
CREATE TABLE IF NOT EXISTS grid_cells (
  date TEXT NOT NULL,
  poste TEXT NOT NULL,
  sheet TEXT NOT NULL,
  cell TEXT NOT NULL,
  content TEXT,
  seq INTEGER NOT NULL,
  client TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (date, poste, sheet, cell)
);

CREATE INDEX IF NOT EXISTS grid_cells_by_seq ON grid_cells (date, poste, seq);
