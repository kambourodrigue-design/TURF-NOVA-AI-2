-- À exécuter UNE FOIS dans la Console D1 si la base existe déjà (mise à jour v2)
CREATE TABLE IF NOT EXISTS reset_requests (
  user_id    TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
