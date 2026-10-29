-- Nafora — MIGRATION v2 → v3 (à exécuter UNE SEULE FOIS dans la Console D1,
-- AVANT de mettre en ligne la nouvelle version du site).
-- Vos comptes et toutes vos données actuelles sont conservés.
-- Si une ligne affiche « duplicate column name », cette partie est déjà faite : passez à la suite.

-- 1. Nouvelles colonnes
ALTER TABLE users ADD COLUMN shop_role TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE shops ADD COLUMN seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shops ADD COLUMN shop_name TEXT;
ALTER TABLE shops ADD COLUMN category TEXT;
ALTER TABLE shops ADD COLUMN city TEXT;
ALTER TABLE shops ADD COLUMN country TEXT;
ALTER TABLE shops ADD COLUMN formalized INTEGER NOT NULL DEFAULT 0;

-- 2. Nouvelles tables
CREATE TABLE IF NOT EXISTS records (
  shop_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL,
  updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL,
  PRIMARY KEY (shop_id, kind, id)
);
CREATE INDEX IF NOT EXISTS idx_records_seq ON records(shop_id, seq);
CREATE INDEX IF NOT EXISTS idx_users_shop ON users(shop_id);
CREATE INDEX IF NOT EXISTS idx_shops_category ON shops(category);

CREATE TABLE IF NOT EXISTS shop_daily (
  shop_id TEXT NOT NULL, day TEXT NOT NULL, sales_count INTEGER NOT NULL DEFAULT 0,
  revenue REAL NOT NULL DEFAULT 0, profit REAL NOT NULL DEFAULT 0, expenses REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_id, day)
);
CREATE INDEX IF NOT EXISTS idx_daily_day ON shop_daily(day);

CREATE TABLE IF NOT EXISTS shop_stats (
  shop_id TEXT PRIMARY KEY, sales_count INTEGER NOT NULL DEFAULT 0, revenue_total REAL NOT NULL DEFAULT 0,
  profit_total REAL NOT NULL DEFAULT 0, expenses_total REAL NOT NULL DEFAULT 0, last_activity TEXT
);

CREATE TABLE IF NOT EXISTS push_log (
  batch_id TEXT PRIMARY KEY, shop_id TEXT NOT NULL, created_at INTEGER NOT NULL, response TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_log_created ON push_log(created_at);

-- 3. Reprise des données : un enregistrement par vente / produit / client / dépense / fournisseur
INSERT OR IGNORE INTO records (shop_id, kind, id, json, updated_at, deleted, seq)
SELECT shop_id, kind, rid, js, t, 0, ROW_NUMBER() OVER (PARTITION BY shop_id ORDER BY kind, rid)
FROM (
  SELECT d.shop_id AS shop_id, d.key AS kind, json_extract(j.value, '$.id') AS rid, j.value AS js,
         COALESCE(CAST(strftime('%s', d.updated_at) AS INTEGER), 1) * 1000 AS t
  FROM shop_data d, json_each(d.json) AS j
  WHERE json_extract(j.value, '$.id') IS NOT NULL
);

-- 4. Paramètres de chaque boutique
INSERT OR IGNORE INTO records (shop_id, kind, id, json, updated_at, deleted, seq)
SELECT s.shop_id, 'settings', 'main', s.settings, 1, 0,
       COALESCE((SELECT MAX(r.seq) FROM records r WHERE r.shop_id = s.shop_id), 0) + 1
FROM shops s;

UPDATE shops SET
  seq        = COALESCE((SELECT MAX(r.seq) FROM records r WHERE r.shop_id = shops.shop_id), 1),
  shop_name  = json_extract(settings, '$.shopName'),
  category   = json_extract(settings, '$.businessCategory'),
  city       = json_extract(settings, '$.city'),
  country    = json_extract(settings, '$.country'),
  formalized = CASE WHEN json_extract(settings, '$.isFormalized') THEN 1 ELSE 0 END;

-- 5. Statistiques précalculées à partir des données existantes
DELETE FROM shop_daily;
INSERT INTO shop_daily (shop_id, day, sales_count, revenue, profit, expenses)
SELECT shop_id, day, SUM(sc), SUM(rev), SUM(pr), SUM(ex) FROM (
  SELECT shop_id, substr(json_extract(json, '$.date'), 1, 10) AS day, 1 AS sc,
         COALESCE(json_extract(json, '$.total'), 0) AS rev, COALESCE(json_extract(json, '$.profit'), 0) AS pr, 0 AS ex
  FROM records
  WHERE kind = 'sales' AND deleted = 0 AND COALESCE(json_extract(json, '$.status'), 'completed') = 'completed'
  UNION ALL
  SELECT shop_id, substr(json_extract(json, '$.date'), 1, 10), 0, 0, 0, COALESCE(json_extract(json, '$.amount'), 0)
  FROM records WHERE kind = 'expenses' AND deleted = 0
)
WHERE day IS NOT NULL AND length(day) = 10
GROUP BY shop_id, day;

DELETE FROM shop_stats;
INSERT INTO shop_stats (shop_id, sales_count, revenue_total, profit_total, expenses_total, last_activity)
SELECT shop_id, SUM(sales_count), SUM(revenue), SUM(profit), SUM(expenses), MAX(day)
FROM shop_daily GROUP BY shop_id;

-- (L'ancienne table shop_data n'est plus utilisée ; vous pourrez la supprimer plus tard
--  avec : DROP TABLE shop_data; une fois que tout fonctionne.)
