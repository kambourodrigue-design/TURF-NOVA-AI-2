-- schema.sql — à exécuter une fois dans la base D1 turf-nova-db

CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  reunion TEXT NOT NULL,
  course TEXT NOT NULL,
  hippodrome TEXT,
  quarte6 TEXT NOT NULL,
  coups_surs TEXT,
  confiance INTEGER,
  sources TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(date, reunion, course)
);

CREATE TABLE IF NOT EXISTS resultats_verifies (
  prediction_id INTEGER PRIMARY KEY,
  podium_reel TEXT,
  chevaux_corrects INTEGER,
  coups_surs_reussis INTEGER,
  verified_at INTEGER NOT NULL,
  FOREIGN KEY(prediction_id) REFERENCES predictions(id)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  email TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'gratuit',
  status TEXT NOT NULL DEFAULT 'active',
  started_at INTEGER NOT NULL,
  expires_at INTEGER
);
