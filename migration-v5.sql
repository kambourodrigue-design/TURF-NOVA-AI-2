CREATE TABLE IF NOT EXISTS error_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, source TEXT NOT NULL, route TEXT, status INTEGER, message TEXT NOT NULL, sig TEXT NOT NULL, shop_id TEXT);
CREATE INDEX IF NOT EXISTS idx_error_ts ON error_log(ts);
CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, shop_id TEXT NOT NULL, user_id TEXT NOT NULL, user_name TEXT, phone TEXT, amount INTEGER NOT NULL, months INTEGER NOT NULL, method TEXT NOT NULL, reference TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, decided_at TEXT, note TEXT);
CREATE INDEX IF NOT EXISTS idx_pay_status ON payments(status, created_at);
CREATE INDEX IF NOT EXISTS idx_pay_shop ON payments(shop_id);
CREATE TABLE IF NOT EXISTS subscriptions (shop_id TEXT PRIMARY KEY, paid_until TEXT NOT NULL, updated_at TEXT NOT NULL);
