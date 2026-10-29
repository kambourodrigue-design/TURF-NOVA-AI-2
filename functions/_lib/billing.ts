// Facturation : abonnement « Pro » payé par Mobile Money / virement, validé à la main par l'administrateur.
// Principe de sécurité : le plan gratuit ne bloque JAMAIS l'accès aux données ni à la caisse du commerçant.
// Seuls l'assistant IA et le nombre d'employés changent selon le plan.
// Tant que la facturation n'est pas activée dans l'espace admin, rien ne change pour personne.

import { json, fail, readBody, randomHex, shopRoleOf, type Env, type UserRow } from './util';
import { sendTelegram } from './monitor';

export interface BillingSettings {
  enabled: boolean;
  launchedAt: string;          // date d'activation : l'essai ne commence jamais avant
  trialDays: number;
  price1: number; price3: number; price12: number;   // prix pour 1, 3 et 12 mois
  currency: string;
  mfLink: string;              // lien de paiement Money Fusion (clients internationaux, validation manuelle)
  payInfo: string;             // instructions de paiement (numéros Mobile Money, nom du bénéficiaire...)
  freeAiPerDay: number;        // questions IA par jour en plan gratuit
  freeTeamMax: number;         // employés (hors propriétaire) en plan gratuit
  readOnlyAfterTrial: boolean; // true = après l'essai sans abonnement, la boutique passe en lecture seule
}
const DEFAULTS: BillingSettings = {
  enabled: false, launchedAt: '', trialDays: 30, price1: 2500, price3: 6500, price12: 30000, currency: 'F CFA',
  mfLink: '', payInfo: '', freeAiPerDay: 5, freeTeamMax: 1, readOnlyAfterTrial: false,
};
const clean = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ').trim().slice(0, n);
const int = (v: unknown, min: number, max: number, d: number) => {
  const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};

export async function loadBilling(env: Env): Promise<BillingSettings> {
  try {
    const r: any = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'billing'").first();
    return r ? { ...DEFAULTS, ...JSON.parse(r.value) } : { ...DEFAULTS };
  } catch { return { ...DEFAULTS }; }
}
async function saveBilling(env: Env, b: BillingSettings) {
  await env.DB.prepare("INSERT INTO app_settings (key, value) VALUES ('billing', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1")
    .bind(JSON.stringify(b)).run();
}

export interface PlanStatus {
  enforced: boolean;
  state: 'off' | 'paid' | 'trial' | 'free';
  readOnly: boolean;           // true = écritures refusées (essai terminé, option activée ou boutique bloquée par l'admin)
  blocked?: boolean;           // true = l'administrateur a bloqué cette boutique à la fin de son essai
  pro: boolean;                // true = fonctions Pro (payé, essai, ou facturation désactivée)
  paidUntil: string | null; trialEndsAt: string | null; daysLeft: number;
}

