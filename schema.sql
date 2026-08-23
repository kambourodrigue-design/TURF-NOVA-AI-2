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

-- Abonnements aux notifications push (Web Push). Un navigateur = une ligne ;
-- `endpoint` est unique par navigateur/appareil (fourni par le PushManager du
-- navigateur), pas par utilisateur — un même compte peut avoir plusieurs
-- abonnements (téléphone + ordinateur).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS resultats_verifies (
  prediction_id INTEGER PRIMARY KEY,
  podium_reel TEXT,
  chevaux_corrects INTEGER,
  coups_surs_reussis INTEGER,
  verified_at INTEGER NOT NULL,
  FOREIGN KEY(prediction_id) REFERENCES predictions(id)
);

-- Une ligne par cheval par course : les données brutes utilisées pour le pronostic,
-- + le résultat réel une fois la course terminée. Sert de base d'entraînement
-- pour un futur modèle de machine learning (pas utilisée par le pronostic actuel).
CREATE TABLE IF NOT EXISTS courses_features (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  reunion TEXT NOT NULL,
  course TEXT NOT NULL,
  num_pmu INTEGER NOT NULL,
  cheval TEXT,
  hippodrome TEXT,
  discipline TEXT,
  distance INTEGER,
  cote REAL,
  musique TEXT,
  corde INTEGER,
  poids INTEGER,
  driver TEXT,
  age INTEGER,
  sexe TEXT,
  oeilleres TEXT,
  gains_carriere INTEGER,
  coup_sur INTEGER NOT NULL DEFAULT 0,
  position_reelle INTEGER,       -- rempli après course : rang d'arrivée, NULL si pas encore courue
  top4_reel INTEGER,             -- 1 si terminé dans les 4 premiers, 0 sinon, NULL si pas encore courue
  created_at INTEGER NOT NULL,
  UNIQUE(date, reunion, course, num_pmu)
);

CREATE INDEX IF NOT EXISTS idx_courses_features_date ON courses_features(date);

CREATE TABLE IF NOT EXISTS subscriptions (
  email TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'gratuit',
  status TEXT NOT NULL DEFAULT 'active',
  started_at INTEGER NOT NULL,
  expires_at INTEGER,
  reminder_sent INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  titre TEXT NOT NULL,
  extrait TEXT,
  mots_cles TEXT,
  contenu TEXT NOT NULL,
  image_url TEXT,
  statut TEXT NOT NULL DEFAULT 'brouillon', -- 'brouillon' | 'publie'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER
);

CREATE TABLE IF NOT EXISTS page_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,              -- format AAAA-MM-JJ, ex: 2026-08-11
  visitor_hash TEXT NOT NULL,     -- empreinte anonymisée (IP + navigateur hashés), pas de donnée personnelle stockée
  path TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_page_views_day ON page_views(day);
CREATE INDEX IF NOT EXISTS idx_page_views_visitor ON page_views(visitor_hash);

-- Si ta base D1 existe déjà (table subscriptions déjà créée avant l'ajout des emails),
-- exécute cette ligne une fois pour ajouter la colonne manquante :
-- ALTER TABLE subscriptions ADD COLUMN reminder_sent INTEGER NOT NULL DEFAULT 0;
