// Comptes : inscription, connexion, mot de passe, session

import { SETTINGS_ID } from '../../shared/syncCore';
import {
  json, fail, str, normEmail, normPhone, isEmail, randomHex, hashPassword, safeEqual, readBody,
  createSession, sessionCookie, publicUser, checkRate, recordFailure, clearFailures,
  getCookie, sha256, COOKIE, SESSION_DAYS, type Env, type UserRow,
} from './util';

export async function register(req: Request, env: Env) {
  const b = await readBody(req, 20_000);
  const name = str(b.fullName, 100);
  const email = normEmail(b.email);
  const phone = normPhone(str(b.phone, 30));
  const password = typeof b.password === 'string' ? b.password : '';
  const shopName = str(b.shopName, 120);
  if (!name || !phone || !shopName) return fail("Nom, téléphone et nom d'entreprise sont obligatoires.");
  if (phone.replace(/\D/g, '').length < 8) return fail('Numéro de téléphone invalide.');
  if (email && !isEmail(email)) return fail('Adresse email invalide.');
  if (password.length < 8 || password.length > 200) return fail('Le mot de passe doit contenir au moins 8 caractères.');

  const admin = normEmail(env.ADMIN_EMAIL);
  const isAdmin = !!email && !!admin && email === admin;

  const dup = await env.DB.prepare('SELECT id FROM users WHERE phone = ? OR (email IS NOT NULL AND email = ?)')
    .bind(phone, email || '\u0000').first();
  if (dup) return fail('Un compte existe déjà avec ce téléphone ou cet email.', 409);

  const id = 'user-' + randomHex(8);
  const shopId = 'shop-' + randomHex(8);
  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);
  const now = new Date().toISOString();
  const country = str(b.country, 80) || "Côte d'Ivoire";
  const shop = {
    shopId, shopName, ownerName: name, country, city: str(b.city, 80) || 'Abidjan', phone,
    currency: country.toLowerCase().includes('guinée') ? 'GNF' : 'XOF',
    isFormalized: false, businessType: shopName,
    businessCategory: str(b.businessCategory, 40) || 'retail_food', foundedYear: new Date().getFullYear(),
  };
  const shopJson = JSON.stringify(shop);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO users (id,email,phone,name,password_hash,salt,role,status,shop_id,shop_role,created_at,last_login_at)
                    VALUES (?,?,?,?,?,?,?, 'active',?, 'owner',?,?)`)
      .bind(id, email || null, phone, name, hash, salt, isAdmin ? 'admin' : 'merchant', shopId, now, now),
    env.DB.prepare(`INSERT INTO shops (shop_id,user_id,settings,seq,shop_name,category,city,country,formalized)
                    VALUES (?,?,?,1,?,?,?,?,0)`)
      .bind(shopId, id, shopJson, shop.shopName, shop.businessCategory, shop.city, shop.country),
    env.DB.prepare(`INSERT INTO records (shop_id,kind,id,json,updated_at,deleted,seq)
                    VALUES (?, 'settings', ?, ?, ?, 0, 1)`)
      .bind(shopId, SETTINGS_ID, shopJson, Date.now()),
  ]);
  const user = (await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>())!;
  const token = await createSession(env, id);
  return json({ user: publicUser(user), shop }, 201, { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400) });
}

export async function login(req: Request, env: Env) {
  const b = await readBody(req, 5_000);
  const idRaw = str(b.identifier, 120);
  const password = typeof b.password === 'string' ? b.password : '';
  if (!idRaw || !password) return fail('Identifiant et mot de passe requis.');
  const email = normEmail(idRaw);
  const phone = normPhone(idRaw);
  const rateKey = (email || phone).toLowerCase();
  if (!(await checkRate(env, rateKey))) return fail('Trop de tentatives. Réessayez dans 15 minutes.', 429);

  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ? OR phone = ?')
    .bind(email, phone || '\u0000').first<UserRow>();
  // calcul fait même si l'utilisateur n'existe pas (timing uniforme)
  const hash = await hashPassword(password, user?.salt || '00'.repeat(16));
  if (!user || !safeEqual(hash, user.password_hash)) {
    await recordFailure(env, rateKey);
    return fail('Identifiant ou mot de passe incorrect.', 401);
  }
  if (user.status === 'suspended') return fail("Ce compte est suspendu par l'administration.", 403);
  await clearFailures(env, rateKey);

  const admin = normEmail(env.ADMIN_EMAIL);
  if (user.email && admin && user.email === admin && user.role !== 'admin') {
    await env.DB.prepare("UPDATE users SET role='admin' WHERE id=?").bind(user.id).run();
    user.role = 'admin';
  }
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE users SET last_login_at=? WHERE id=?').bind(now, user.id).run();
  user.last_login_at = now;
  const shopRow = await env.DB.prepare('SELECT settings FROM shops WHERE shop_id=?').bind(user.shop_id).first<any>();
  const token = await createSession(env, user.id);
  return json({ user: publicUser(user), shop: shopRow ? JSON.parse(shopRow.settings) : null }, 200,
    { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400) });
}

export async function forgot(req: Request, env: Env) {
  const b = await readBody(req, 5_000);
  const idRaw = str(b.identifier, 120);
  const contact = (env.SUPPORT_WHATSAPP || '').replace(/\D/g, '');
  if (!idRaw) return fail('Indiquez votre téléphone ou votre email.');
  const email = normEmail(idRaw);
  const phone = normPhone(idRaw);
  if (!(await checkRate(env, 'forgot:' + (email || phone)))) return fail('Trop de demandes. Réessayez plus tard.', 429);
  await recordFailure(env, 'forgot:' + (email || phone));
  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ? OR phone = ?')
    .bind(email, phone || '\u0000').first<{ id: string }>();
  if (user) {
    await env.DB.prepare(
      `INSERT INTO reset_requests (user_id, created_at) VALUES (?,?)
       ON CONFLICT(user_id) DO UPDATE SET created_at=excluded.created_at`)
      .bind(user.id, new Date().toISOString()).run();
  }
  // réponse identique que le compte existe ou non (pas de fuite d'information)
  return json({ ok: true, contact });
}

export async function logout(req: Request, env: Env) {
  const token = getCookie(req, COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(token)).run();
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
}

export async function me(req: Request, env: Env, user: UserRow) {
  const shopRow = await env.DB.prepare('SELECT settings FROM shops WHERE shop_id=?').bind(user.shop_id).first<any>();
  const shop = shopRow ? JSON.parse(shopRow.settings) : null;
  if (new URL(req.url).searchParams.get('v') === '3') return json({ user: publicUser(user), shop });

  // Compatibilité : anciens appareils qui n'ont pas encore reçu la mise à jour.
  const rows = await env.DB.prepare(
    "SELECT kind, json FROM records WHERE shop_id = ? AND deleted = 0 AND kind != 'settings'")
    .bind(user.shop_id).all<any>();
  const data: Record<string, unknown[]> = { products: [], sales: [], expenses: [], customers: [], suppliers: [] };
  for (const r of rows.results) { try { data[r.kind]?.push(JSON.parse(r.json)); } catch { /* ignore */ } }
  return json({ user: publicUser(user), settings: shop, data });
}

export async function changePassword(req: Request, env: Env, user: UserRow) {
  const b = await readBody(req, 5_000);
  const cur = typeof b.currentPassword === 'string' ? b.currentPassword : '';
  const next = typeof b.newPassword === 'string' ? b.newPassword : '';
  if (next.length < 8) return fail('Le nouveau mot de passe doit contenir au moins 8 caractères.');
  if (!safeEqual(await hashPassword(cur, user.salt), user.password_hash)) return fail('Mot de passe actuel incorrect.', 401);
  const salt = randomHex(16);
  await env.DB.prepare('UPDATE users SET password_hash=?, salt=? WHERE id=?')
    .bind(await hashPassword(next, salt), salt, user.id).run();
  return json({ ok: true });
}
