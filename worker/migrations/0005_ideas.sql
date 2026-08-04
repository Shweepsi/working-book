-- Boîte à idées — singleton like `suivi` and `policy`. Holds the whole shared
-- board (each idea, its author and the +1s it collected) as JSON. One row,
-- rewritten wholesale on every PUT like the other partitions: the board is a
-- handful of short entries, so there is nothing to gain from a row per idea.
CREATE TABLE IF NOT EXISTS ideas (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
