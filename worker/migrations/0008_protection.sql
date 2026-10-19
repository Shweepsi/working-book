-- Protection plates (« plaques de protection ») used by a shift: not rejects,
-- reported to the supervisor in the shift's bilan. One row per (date, poste),
-- the shift's lines as JSON ({ lines: [{ id, longueur, epaisseur, nombre }], comment }),
-- last write wins like the logbook.
CREATE TABLE IF NOT EXISTS protection_plates (
  date TEXT NOT NULL,
  poste TEXT NOT NULL,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (date, poste)
);
