// Espace administrateur : liste paginée + statistiques PRÉCALCULÉES (tables shop_stats / shop_daily).
// Aucune lecture des ventes : le temps de réponse ne dépend pas du nombre de ventes enregistrées.

import {
  json, fail, randomHex, hashPassword, readBody, publicUser, type Env, type UserRow,
} from './util';

const PAGE_SIZE = 25;
const SECTORS = /^[a-z_]{1,40}$/;

function shopFromRow(r: any) {
  try { return r.settings ? JSON.parse(r.settings) : null; } catch { return null; }
}

export async function adminList(req: Request, env: Env) {
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 40);
  const status = url.searchParams.get('status');
  const sector = url.searchParams.get('sector') || '';

  const where: string[] = ["u.role = 'merchant'", "COALESCE(u.shop_role, 'owner') = 'owner'"];
  const args: unknown[] = [];
  if (status === 'active' || status === 'suspended') { where.push('u.status = ?'); args.push(status); }
  if (sector && sector !== 'all' && SECTORS.test(sector)) { where.push('s.category = ?'); args.push(sector); }
  if (q) {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    where.push(`(LOWER(u.name) LIKE ? OR u.phone LIKE ? OR LOWER(COALESCE(u.email,'')) LIKE ?
                 OR LOWER(COALESCE(s.shop_name,'')) LIKE ? OR LOWER(COALESCE(s.city,'')) LIKE ?)`);
    args.push(like, like, like, like, like);
  }
  const whereSql = where.join(' AND ');

  const cutoffIso = new Date(Date.now() - 30 * 86400000).toISOString();
  const day30 = cutoffIso.slice(0, 10);
  const owners = "SELECT shop_id FROM users WHERE role = 'merchant' AND COALESCE(shop_role,'owner') = 'owner'";

  const [listRes, countRes, kpiRes, formRes, revRes, resetRes] = await env.DB.batch([
    env.DB.prepare(
      `SELECT u.*, s.settings, COALESCE(st.sales_count,0) AS sales_count, COALESCE(st.revenue_total,0) AS revenue_total,
              st.last_activity, (SELECT COUNT(*) FROM users m WHERE m.shop_id = u.shop_id) AS team_count
       FROM users u LEFT JOIN shops s ON s.shop_id = u.shop_id LEFT JOIN shop_stats st ON st.shop_id = u.shop_id
       WHERE ${whereSql} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`)
      .bind(...args, PAGE_SIZE, (page - 1) * PAGE_SIZE),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM users u LEFT JOIN shops s ON s.shop_id = u.shop_id WHERE ${whereSql}`).bind(...args),
    env.DB.prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(status = 'active'),0) AS active, COALESCE(SUM(created_at >= ?1),0) AS new30
       FROM users WHERE role = 'merchant' AND COALESCE(shop_role,'owner') = 'owner'`).bind(cutoffIso),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM users u JOIN shops s ON s.shop_id = u.shop_id
       WHERE u.role = 'merchant' AND COALESCE(u.shop_role,'owner') = 'owner' AND s.formalized = 1`),
    env.DB.prepare(
      `SELECT COALESCE(SUM(revenue),0) AS revenue, COALESCE(SUM(sales_count),0) AS sales
       FROM shop_daily WHERE day >= ?1 AND shop_id IN (${owners})`).bind(day30),
    env.DB.prepare(
      `SELECT r.user_id, r.created_at, u.name, u.phone, COALESCE(u.shop_role,'owner') AS shop_role
       FROM reset_requests r JOIN users u ON u.id = r.user_id ORDER BY r.created_at DESC LIMIT 50`),
  ]);

  const rows = (listRes.results as any[]) || [];
  const rev30: Record<string, { revenue: number; sales: number }> = {};
  if (rows.length) {
    const ids = rows.map((r) => r.shop_id);
    const r30 = await env.DB.prepare(
      `SELECT shop_id, SUM(revenue) AS revenue, SUM(sales_count) AS sales FROM shop_daily
       WHERE day >= ? AND shop_id IN (${ids.map(() => '?').join(',')}) GROUP BY shop_id`)
      .bind(day30, ...ids).all<any>();
    for (const r of r30.results) rev30[r.shop_id] = { revenue: r.revenue, sales: r.sales };
  }

  const total = (countRes.results[0] as any)?.n ?? 0;
  const k = (kpiRes.results[0] as any) || {};
  return json({
    page, pageSize: PAGE_SIZE, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    kpis: {
      merchants: k.total ?? 0, active: k.active ?? 0, new30: k.new30 ?? 0,
      formalized: (formRes.results[0] as any)?.n ?? 0,
      revenue30d: (revRes.results[0] as any)?.revenue ?? 0,
      sales30d: (revRes.results[0] as any)?.sales ?? 0,
    },
    items: rows.map((r) => ({
      user: publicUser(r as UserRow),
      shop: shopFromRow(r),
      teamCount: r.team_count,
      stats: {
        salesCount: r.sales_count, revenueTotal: r.revenue_total, lastActivity: r.last_activity || null,
        revenue30d: rev30[r.shop_id]?.revenue ?? 0, sales30d: rev30[r.shop_id]?.sales ?? 0,
      },
    })),
    resetRequests: (resetRes.results as any[]).map((r) => ({
      userId: r.user_id, createdAt: r.created_at, name: r.name, phone: r.phone, shopRole: r.shop_role,
    })),
  });
}

/** Export CSV de tous les commerçants (Excel : séparateur « ; », accents conservés). */
export async function adminExport(env: Env) {
  const day30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const rows = (await env.DB.prepare(
    `SELECT u.name, u.phone, u.email, u.status, u.created_at, s.shop_name, s.category, s.city, s.country, s.formalized,
            COALESCE(st.sales_count,0) AS sales_count, COALESCE(st.revenue_total,0) AS revenue_total, st.last_activity,
            COALESCE((SELECT SUM(d.revenue) FROM shop_daily d WHERE d.shop_id = u.shop_id AND d.day >= ?1),0) AS rev30,
            (SELECT COUNT(*) FROM users m WHERE m.shop_id = u.shop_id) AS team_count
     FROM users u LEFT JOIN shops s ON s.shop_id = u.shop_id LEFT JOIN shop_stats st ON st.shop_id = u.shop_id
     WHERE u.role = 'merchant' AND COALESCE(u.shop_role,'owner') = 'owner'
     ORDER BY u.created_at DESC LIMIT 20000`).bind(day30).all<any>()).results;
  const esc = (v: unknown) => {
    const t = String(v ?? '');
    return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const head = ['Commerçant', 'Boutique', 'Secteur', 'Pays', 'Ville', 'Téléphone', 'Email', 'Statut', 'Formalisé',
    'Inscription', 'Équipe', 'Nb ventes', 'CA total', 'CA 30 jours', 'Dernière activité'];
  const lines = [head.join(';')];
  for (const r of rows) {
    lines.push([r.name, r.shop_name, r.category, r.country, r.city, r.phone, r.email, r.status,
      r.formalized ? 'Oui' : 'Non', String(r.created_at).slice(0, 10), r.team_count, r.sales_count,
      Math.round(r.revenue_total), Math.round(r.rev30), r.last_activity ? String(r.last_activity).slice(0, 10) : '']
      .map(esc).join(';'));
  }
  return new Response('﻿' + lines.join('\n'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function adminUser(req: Request, env: Env, admin: UserRow, id: string, sub: string | undefined) {
  const target = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
  if (!target) return fail('Utilisateur introuvable.', 404);
  if (target.id === admin.id) return fail('Vous ne pouvez pas modifier votre propre compte administrateur ici.', 400);
  const isOwner = (target.shop_role || 'owner') === 'owner';

  if (req.method === 'PATCH' && !sub) {
    const b = await readBody(req, 2_000);
    if (b.status !== 'active' && b.status !== 'suspended') return fail('Statut invalide.');
    if (b.status === 'suspended' && isOwner) {
      // suspendre une boutique bloque aussi son équipe
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET status = 'suspended' WHERE shop_id = ?").bind(target.shop_id),
        env.DB.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE shop_id = ?)').bind(target.shop_id),
      ]);
    } else {
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET status = ? WHERE id = ?').bind(b.status, id),
        ...(b.status === 'suspended' ? [env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id)] : []),
      ]);
    }
    return json({ ok: true });
  }
  if (req.method === 'POST' && sub === 'reset-password') {
    const b = await readBody(req, 2_000);
    const pw = typeof b.newPassword === 'string' ? b.newPassword : '';
    if (pw.length < 8) return fail('Mot de passe : 8 caractères minimum.');
    const salt = randomHex(16);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').bind(await hashPassword(pw, salt), salt, id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
      env.DB.prepare('DELETE FROM reset_requests WHERE user_id = ?').bind(id),
    ]);
    return json({ ok: true });
  }
  if (req.method === 'DELETE' && !sub) {
    if (isOwner) {
      // supprime la boutique entière : données, statistiques, employés
      const s = target.shop_id;
      await env.DB.batch([
        env.DB.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE shop_id = ?)').bind(s),
        env.DB.prepare('DELETE FROM reset_requests WHERE user_id IN (SELECT id FROM users WHERE shop_id = ?)').bind(s),
        env.DB.prepare('DELETE FROM records WHERE shop_id = ?').bind(s),
        env.DB.prepare('DELETE FROM shop_daily WHERE shop_id = ?').bind(s),
        env.DB.prepare('DELETE FROM feedback WHERE shop_id = ?').bind(s),
        env.DB.prepare('DELETE FROM shop_stats WHERE shop_id = ?').bind(s),
        env.DB.prepare('DELETE FROM push_log WHERE shop_id = ?').bind(s),
        env.DB.prepare('DELETE FROM shops WHERE shop_id = ?').bind(s),
        env.DB.prepare('DELETE FROM users WHERE shop_id = ?').bind(s),
      ]);
    } else {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
        env.DB.prepare('DELETE FROM reset_requests WHERE user_id = ?').bind(id),
        env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id),
      ]);
    }
    return json({ ok: true });
  }
  return fail('Route inconnue.', 404);
}

