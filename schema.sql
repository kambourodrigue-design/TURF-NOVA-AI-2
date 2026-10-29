-- Nafora — schéma D1 v5 (NOUVELLE installation uniquement).
-- Si votre base existe déjà (version précédente), exécutez plutôt migration-v3.sql, migration-v4.sql puis migration-v5.sql.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE,
  phone         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'merchant',      -- 'admin' (plateforme) ou 'merchant'
  status        TEXT NOT NULL DEFAULT 'active',        -- 'active' ou 'suspended'
  shop_id       TEXT NOT NULL,
  shop_role     TEXT NOT NULL DEFAULT 'owner',         -- 'owner', 'manager' ou 'cashier'
  created_at    TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_shop ON users(shop_id);

CREATE TABLE IF NOT EXISTS shops (
  shop_id    TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  settings   TEXT NOT NULL,
  seq        INTEGER NOT NULL DEFAULT 0,               -- compteur de modifications de la boutique
  shop_name  TEXT,
  category   TEXT,
  city       TEXT,
  country    TEXT,
  formalized INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_shops_category ON shops(category);

-- Un enregistrement = une vente, un produit, un client, une dépense, un fournisseur ou les paramètres.
CREATE TABLE IF NOT EXISTS records (
  shop_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  id         TEXT NOT NULL,
  json       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,                         -- millisecondes
  deleted    INTEGER NOT NULL DEFAULT 0,
  seq        INTEGER NOT NULL,
  PRIMARY KEY (shop_id, kind, id)
);
CREATE INDEX IF NOT EXISTS idx_records_seq ON records(shop_id, seq);

-- Statistiques précalculées (mises à jour à chaque envoi, jamais recalculées en lisant les ventes)
CREATE TABLE IF NOT EXISTS shop_daily (
  shop_id     TEXT NOT NULL,
  day         TEXT NOT NULL,                           -- AAAA-MM-JJ
  sales_count INTEGER NOT NULL DEFAULT 0,
  revenue     REAL NOT NULL DEFAULT 0,
  profit      REAL NOT NULL DEFAULT 0,
  expenses    REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_id, day)
);
CREATE INDEX IF NOT EXISTS idx_daily_day ON shop_daily(day);

CREATE TABLE IF NOT EXISTS shop_stats (
  shop_id        TEXT PRIMARY KEY,
  sales_count    INTEGER NOT NULL DEFAULT 0,
  revenue_total  REAL NOT NULL DEFAULT 0,
  profit_total   REAL NOT NULL DEFAULT 0,
  expenses_total REAL NOT NULL DEFAULT 0,
  last_activity  TEXT
);

-- Journal des lots reçus : un lot renvoyé après une coupure réseau n'est jamais appliqué deux fois.
CREATE TABLE IF NOT EXISTS push_log (
  batch_id   TEXT PRIMARY KEY,
  shop_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  response   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_log_created ON push_log(created_at);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  key          TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reset_requests (
  user_id    TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

-- v4 : statistiques du site, messages, réglages
CREATE TABLE IF NOT EXISTS site_daily (
  day    TEXT PRIMARY KEY,
  visits INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS announcements (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  audience   TEXT NOT NULL DEFAULT 'all',
  level      TEXT NOT NULL DEFAULT 'info',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ann_created ON announcements(created_at);

CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- v5 : surveillance et facturation
CREATE TABLE IF NOT EXISTS error_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT NOT NULL,
  source  TEXT NOT NULL,           -- 'server' ou 'client'
  route   TEXT,
  status  INTEGER,
  message TEXT NOT NULL,
  sig     TEXT NOT NULL,           -- signature pour regrouper les erreurs identiques
  shop_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_error_ts ON error_log(ts);

CREATE TABLE IF NOT EXISTS payments (
  id         TEXT PRIMARY KEY,
  shop_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  user_name  TEXT,
  phone      TEXT,
  amount     INTEGER NOT NULL,
  months     INTEGER NOT NULL,
  method     TEXT NOT NULL,
  reference  TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  created_at TEXT NOT NULL,
  decided_at TEXT,
  note       TEXT
);
CREATE INDEX IF NOT EXISTS idx_pay_status ON payments(status, created_at);
CREATE INDEX IF NOT EXISTS idx_pay_shop ON payments(shop_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  shop_id    TEXT PRIMARY KEY,
  paid_until TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

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

-- v8 : photos des produits (catalogue en ligne)
CREATE TABLE IF NOT EXISTS product_images (
  shop_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  mime TEXT NOT NULL,
  data TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (shop_id, product_id)
);
