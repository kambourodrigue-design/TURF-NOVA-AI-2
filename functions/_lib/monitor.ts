// Surveillance : journal d'erreurs (serveur + application), santé du service, alertes Telegram (optionnelles).
// Principe : on n'enregistre que les VRAIES erreurs (5xx, plantages), jamais les erreurs normales (mot de passe faux...).

import { json, fail, readBody, type Env, type UserRow } from './util';

const clip = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ').trim().slice(0, n);

/** Remplace les identifiants/nombres pour regrouper les erreurs similaires. */
const signature = (route: string, msg: string) =>
  (route + '|' + msg).toLowerCase().replace(/[0-9a-f]{8,}/g, '#').replace(/\d+/g, '#').slice(0, 120);

export async function sendTelegram(env: Env, text: string): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: text.slice(0, 3500) }),
    });
    return r.ok;
  } catch { return false; }
}

/** Alerte au plus une fois par 10 minutes pour la même signature. */
async function alertOnce(env: Env, sig: string, text: string) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const key = 'alert:' + sig.slice(0, 80), now = Math.floor(Date.now() / 1000);
  const r: any = await env.DB.prepare('SELECT window_start FROM login_attempts WHERE key = ?').bind(key).first();
  if (r && now - r.window_start < 600) return;
  await env.DB.prepare(
    `INSERT INTO login_attempts (key, count, window_start) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET window_start = ?2`).bind(key, now).run();
  await sendTelegram(env, text);
}

/** Ne doit JAMAIS faire échouer la requête d'origine. */
export async function logError(env: Env, e: { source: 'server' | 'client'; route?: string; status?: number; message: string; shopId?: string | null }) {
  try {
    const message = clip(e.message, 300) || '(sans message)';
    const route = clip(e.route, 80);
    const sig = signature(route, message);
    await env.DB.prepare(
      'INSERT INTO error_log (ts, source, route, status, message, sig, shop_id) VALUES (?,?,?,?,?,?,?)')
      .bind(new Date().toISOString(), e.source, route, e.status ?? null, message, sig, e.shopId ?? null).run();
    if (Math.random() < 0.02) {
      await env.DB.prepare('DELETE FROM error_log WHERE ts < ?').bind(new Date(Date.now() - 14 * 86400000).toISOString()).run();
    }
    await alertOnce(env, sig, `⚠️ Nafora — erreur ${e.source}${e.status ? ' ' + e.status : ''}\n${route}\n${message}`);
  } catch { /* ignore */ }
}

/** Contrôle de santé (à brancher sur UptimeRobot / Better Stack : gratuit). */
export async function health(env: Env) {
  const t0 = Date.now();
  try {
    await env.DB.prepare('SELECT 1').first();
    return json({ ok: true, db: true, ms: Date.now() - t0, time: new Date().toISOString() }, 200, { 'Cache-Control': 'no-store' });
  } catch (e: any) {
    await logError(env, { source: 'server', route: 'health', status: 503, message: 'Base de données injoignable : ' + (e?.message || '') });
    return json({ ok: false, db: false, time: new Date().toISOString() }, 503, { 'Cache-Control': 'no-store' });
  }
}

/** Erreurs signalées par l'application elle-même (plantage d'écran, erreur JavaScript). Public mais plafonné. */
export async function clientLog(req: Request, env: Env, user: UserRow | null) {
  const b = await readBody(req, 4_000);
  const hourKey = 'clog:' + new Date().toISOString().slice(0, 13);
  const row: any = await env.DB.prepare(
    `INSERT INTO login_attempts (key, count, window_start) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count`)
    .bind(hourKey, Math.floor(Date.now() / 1000)).first();
  if ((row?.count ?? 0) > 200) return json({ ok: true });         // plafond : 200 signalements/heure
  await logError(env, { source: 'client', route: clip(b.where, 60), message: clip(b.message, 300), shopId: user?.shop_id });
  return json({ ok: true });
}

export async function adminMonitor(env: Env) {
  const t0 = Date.now();
  const since24 = new Date(Date.now() - 86400000).toISOString();
  const since1h = new Date(Date.now() - 3600000).toISOString();
  const [c24, c1, top, recent, hours] = await env.DB.batch([
    env.DB.prepare(`SELECT source, COUNT(*) AS n FROM error_log WHERE ts >= ?1 GROUP BY source`).bind(since24),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM error_log WHERE ts >= ?1`).bind(since1h),
    env.DB.prepare(`SELECT sig, MAX(message) AS message, MAX(route) AS route, source, COUNT(*) AS n, MAX(ts) AS last
                    FROM error_log WHERE ts >= ?1 GROUP BY sig, source ORDER BY n DESC LIMIT 10`).bind(since24),
    env.DB.prepare(`SELECT ts, source, route, status, message, shop_id FROM error_log ORDER BY id DESC LIMIT 30`),
    env.DB.prepare(`SELECT substr(ts,1,13) AS h, COUNT(*) AS n FROM error_log WHERE ts >= ?1 GROUP BY h`).bind(since24),
  ]);
  const dbMs = Date.now() - t0;
  const by: Record<string, number> = {};
  for (const r of c24.results as any[]) by[r.source] = r.n;
  const hm = new Map((hours.results as any[]).map(r => [r.h, r.n]));
  const series = Array.from({ length: 24 }, (_, i) => {
    const h = new Date(Date.now() - (23 - i) * 3600000).toISOString().slice(0, 13);
    return { h, n: hm.get(h) ?? 0 };
  });
  const errors24h = (by.server || 0) + (by.client || 0);
  const level = (c1.results[0] as any)?.n >= 10 ? 'red' : errors24h > 0 ? 'orange' : 'green';
  return json({
    level, dbMs, errors24h, server24h: by.server || 0, client24h: by.client || 0, lastHour: (c1.results[0] as any)?.n ?? 0,
    top: top.results, recent: recent.results, series,
    telegram: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
    ai: !!env.AI, whatsapp: !!env.SUPPORT_WHATSAPP,
  });
}

export async function adminMonitorAction(req: Request, env: Env, sub: string | undefined) {
  if (sub === 'test-alert' && req.method === 'POST') {
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return fail("Telegram n'est pas configuré (variables TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID).", 400);
    const ok = await sendTelegram(env, '✅ Nafora : test d\'alerte réussi.');
    return ok ? json({ ok: true }) : fail("Envoi impossible : vérifiez le jeton et l'identifiant du chat Telegram.", 502);
  }
  if (sub === 'clear' && req.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM error_log').run();
    return json({ ok: true });
  }
  return fail('Route inconnue.', 404);
}