export async function planStatus(env: Env, shopId: string, cfg?: BillingSettings, isAdmin = false): Promise<PlanStatus> {
  const b = cfg || await loadBilling(env);
  // L'administrateur n'est jamais limité : ni essai, ni lecture seule
  if (!b.enabled || isAdmin) return { enforced: false, state: 'off', readOnly: false, pro: true, paidUntil: null, trialEndsAt: null, daysLeft: 0 };
  const now = Date.now();
  let paidUntil: string | null = null, created = now;
  try {
    const [sub, owner] = await Promise.all([
      env.DB.prepare('SELECT paid_until FROM subscriptions WHERE shop_id = ?').bind(shopId).first<{ paid_until: string }>(),
      env.DB.prepare("SELECT MIN(created_at) AS c FROM users WHERE shop_id = ?").bind(shopId).first<{ c: string }>(),
    ]);
    paidUntil = sub?.paid_until ?? null;
    if (owner?.c) created = new Date(owner.c).getTime();
  } catch { /* tables absentes : on ne pénalise personne */ return { enforced: false, state: 'off', readOnly: false, pro: true, paidUntil: null, trialEndsAt: null, daysLeft: 0 }; }
  const trialStart = Math.max(created, b.launchedAt ? new Date(b.launchedAt).getTime() : 0);
  const trialEnd = trialStart + b.trialDays * 86400000;
  const day = (t: number) => Math.max(0, Math.ceil((t - now) / 86400000));
  if (paidUntil && new Date(paidUntil).getTime() > now)
    return { enforced: true, state: 'paid', readOnly: false, pro: true, paidUntil, trialEndsAt: null, daysLeft: day(new Date(paidUntil).getTime()) };
  if (now < trialEnd)
    return { enforced: true, state: 'trial', readOnly: false, pro: true, paidUntil, trialEndsAt: new Date(trialEnd).toISOString(), daysLeft: day(trialEnd) };
  // Blocage décidé par l'administrateur pour cette boutique : lecture seule dès que l'essai est terminé
  let blocked = false;
  try { blocked = !!(await env.DB.prepare('SELECT 1 AS x FROM app_settings WHERE key = ?').bind('shop_block:' + shopId).first()); } catch { /* ignore */ }
  return { enforced: true, state: 'free', readOnly: !!b.readOnlyAfterTrial || blocked, blocked, pro: false, paidUntil, trialEndsAt: new Date(trialEnd).toISOString(), daysLeft: 0 };
}

const publicSettings = (b: BillingSettings, env?: Env) => ({
  moneyFusion: !!env?.MONEYFUSION_API_URL, mfLink: b.mfLink,
  enabled: b.enabled, trialDays: b.trialDays, price1: b.price1, price3: b.price3, price12: b.price12,
  currency: b.currency, payInfo: b.payInfo, freeAiPerDay: b.freeAiPerDay, freeTeamMax: b.freeTeamMax,
  readOnlyAfterTrial: b.readOnlyAfterTrial,
});
export const publicPlans = async (env: Env) => {
  const b = await loadBilling(env);
  return json({ ...publicSettings(b, env), whatsapp: (env.SUPPORT_WHATSAPP || '').replace(/\D/g, '') });
};

const payRow = (p: any) => ({
  id: p.id, shopId: p.shop_id, userName: p.user_name, phone: p.phone, amount: p.amount, months: p.months, method: p.method,
  reference: p.reference, status: p.status === 'mf_pending' ? 'pending' : p.status, createdAt: p.created_at, decidedAt: p.decided_at, note: p.note,
});

/* ---------- Côté commerçant ---------- */
export async function myBilling(env: Env, user: UserRow) {
  const b = await loadBilling(env);
  const status = await planStatus(env, user.shop_id, b, user.role === 'admin');
  let payments: any[] = [];
  if (shopRoleOf(user) === 'owner' && b.enabled) {
    try {
      payments = ((await env.DB.prepare('SELECT * FROM payments WHERE shop_id = ? ORDER BY created_at DESC LIMIT 10').bind(user.shop_id).all()).results as any[]).map(payRow);
    } catch { /* ignore */ }
  }
  return json({ status, settings: publicSettings(b, env), payments });
}

export async function submitPayment(req: Request, env: Env, user: UserRow) {
  if (shopRoleOf(user) !== 'owner') return fail('Réservé au propriétaire de la boutique.', 403);
  const b = await loadBilling(env);
  if (!b.enabled) return fail("Les abonnements ne sont pas encore ouverts.", 400);
  const body = await readBody(req, 2_000);
  const months = 12;                       // formule annuelle uniquement
  const price = b.price12;
  if (!price) return fail("Le tarif annuel n'est pas défini.");
  const reference = clean(body.reference, 40), method = clean(body.method, 30) || 'mobile_money', phone = clean(body.phone, 30);
  if (reference.length < 4) return fail('Indiquez la référence (numéro de transaction) du paiement.');
  const pending: any = await env.DB.prepare("SELECT COUNT(*) AS n FROM payments WHERE shop_id = ? AND status = 'pending'").bind(user.shop_id).first();
  if ((pending?.n ?? 0) >= 3) return fail('Vous avez déjà des paiements en attente de validation.', 429);
  const dup: any = await env.DB.prepare("SELECT id FROM payments WHERE reference = ? AND status <> 'rejected'").bind(reference).first();
  if (dup) return fail('Cette référence de paiement a déjà été utilisée.', 409);
  const id = 'pay-' + randomHex(6);
  await env.DB.prepare(
    `INSERT INTO payments (id, shop_id, user_id, user_name, phone, amount, months, method, reference, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?, 'pending', ?)`)
    .bind(id, user.shop_id, user.id, user.name, phone || user.phone, price, months, method, reference, new Date().toISOString()).run();
  await sendTelegram(env, `💰 Nafora : paiement à valider\n${user.name} — ${price} ${b.currency} (${months} mois)\nRéf. ${reference}`);
  return json({ ok: true, id }, 201);
}


