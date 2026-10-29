// v4 : statistiques du site (admin), messages aux utilisateurs.

import { json, fail, readBody, randomHex, shopRoleOf, type Env, type UserRow } from './util';

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const clean = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ').trim().slice(0, max);

/* ---------- Visites (public, sans cookie ni donnée personnelle) ---------- */
export async function hit(env: Env) {
  await env.DB.prepare(
    `INSERT INTO site_daily (day, visits) VALUES (?1, 1) ON CONFLICT(day) DO UPDATE SET visits = visits + 1`)
    .bind(today()).run();
  return json({ ok: true });
}

/* ---------- Statistiques de la plateforme (admin) ---------- */
export async function adminStats(env: Env) {
  const d30 = daysAgo(29), d7 = daysAgo(6), iso30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const owner = "role = 'merchant' AND COALESCE(shop_role,'owner') = 'owner'";
  const [tot, team, sh, signups, act, vis, cats, countries, active7, ai] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(status='suspended'),0) AS suspended FROM users WHERE ${owner}`),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'merchant' AND COALESCE(shop_role,'owner') <> 'owner'`),
    env.DB.prepare(`SELECT COALESCE(SUM(sales_count),0) AS sales, COALESCE(SUM(revenue_total),0) AS revenue FROM shop_stats`),
    env.DB.prepare(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS n FROM users WHERE ${owner} AND created_at >= ?1 GROUP BY day`).bind(iso30),
    env.DB.prepare(`SELECT day, COUNT(DISTINCT shop_id) AS shops, SUM(sales_count) AS sales, SUM(revenue) AS revenue FROM shop_daily WHERE day >= ?1 AND sales_count > 0 GROUP BY day`).bind(d30),
    env.DB.prepare(`SELECT day, visits FROM site_daily WHERE day >= ?1`).bind(d30),
    env.DB.prepare(`SELECT COALESCE(NULLIF(category,''),'autre') AS k, COUNT(*) AS n FROM shops GROUP BY k ORDER BY n DESC LIMIT 8`),
    env.DB.prepare(`SELECT COALESCE(NULLIF(country,''),'?') AS k, COUNT(*) AS n FROM shops GROUP BY k ORDER BY n DESC LIMIT 8`),
    env.DB.prepare(`SELECT COUNT(DISTINCT shop_id) AS n FROM shop_daily WHERE day >= ?1 AND sales_count > 0`).bind(d7),
    env.DB.prepare(`SELECT substr(key,6) AS day, count FROM login_attempts WHERE key LIKE 'ai:g:%' ORDER BY key DESC LIMIT 7`),
  ]);
  const map = (r: any) => new Map<string, any>((r.results as any[]).map(x => [x.day, x]));
  const sM = map(signups), aM = map(act), vM = map(vis);
  const series = Array.from({ length: 30 }, (_, i) => {
    const day = daysAgo(29 - i);
    return {
      day, signups: sM.get(day)?.n ?? 0, activeShops: aM.get(day)?.shops ?? 0,
      sales: aM.get(day)?.sales ?? 0, revenue: Math.round(aM.get(day)?.revenue ?? 0), visits: vM.get(day)?.visits ?? 0,
    };
  });
  const t: any = tot.results[0] || {};
  return json({
    totals: {
      merchants: t.n ?? 0, suspended: t.suspended ?? 0, teamMembers: (team.results[0] as any)?.n ?? 0,
      sales: (sh.results[0] as any)?.sales ?? 0, revenue: Math.round((sh.results[0] as any)?.revenue ?? 0),
      active7d: (active7.results[0] as any)?.n ?? 0,
      visits30d: series.reduce((a, x) => a + x.visits, 0), signups30d: series.reduce((a, x) => a + x.signups, 0),
    },
    series,
    categories: cats.results, countries: countries.results,
    ai: ai.results, aiDailyGlobal: parseInt(env.AI_DAILY_GLOBAL || '400', 10) || 400,
  });
}

/* ---------- Messages aux utilisateurs ---------- */
const AUDIENCE = /^(all|owners|category:[a-z_]{1,40}|country:[^\u0000-\u001f]{1,40})$/;

function audienceSql(a: string): { sql: string; args: unknown[] } {
  const base = "u.role = 'merchant' AND u.status = 'active'";
  if (a === 'owners') return { sql: `${base} AND COALESCE(u.shop_role,'owner') = 'owner'`, args: [] };
  if (a.startsWith('category:')) return { sql: `${base} AND s.category = ?`, args: [a.slice(9)] };
  if (a.startsWith('country:')) return { sql: `${base} AND LOWER(s.country) = LOWER(?)`, args: [a.slice(8)] };
  return { sql: base, args: [] };
}

export async function adminAnnouncements(req: Request, env: Env, id?: string) {
  if (req.method === 'GET') {
    const rows = (await env.DB.prepare(
      `SELECT a.*, (SELECT COUNT(*) FROM announcement_reads r WHERE r.announcement_id = a.id) AS reads
       FROM announcements a ORDER BY a.created_at DESC LIMIT 50`).all()).results as any[];
    const sizes = new Map<string, number>();
    for (const a of rows) {
      if (sizes.has(a.audience)) continue;
      const q = audienceSql(a.audience);
      const r: any = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM users u LEFT JOIN shops s ON s.shop_id = u.shop_id WHERE ${q.sql}`).bind(...q.args).first();
      sizes.set(a.audience, r?.n ?? 0);
    }
    const now = new Date().toISOString();
    return json({ items: rows.map(a => ({ id: a.id, title: a.title, body: a.body, audience: a.audience, level: a.level,
      createdAt: a.created_at, expiresAt: a.expires_at, active: a.expires_at > now, reads: a.reads, audienceSize: sizes.get(a.audience) ?? 0 })) });
  }
  if (req.method === 'POST' && !id) {
    const b = await readBody(req, 6_000);
    const title = clean(b.title, 80), body = clean(b.body, 1000);
    const audience = clean(b.audience || 'all', 60);
    if (!title || !body) return fail('Titre et message obligatoires.');
    if (!AUDIENCE.test(audience)) return fail('Destinataires invalides.');
    const level = b.level === 'important' ? 'important' : 'info';
    const days = Math.min(90, Math.max(1, parseInt(String(b.days ?? 14), 10) || 14));
    const nid = randomHex(8);
    await env.DB.prepare(
      'INSERT INTO announcements (id, title, body, audience, level, created_at, expires_at) VALUES (?,?,?,?,?,?,?)')
      .bind(nid, title, body, audience, level, new Date().toISOString(), new Date(Date.now() + days * 86400000).toISOString()).run();
    return json({ ok: true, id: nid }, 201);
  }
  if (req.method === 'DELETE' && id) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM announcements WHERE id = ?').bind(id),
      env.DB.prepare('DELETE FROM announcement_reads WHERE announcement_id = ?').bind(id),
    ]);
    return json({ ok: true });
  }
  return fail('Route inconnue.', 404);
}

