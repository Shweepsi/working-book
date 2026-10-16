-- The Suivi assistant's workshop vocabulary (worker/src/lexicon.ts): rules it
-- proposes from what the operators ask it to remember or correct ("chariot =
-- Frame"), which it uses only once someone validated them. A rejected rule
-- stays, so the same one isn't proposed again.
CREATE TABLE IF NOT EXISTS assist_lexicon (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule TEXT NOT NULL,
  -- The operator's request it came from (empty for a rule added by hand).
  source TEXT NOT NULL DEFAULT '',
  -- pending | active | rejected
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE INDEX IF NOT EXISTS assist_lexicon_by_status ON assist_lexicon (status, id);
