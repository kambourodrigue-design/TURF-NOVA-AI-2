// Avis des commerçants : un formulaire dans l'application, une validation par l'administrateur,
// et une publication sur la page d'accueil uniquement si le commerçant a donné son accord.

import { json, fail, readBody, shopRoleOf, randomHex, type Env, type UserRow } from './util';

const clean = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export async function myFeedback(env: Env, user: UserRow) {
  const r = await env.DB.prepare('SELECT rating, text, consent, name, shop_label, city, status FROM feedback WHERE shop_id = ?').bind(user.shop_id).first();
  return json({ feedback: r || null });
}

export async function submitFeedback(req: Request, env: Env, user: UserRow) {
  if (shopRoleOf(user) === 'cashier') return fail('Réservé au propriétaire ou au gérant.', 403);
  const x = await readBody(req, 4_000);
  const rating = Math.round(Number(x.rating));
  const text = clean(x.text, 400);
  if (!(rating >= 1 && rating <= 5)) return fail('Choisissez une note de 1 à 5.');
  if (text.length < 10) return fail('Écrivez au moins une phrase (10 caractères).');
  const name = clean(x.name, 40) || String(user.name || '').split(' ')[0];
  const shopLabel = clean(x.shopLabel, 50);
  const city = clean(x.city, 40);
  const consent = x.consent ? 1 : 0;
  const now = new Date().toISOString();
  // un seul avis par boutique ; toute modification repasse en attente de validation
  await env.DB.prepare(
    `INSERT INTO feedback (id, shop_id, user_id, name, shop_label, city, rating, text, consent, status, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'new', ?10)
     ON CONFLICT(shop_id) DO UPDATE SET name = ?4, shop_label = ?5, city = ?6, rating = ?7, text = ?8, consent = ?9, status = 'new', created_at = ?10`
  ).bind('fb_' + randomHex(6), user.shop_id, user.id, name, shopLabel, city, rating, text, consent, now).run();
  return json({ ok: true });
}

/** Public : seulement les avis validés par l'admin ET autorisés par le commerçant. */
export async function publicTestimonials(env: Env) {
  try {
    const r = await env.DB.prepare(
      `SELECT name, shop_label, city, rating, text FROM feedback WHERE status = 'published' AND consent = 1 ORDER BY created_at DESC LIMIT 12`
    ).all();
    return json({ items: r.results || [] }, 200, { 'Cache-Control': 'public, max-age=300' });
  } catch { return json({ items: [] }); }
}

export async function adminFeedback(req: Request, env: Env, id?: string) {
  if (!id && req.method === 'GET') {
    const r = await env.DB.prepare(
      `SELECT id, name, shop_label, city, rating, text, consent, status, created_at FROM feedback ORDER BY (status = 'new') DESC, created_at DESC LIMIT 200`
    ).all();
    return json({ items: r.results || [] });
  }
  if (id && req.method === 'PUT') {
    const x = await readBody(req, 500);
    const status = x.status;
    if (!['new', 'published', 'hidden'].includes(status)) return fail('Statut invalide.');
    if (status === 'published') {
      const row: any = await env.DB.prepare('SELECT consent FROM feedback WHERE id = ?').bind(id).first();
      if (!row) return fail('Avis introuvable.', 404);
      if (!row.consent) return fail("Ce commerçant n'a pas autorisé la publication de son avis.", 409);
    }
    await env.DB.prepare('UPDATE feedback SET status = ? WHERE id = ?').bind(status, id).run();
    return json({ ok: true });
  }
  if (id && req.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM feedback WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }
  return fail('Route introuvable.', 404);
}