/** Messages visibles par l'utilisateur connecté (non expirés, bien ciblés). */
export async function myAnnouncements(env: Env, user: UserRow) {
  if (user.role === 'admin') return json({ items: [] });
  const shop: any = await env.DB.prepare('SELECT category, country FROM shops WHERE shop_id = ?').bind(user.shop_id).first();
  const rows = (await env.DB.prepare(
    `SELECT a.id, a.title, a.body, a.audience, a.level, a.created_at,
            EXISTS(SELECT 1 FROM announcement_reads r WHERE r.announcement_id = a.id AND r.user_id = ?1) AS read
     FROM announcements a WHERE a.expires_at > ?2 ORDER BY a.created_at DESC LIMIT 30`)
    .bind(user.id, new Date().toISOString()).all()).results as any[];
  const isOwner = shopRoleOf(user) === 'owner';
  const mine = rows.filter(a => {
    if (a.audience === 'all') return true;
    if (a.audience === 'owners') return isOwner;
    if (a.audience.startsWith('category:')) return shop?.category === a.audience.slice(9);
    if (a.audience.startsWith('country:')) return (shop?.country || '').toLowerCase() === a.audience.slice(8).toLowerCase();
    return false;
  });
  return json({ items: mine.map(a => ({ id: a.id, title: a.title, body: a.body, level: a.level, createdAt: a.created_at, read: !!a.read })) });
}

export async function readAnnouncement(env: Env, user: UserRow, id: string) {
  await env.DB.prepare('INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id) VALUES (?, ?)').bind(id, user.id).run();
  return json({ ok: true });
}
