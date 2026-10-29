CREATE TABLE IF NOT EXISTS site_daily ( day TEXT PRIMARY KEY, visits INTEGER NOT NULL DEFAULT 0 );
CREATE TABLE IF NOT EXISTS announcements ( id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, audience TEXT NOT NULL DEFAULT 'all', level TEXT NOT NULL DEFAULT 'info', created_at TEXT NOT NULL, expires_at TEXT NOT NULL );
CREATE INDEX IF NOT EXISTS idx_ann_created ON announcements(created_at);
CREATE TABLE IF NOT EXISTS announcement_reads ( announcement_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (announcement_id, user_id) );
CREATE TABLE IF NOT EXISTS app_settings ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
