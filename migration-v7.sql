CREATE TABLE IF NOT EXISTS feedback (
  id         TEXT PRIMARY KEY,
  shop_id    TEXT NOT NULL UNIQUE,
  user_id    TEXT NOT NULL,
  name       TEXT,
  shop_label TEXT,
  city       TEXT,
  rating     INTEGER NOT NULL,
  text       TEXT NOT NULL,
  consent    INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, created_at);