/* ---------- Money Fusion (paiement en ligne, clients internationaux) ---------- */
// Flux : le propriétaire lance le paiement → redirection vers la page Money Fusion → retour sur Nafora.
// L'abonnement n'est JAMAIS activé sur la foi du retour navigateur ou du webhook : on interroge toujours
// l'API Money Fusion avec le jeton (token) pour confirmer que le paiement est bien « paid » et du bon montant.
const MF_STATUS_DEFAULT = 'https://www.pay.moneyfusion.net/paiementNotif';

export async function mfStart(req: Request, env: Env, user: UserRow) {
  if (shopRoleOf(user) !== 'owner') return fail('Réservé au propriétaire de la boutique.', 403);
  if (!env.MONEYFUSION_API_URL) return fail("Le paiement en ligne n'est pas encore configuré.", 503);
  const b = await loadBilling(env);
  if (!b.enabled) return fail("Les abonnements ne sont pas encore ouverts.", 400);
  if (!b.price12) return fail("Le tarif annuel n'est pas défini.");
  const body = await readBody(req, 2_000);
  const phone = clean(body.phone, 30).replace(/[^\d+]/g, '') || clean(user.phone, 30).replace(/[^\d+]/g, '');
  if (phone.replace(/\D/g, '').length < 8) return fail('Indiquez un numéro de téléphone valide (celui qui paiera).');
  const recent: any = await env.DB.prepare("SELECT COUNT(*) AS n FROM payments WHERE shop_id = ? AND status = 'mf_pending' AND created_at > ?")
    .bind(user.shop_id, new Date(Date.now() - 3600_000).toISOString()).first();
  if ((recent?.n ?? 0) >= 5) return fail('Trop de tentatives, réessayez dans une heure.', 429);

  const origin = new URL(req.url).origin;
  const id = 'pay-' + randomHex(6);
  let res: Response;
  try {
    res = await fetch(env.MONEYFUSION_API_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        totalPrice: b.price12,
        article: [{ 'Abonnement Nafora Pro (1 an)': b.price12 }],
        personal_Info: [{ paymentId: id, shopId: user.shop_id }],
        numeroSend: phone,
        nomclient: clean(user.name, 60) || 'Client Nafora',
        return_url: `${origin}/?mf=return`,
        webhook_url: `${origin}/api/billing/moneyfusion/webhook`,
      }),
    });
  } catch { return fail('Money Fusion est injoignable, réessayez dans un instant.', 502); }
  const data: any = await res.json().catch(() => null);
  if (!res.ok || !data?.statut || !data.token || !data.url) return fail(clean(data?.message, 200) || 'Money Fusion a refusé la demande.', 502);
  const url = String(data.url);
  if (!/^https:\/\//i.test(url)) return fail('Réponse Money Fusion invalide.', 502);
  await env.DB.prepare(
    `INSERT INTO payments (id, shop_id, user_id, user_name, phone, amount, months, method, reference, status, created_at)
     VALUES (?,?,?,?,?,?,?,'moneyfusion',?, 'mf_pending', ?)`)
    .bind(id, user.shop_id, user.id, user.name, phone, b.price12, 12, String(data.token), new Date().toISOString()).run();
  return json({ ok: true, url });
}

