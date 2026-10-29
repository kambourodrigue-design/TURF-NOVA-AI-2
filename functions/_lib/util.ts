// Utilitaires communs de l'API (réponses, mots de passe, sessions, anti force brute)

import type { ShopRole } from '../../shared/syncCore';

export interface Env {
  DB: D1Database;
  ADMIN_EMAIL?: string;
  SUPPORT_WHATSAPP?: string;
  /** Liaison Workers AI (Cloudflare Pages → Paramètres → Liaisons → Workers AI, nom : AI) */
  AI?: { run(model: string, input: unknown): Promise<any> };
  AI_MODEL?: string;
  AI_DAILY_SHOP?: string;     // questions par boutique et par jour (défaut 15)
  AI_DAILY_GLOBAL?: string;   // total plateforme par jour (défaut 400)
  AI_DAILY_SALE?: string;     // dictées de vente par boutique et par jour (défaut 60)
  TELEGRAM_BOT_TOKEN?: string; // alertes d'erreurs (optionnel)
  TELEGRAM_CHAT_ID?: string;
  /** Money Fusion : URL d'API de paiement fournie dans votre tableau de bord (secret Cloudflare) */
  MONEYFUSION_API_URL?: string;
  /** Optionnel : URL de vérification (défaut https://www.pay.moneyfusion.net/paiementNotif) */
  MONEYFUSION_STATUS_URL?: string;
}

export const SESSION_DAYS = 30;
export const COOKIE = 'sb_session';

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
/** Réponse dont le corps est déjà du JSON texte (évite de re-sérialiser). */
export const jsonRaw = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
export const fail = (message: string, status = 400) => json({ error: message }, status);

export const toHex = (buf: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(buf instanceof Uint8Array ? buf : new Uint8Array(buf))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
export const fromHex = (hex: string) => new Uint8Array(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
export const randomHex = (n: number) => toHex(crypto.getRandomValues(new Uint8Array(n)));

export async function sha256(text: string) {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

export async function hashPassword(password: string, saltHex: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: 100_000 }, key, 256);
  return toHex(bits);
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const normPhone = (p: string) => {
  const t = (p || '').trim();
  const digits = t.replace(/\D/g, '');
  return digits ? (t.startsWith('+') ? '+' : '') + digits : '';
};
export const normEmail = (e: unknown) => (typeof e === 'string' ? e.trim().toLowerCase() : '');
export const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function getCookie(req: Request, name: string) {
  const m = (req.headers.get('Cookie') || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}
export const sessionCookie = (token: string, maxAge: number) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

export interface UserRow {
  id: string; email: string | null; phone: string; name: string; password_hash: string; salt: string;
  role: 'admin' | 'merchant'; status: 'active' | 'suspended'; shop_id: string;
  shop_role?: ShopRole | null; created_at: string; last_login_at: string;
}

/** Rôle dans la boutique (les comptes créés avant la mise à jour sont « propriétaire »). */
export const shopRoleOf = (u: UserRow): ShopRole =>
  u.shop_role === 'manager' || u.shop_role === 'cashier' ? u.shop_role : 'owner';

export const publicUser = (u: UserRow) => ({
  id: u.id, email: u.email || '', phone: u.phone, name: u.name, role: u.role,
  shopRole: shopRoleOf(u),
  status: u.status, shopId: u.shop_id, createdAt: u.created_at, lastLoginAt: u.last_login_at,
});

export async function createSession(env: Env, userId: string) {
  const token = randomHex(32);
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)')
    .bind(await sha256(token), userId, exp).run();
  // nettoyage opportuniste des sessions expirées (1 connexion sur 10)
  if (Math.random() < 0.1) {
    await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Math.floor(Date.now() / 1000)).run();
  }
  return token;
}

export async function currentUser(req: Request, env: Env): Promise<UserRow | null> {
  const token = getCookie(req, COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`)
    .bind(await sha256(token), Math.floor(Date.now() / 1000)).first<UserRow>();
  if (!row || row.status !== 'active') return null;
  return row;
}

export async function readBody(req: Request, maxChars = 3_000_000): Promise<any> {
  const text = await req.text();
  if (text.length > maxChars) throw new HttpError('Requête trop volumineuse', 413);
  try { return JSON.parse(text || '{}'); } catch { throw new HttpError('JSON invalide', 400); }
}

export class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// anti force brute : 8 échecs / 15 min par identifiant
export async function checkRate(env: Env, key: string) {
  const now = Math.floor(Date.now() / 1000);
  const r = await env.DB.prepare('SELECT count, window_start FROM login_attempts WHERE key = ?').bind(key).first<any>();
  if (r && now - r.window_start < 900 && r.count >= 8) return false;
  return true;
}
export async function recordFailure(env: Env, key: string) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO login_attempts (key, count, window_start) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN ?2 - window_start >= 900 THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN ?2 - window_start >= 900 THEN ?2 ELSE window_start END`)
    .bind(key, now).run();
}
export const clearFailures = (env: Env, key: string) =>
  env.DB.prepare('DELETE FROM login_attempts WHERE key = ?').bind(key).run();
