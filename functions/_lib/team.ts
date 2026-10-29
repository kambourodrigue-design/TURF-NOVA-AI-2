// Équipe d'une boutique : le propriétaire crée les comptes de ses employés.
// Chaque employé a son propre identifiant et mot de passe, et peut se connecter en même temps que les autres.

import { planStatus, loadBilling } from './billing';
import {
  json, fail, str, normEmail, normPhone, isEmail, randomHex, hashPassword, readBody, shopRoleOf,
  type Env, type UserRow,
} from './util';

const MAX_TEAM = 15;
const ROLES = ['manager', 'cashier'] as const;

const member = (u: any) => ({
  id: u.id, name: u.name, phone: u.phone, email: u.email || '', shopRole: shopRoleOf(u),
  status: u.status, createdAt: u.created_at, lastLoginAt: u.last_login_at,
});

export async function handleTeam(req: Request, env: Env, user: UserRow, parts: string[]) {
  if (shopRoleOf(user) !== 'owner') return fail('Réservé au propriétaire de la boutique.', 403);
  const m = req.method;
  const id = parts[1];
  const sub = parts[2];

  if (!id) {
    if (m === 'GET') {
      const rows = await env.DB.prepare('SELECT * FROM users WHERE shop_id = ? ORDER BY created_at ASC')
        .bind(user.shop_id).all<UserRow>();
      return json({ members: rows.results.map(member) });
    }
    if (m === 'POST') return addMember(req, env, user);
    return fail('Route introuvable.', 404);
  }

  const target = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND shop_id = ?').bind(id, user.shop_id).first<UserRow>();
  if (!target) return fail('Membre introuvable.', 404);
  if (shopRoleOf(target) === 'owner') return fail('Le propriétaire ne peut pas être modifié ici.', 400);

  if (m === 'PATCH' && !sub) {
    const b = await readBody(req, 2_000);
    const sets: string[] = [];
    const args: unknown[] = [];
    if (b.status === 'active' || b.status === 'suspended') { sets.push('status = ?'); args.push(b.status); }
    if (ROLES.includes(b.shopRole)) { sets.push('shop_role = ?'); args.push(b.shopRole); }
    if (!sets.length) return fail('Rien à modifier.');
    const stmts = [env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...args, id)];
    if (b.status === 'suspended' || ROLES.includes(b.shopRole)) {
      stmts.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id)); // se reconnecter avec le nouveau rôle
    }
    await env.DB.batch(stmts);
    return json({ ok: true });
  }
  if (m === 'POST' && sub === 'reset-password') {
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
  if (m === 'DELETE' && !sub) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
      env.DB.prepare('DELETE FROM reset_requests WHERE user_id = ?').bind(id),
      env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id),
    ]);
    return json({ ok: true });
  }
  return fail('Route introuvable.', 404);
}

async function addMember(req: Request, env: Env, owner: UserRow) {
  const b = await readBody(req, 5_000);
  const name = str(b.name, 100);
  const phone = normPhone(str(b.phone, 30));
  const email = normEmail(b.email);
  const password = typeof b.password === 'string' ? b.password : '';
  const shopRole = b.shopRole;
  if (!name || !phone) return fail('Nom et téléphone obligatoires.');
  if (phone.replace(/\D/g, '').length < 8) return fail('Numéro de téléphone invalide.');
  if (email && !isEmail(email)) return fail('Adresse email invalide.');
  if (password.length < 8 || password.length > 200) return fail('Mot de passe : 8 caractères minimum.');
  if (!ROLES.includes(shopRole)) return fail('Rôle invalide.');

  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE shop_id = ?').bind(owner.shop_id).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_TEAM + 1) return fail(`Limite de ${MAX_TEAM} employés atteinte.`, 400);
  const cfg = await loadBilling(env), st = await planStatus(env, owner.shop_id, cfg);
  if (st.enforced && !st.pro && (count?.n ?? 0) - 1 >= cfg.freeTeamMax)
    return fail(`Le plan gratuit permet ${cfg.freeTeamMax} employé(s). Passez au plan Pro pour en ajouter (Paramètres → Abonnement).`, 402);

  const dup = await env.DB.prepare('SELECT id FROM users WHERE phone = ? OR (email IS NOT NULL AND email = ?)')
    .bind(phone, email || '\u0000').first();
  if (dup) return fail('Un compte existe déjà avec ce téléphone ou cet email.', 409);

  const id = 'user-' + randomHex(8);
  const salt = randomHex(16);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id,email,phone,name,password_hash,salt,role,status,shop_id,shop_role,created_at,last_login_at)
     VALUES (?,?,?,?,?,?, 'merchant', 'active', ?, ?, ?, ?)`)
    .bind(id, email || null, phone, name, await hashPassword(password, salt), salt, owner.shop_id, shopRole, now, now).run();
  const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
  return json({ member: member(row) }, 201);
}
