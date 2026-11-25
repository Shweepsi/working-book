-- Anonymous, aggregated counters of how the interface is used (no user, no shift,
-- no device id): one row per (day, feature, event, kind of device), `n` events.
-- First use: which way the bilan's table is read (defects as rows or as columns).
CREATE TABLE IF NOT EXISTS ui_stats (
  day TEXT NOT NULL,
  feature TEXT NOT NULL,
  event TEXT NOT NULL,
  device TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, feature, event, device)
);