/** Interroge Money Fusion et applique le résultat (idempotent : un paiement n'est crédité qu'une fois). */
async function mfSettle(env: Env, p: any): Promise<'approved' | 'rejected' | 'pending'> {
  if (p.status === 'approved') return 'approved';
  if (p.status !== 'mf_pending') return p.status === 'rejected' ? 'rejected' : 'pending';
  let d: any;
  try {
    const r = await fetch(`${env.MONEYFUSION_STATUS_URL || MF_STATUS_DEFAULT}/${encodeURIComponent(p.reference)}`);
    const j: any = await r.json();
    if (!r.ok || !j?.statut) return 'pending';
    d = j.data;
  } catch { return 'pending'; }
  if (!d || String(d.tokenPay || p.reference) !== p.reference) return 'pending';
  const st = String(d.statut || '').toLowerCase();
  const now = new Date().toISOString();
  if (st === 'failure' || st === 'failed') {
    await env.DB.prepare("UPDATE payments SET status = 'rejected', decided_at = ?, note = 'Paiement en ligne échoué ou annulé' WHERE id = ? AND status = 'mf_pending'").bind(now, p.id).run();
    return 'rejected';
  }
  if (st !== 'paid') return 'pending';
  if (Number(d.Montant) < Number(p.amount)) {
    await env.DB.prepare("UPDATE payments SET status = 'rejected', decided_at = ?, note = 'Montant payé inférieur au tarif' WHERE id = ? AND status = 'mf_pending'").bind(now, p.id).run();
    await sendTelegram(env, `⚠️ Nafora : paiement Money Fusion de montant inférieur (${d.Montant} < ${p.amount}), boutique ${p.shop_id}, réf. ${p.reference}`);
    return 'rejected';
  }
  const res = await env.DB.prepare("UPDATE payments SET status = 'approved', decided_at = ?, note = 'Money Fusion (automatique)' WHERE id = ? AND status = 'mf_pending'").bind(now, p.id).run();
  if (!(res.meta?.changes)) return 'approved';           // déjà traité en parallèle
  const subRow: any = await env.DB.prepare('SELECT paid_until FROM subscriptions WHERE shop_id = ?').bind(p.shop_id).first();
  const until = extend(subRow?.paid_until ?? null, p.months);
  await env.DB.prepare(
    `INSERT INTO subscriptions (shop_id, paid_until, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(shop_id) DO UPDATE SET paid_until = ?2, updated_at = ?3`).bind(p.shop_id, until, now).run();
  await sendTelegram(env, `💳 Nafora : abonnement annuel payé via Money Fusion (${p.amount} F CFA), boutique ${p.shop_id}`);
  return 'approved';
}

/** Le commerçant revient de Money Fusion (ou clique « Vérifier ») : on contrôle ses paiements en cours. */
export async function mfCheck(env: Env, user: UserRow) {
  if (shopRoleOf(user) !== 'owner') return json({ approved: 0, pending: 0 });
  const rows = ((await env.DB.prepare("SELECT * FROM payments WHERE shop_id = ? AND status = 'mf_pending' ORDER BY created_at DESC LIMIT 5").bind(user.shop_id).all()).results as any[]) || [];
  let approved = 0, pending = 0;
  for (const p of rows) { const r = await mfSettle(env, p); if (r === 'approved') approved++; else if (r === 'pending') pending++; }
  return json({ approved, pending });
}

/** Webhook Money Fusion (sans session) : le contenu reçu n'est pas cru, il sert seulement à retrouver le jeton à vérifier. */
export async function mfWebhook(req: Request, env: Env) {
  const body = await readBody(req, 8_000).catch(() => ({} as any));
  const token = clean(body?.tokenPay ?? body?.token, 120);
  if (!token) return json({ ok: true });
  const p: any = await env.DB.prepare("SELECT * FROM payments WHERE reference = ? AND method = 'moneyfusion'").bind(token).first();
  if (p) await mfSettle(env, p);
  return json({ ok: true });
}

/* ---------- Côté administrateur ---------- */
function extend(current: string | null, months: number) {
  const base = Math.max(Date.now(), current ? new Date(current).getTime() : 0);
  return new Date(base + Math.round(months * 30.4375 * 86400000)).toISOString();
}

export async function adminBilling(req: Request, env: Env, parts: string[]) {
  const m = req.method;
  const sub = parts[2];
  if (!sub && m === 'GET') {
    const b = await loadBilling(env);
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const [pend, recent, rev, subs] = await env.DB.batch([
      env.DB.prepare("SELECT p.*, s.shop_name FROM payments p LEFT JOIN shops s ON s.shop_id = p.shop_id WHERE p.status = 'pending' ORDER BY p.created_at ASC LIMIT 100"),
      env.DB.prepare("SELECT p.*, s.shop_name FROM payments p LEFT JOIN shops s ON s.shop_id = p.shop_id WHERE p.status IN ('approved','rejected') ORDER BY p.decided_at DESC LIMIT 30"),
      env.DB.prepare("SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS n FROM payments WHERE status = 'approved' AND decided_at >= ?1").bind(since),
      env.DB.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE paid_until > ?1').bind(new Date().toISOString()),
    ]);
    const row = (p: any) => ({ ...payRow(p), shopName: p.shop_name || '' });
    return json({
      settings: b, pending: (pend.results as any[]).map(row), recent: (recent.results as any[]).map(row),
      revenue30d: (rev.results[0] as any)?.total ?? 0, approved30d: (rev.results[0] as any)?.n ?? 0,
      activeSubs: (subs.results[0] as any)?.n ?? 0,
    });
  }
  if (!sub && m === 'PUT') {
    const cur = await loadBilling(env);
    const x = await readBody(req, 4_000);
    const next: BillingSettings = {
      enabled: !!x.enabled, launchedAt: cur.launchedAt,
      trialDays: int(x.trialDays, 0, 365, cur.trialDays),
      price1: int(x.price1, 0, 10_000_000, cur.price1), price3: int(x.price3, 0, 10_000_000, cur.price3), price12: int(x.price12, 0, 10_000_000, cur.price12),
      currency: clean(x.currency, 10) || 'F CFA', payInfo: clean(x.payInfo, 600),
      mfLink: /^https:\/\/[^\s]+$/i.test(clean(x.mfLink, 400)) ? clean(x.mfLink, 400) : '',
      freeAiPerDay: int(x.freeAiPerDay, 0, 100, cur.freeAiPerDay), freeTeamMax: int(x.freeTeamMax, 0, 15, cur.freeTeamMax),
      readOnlyAfterTrial: x.readOnlyAfterTrial === undefined ? cur.readOnlyAfterTrial : !!x.readOnlyAfterTrial,
    };
    if (next.enabled && !next.payInfo) return fail("Indiquez d'abord les instructions de paiement (numéro Mobile Money…).");
    if (next.enabled && !cur.enabled) next.launchedAt = new Date().toISOString();   // l'essai démarre à l'activation
    await saveBilling(env, next);
    return json({ settings: next });
  }
  if (sub === 'payments' && parts[3] && (parts[4] === 'approve' || parts[4] === 'reject') && m === 'POST') {
    const p: any = await env.DB.prepare('SELECT * FROM payments WHERE id = ?').bind(parts[3]).first();
    if (!p) return fail('Paiement introuvable.', 404);
    if (p.status !== 'pending') return fail('Ce paiement a déjà été traité.', 409);
    const x = await readBody(req, 1_000);
    const now = new Date().toISOString();
    if (parts[4] === 'reject') {
      await env.DB.prepare("UPDATE payments SET status = 'rejected', decided_at = ?, note = ? WHERE id = ? AND status = 'pending'")
        .bind(now, clean(x.note, 200), p.id).run();
      return json({ ok: true });
    }
    const subRow: any = await env.DB.prepare('SELECT paid_until FROM subscriptions WHERE shop_id = ?').bind(p.shop_id).first();
    const until = extend(subRow?.paid_until ?? null, p.months);
    const res = await env.DB.prepare("UPDATE payments SET status = 'approved', decided_at = ?, note = ? WHERE id = ? AND status = 'pending'")
      .bind(now, clean(x.note, 200), p.id).run();
    if (!(res.meta?.changes)) return fail('Ce paiement a déjà été traité.', 409);
    await env.DB.prepare(
      `INSERT INTO subscriptions (shop_id, paid_until, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(shop_id) DO UPDATE SET paid_until = ?2, updated_at = ?3`).bind(p.shop_id, until, now).run();
    return json({ ok: true, paidUntil: until });
  }
  if (sub === 'grant' && m === 'POST') {
    const x = await readBody(req, 1_000);
    const shopId = clean(x.shopId, 60), months = int(x.months, 1, 36, 0);
    if (!months) return fail('Durée invalide.');
    const shop: any = await env.DB.prepare('SELECT shop_id FROM shops WHERE shop_id = ?').bind(shopId).first();
    if (!shop) return fail('Boutique introuvable.', 404);
    const cur: any = await env.DB.prepare('SELECT paid_until FROM subscriptions WHERE shop_id = ?').bind(shopId).first();
    const until = extend(cur?.paid_until ?? null, months), now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO subscriptions (shop_id, paid_until, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(shop_id) DO UPDATE SET paid_until = ?2, updated_at = ?3`).bind(shopId, until, now).run();
    return json({ ok: true, paidUntil: until });
  }
  if (sub === 'shop') {
    const shopOf = async (id: string) => env.DB.prepare('SELECT shop_id FROM shops WHERE shop_id = ?').bind(id).first();
    const view = async (id: string) => {
      const cfg = await loadBilling(env);
      const st = await planStatus(env, id, cfg);
      const blockedRow = await env.DB.prepare('SELECT 1 AS x FROM app_settings WHERE key = ?').bind('shop_block:' + id).first();
      const subRow: any = await env.DB.prepare('SELECT paid_until FROM subscriptions WHERE shop_id = ?').bind(id).first();
      return { billingEnabled: cfg.enabled, status: st, blocked: !!blockedRow, paidUntil: subRow?.paid_until ?? null };
    };
    if (m === 'GET' && parts[3]) {
      const id = clean(parts[3], 60);
      if (!(await shopOf(id))) return fail('Boutique introuvable.', 404);
      return json(await view(id));
    }
    if (m === 'POST') {
      const x = await readBody(req, 1_000);
      const id = clean(x.shopId, 60), action = x.action, now = new Date().toISOString();
      if (!(await shopOf(id))) return fail('Boutique introuvable.', 404);
      if (action === 'activate') {
        const cur: any = await env.DB.prepare('SELECT paid_until FROM subscriptions WHERE shop_id = ?').bind(id).first();
        const until = extend(cur?.paid_until ?? null, 12);
        await env.DB.prepare(
          `INSERT INTO subscriptions (shop_id, paid_until, updated_at) VALUES (?1, ?2, ?3)
           ON CONFLICT(shop_id) DO UPDATE SET paid_until = ?2, updated_at = ?3`).bind(id, until, now).run();
      } else if (action === 'revoke') {
        await env.DB.prepare(
          `INSERT INTO subscriptions (shop_id, paid_until, updated_at) VALUES (?1, ?2, ?2)
           ON CONFLICT(shop_id) DO UPDATE SET paid_until = ?2, updated_at = ?2`).bind(id, now).run();
      } else if (action === 'block') {
        await env.DB.prepare('INSERT INTO app_settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2').bind('shop_block:' + id, '1').run();
      } else if (action === 'unblock') {
        await env.DB.prepare('DELETE FROM app_settings WHERE key = ?').bind('shop_block:' + id).run();
      } else return fail('Action invalide.');
      return json(await view(id));
    }
  }
  return fail('Route inconnue.', 404);
}

/** Boutique en lecture seule ? (essai terminé, sans abonnement, option activée par l'administrateur) */
export async function isReadOnly(env: Env, shopId: string, isAdmin = false): Promise<boolean> {
  if (isAdmin) return false;
  const b = await loadBilling(env);
  if (!b.enabled) return false;
  return (await planStatus(env, shopId, b)).readOnly;
}
