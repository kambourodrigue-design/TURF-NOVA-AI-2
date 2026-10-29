// Assistant IA (Cloudflare Workers AI — gratuit jusqu'à 10 000 « neurones » par jour pour tout le compte).
// Principe : l'application calcule les chiffres (résumé compact) ; l'IA se contente de les expliquer.
// Protection du quota gratuit : limite par boutique et par jour + limite globale par jour.

import { planStatus, loadBilling } from './billing';
import { json, fail, readBody, shopRoleOf, type Env, type UserRow } from './util';

const DEFAULT_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8-fast';
const MAX_SUMMARY = 6000;
const MAX_QUESTION = 500;

const SYSTEM = `Tu es l'assistant d'une petite boutique en Afrique de l'Ouest (application Nafora).
Règles strictes :
- Réponds en français simple, chaleureux et direct, en 120 mots maximum.
- Utilise UNIQUEMENT les chiffres du RÉSUMÉ fourni. N'invente jamais un chiffre, un produit ou un client.
- Si l'information demandée n'est pas dans le résumé, dis-le franchement.
- Les montants sont en francs CFA (ou la devise indiquée). Écris les montants avec des espaces (ex : 125 000 F).
- Donne des conseils concrets et prudents. Tu n'es pas un conseiller financier ou juridique.`;

const clean = (v: unknown, max: number) =>
  String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);

const day = () => new Date().toISOString().slice(0, 10);

/** Incrémente un compteur journalier ; renvoie le total après incrément. */
async function bump(env: Env, key: string, delta = 1): Promise<number> {
  const row = await env.DB.prepare(
    `INSERT INTO login_attempts (key, count, window_start) VALUES (?1, MAX(0, ?3), ?2)
     ON CONFLICT(key) DO UPDATE SET count = MAX(0, count + ?3) RETURNING count`)
    .bind(key, Math.floor(Date.now() / 1000), delta).first<{ count: number }>();
  return row?.count ?? 0;
}

export function buildMessages(body: any): { messages: Array<{ role: string; content: string }>; maxTokens: number } {
  const mode = body?.mode;
  if (mode === 'reminder') {
    const name = clean(body.firstName, 40) || 'cher client';
    const amount = clean(body.amount, 30);
    const shop = clean(body.shopName, 60);
    const owner = clean(body.ownerName, 60);
    const pay = clean(body.payPhone, 30);
    const due = clean(body.dueDate, 30);
    const tone = body.tone === 'ferme' ? 'plus ferme mais toujours poli' : 'amical et respectueux';
    return {
      maxTokens: 220,
      messages: [
        { role: 'system', content: 'Tu rédiges des messages WhatsApp courts en français pour un commerçant d\'Afrique de l\'Ouest. Réponds uniquement par le message, sans guillemets ni explication, 70 mots maximum, avec 1 ou 2 emojis au plus. N\'invente aucun fait.' },
        { role: 'user', content: `Rédige un message de rappel de paiement, ton ${tone}.\nClient : ${name}\nMontant dû : ${amount}\nBoutique : ${shop}${owner ? ` (${owner})` : ''}\n${due ? `Échéance convenue : ${due}\n` : ''}${pay ? `Paiement possible par Mobile Money au : ${pay}\n` : ''}` },
      ],
    };
  }
  if (mode === 'sale') {
    const said = clean(body.utterance, 300);
    if (!said) throw new Error('Phrase manquante.');
    const names = (Array.isArray(body.products) ? body.products : []).slice(0, 200)
      .map((n: unknown) => clean(n, 60)).filter(Boolean);
    return {
      maxTokens: 260,
      messages: [
        { role: 'system', content: 'Tu extrais une vente à partir d\'une phrase dite à voix haute par un commerçant (français d\'Afrique de l\'Ouest, parfois approximatif). Réponds UNIQUEMENT par un objet JSON valide, sans texte autour, de la forme {"items":[{"name":"<nom EXACT copié de la liste>","qty":<nombre>}],"payment":"cash|credit|mobile|null","customer":"<prénom ou null>"}. N\'utilise que des noms de la liste. Si un article n\'est pas dans la liste, ignore-le. "à crédit", "il paiera plus tard", "sur le carnet" => payment "credit". "Wave", "Orange Money", "momo", "mobile money" => "mobile". Quantité par défaut : 1.' },
        { role: 'user', content: `LISTE DES PRODUITS :\n${names.join('\n')}\n\nPHRASE : ${said}` },
      ],
    };
  }
  const summary = clean(body?.summary, MAX_SUMMARY);
  if (!summary) throw new Error('Résumé manquant.');
  if (mode === 'advice') {
    return {
      maxTokens: 380,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `RÉSUMÉ DE LA BOUTIQUE :\n${summary}\n\nDonne 3 conseils concrets et prioritaires pour AUJOURD'HUI (réapprovisionnement, créances à relancer, dettes fournisseurs, trésorerie, produits à pousser). Une ligne par conseil, numérotés, en t'appuyant sur les chiffres.` },
      ],
    };
  }
  const q = clean(body?.question, MAX_QUESTION);
  if (!q) throw new Error('Question manquante.');
  return {
    maxTokens: 350,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `RÉSUMÉ DE LA BOUTIQUE :\n${summary}\n\nQUESTION : ${q}` },
    ],
  };
}

export async function handleAi(req: Request, env: Env, user: UserRow) {
  if (!env.AI) return fail("L'assistant IA n'est pas encore activé sur ce site (liaison « AI » manquante).", 503);
  const cashier = shopRoleOf(user) === 'cashier';

  const body = await readBody(req, 12_000);
  if (!['ask', 'advice', 'reminder', 'sale'].includes(body?.mode)) return fail('Demande invalide.');
  const isSale = body.mode === 'sale';
  if (cashier && !isSale) return fail("L'assistant est réservé au propriétaire et au gérant.", 403);
  let built;
  try { built = buildMessages(body); } catch (e: any) { return fail(e.message || 'Demande invalide.'); }

  const d = day();
  let shopLimit = isSale
    ? Math.max(1, parseInt(env.AI_DAILY_SALE || '60', 10) || 60)
    : Math.max(1, parseInt(env.AI_DAILY_SHOP || '15', 10) || 15);
  if (!isSale) {   // plan gratuit (facturation activée, essai terminé, pas d'abonnement) : moins de questions par jour
    const cfg = await loadBilling(env);
    const st = await planStatus(env, user.shop_id, cfg, user.role === 'admin');
    if (st.enforced && !st.pro) shopLimit = Math.max(0, Math.min(shopLimit, cfg.freeAiPerDay));
  }
  const globalLimit = Math.max(1, parseInt(env.AI_DAILY_GLOBAL || '400', 10) || 400);
  const gKey = `ai:g:${d}`;
  const sKey = `ai:s:${user.shop_id}:${isSale ? 'v:' : ''}${d}`;

  const g = await bump(env, gKey);
  if (g > globalLimit) {
    await bump(env, gKey, -1);
    return fail("Limite gratuite de l'assistant atteinte pour aujourd'hui sur toute la plateforme. Réessayez demain.", 429);
  }
  const s = await bump(env, sKey);
  if (s > shopLimit) {
    await bump(env, sKey, -1); await bump(env, gKey, -1);
    return fail(`Vous avez utilisé vos ${shopLimit} questions gratuites du jour. Revenez demain${shopLimit < 15 && !isSale ? ' ou passez au plan Pro (Paramètres → Abonnement).' : '.'}`, 429);
  }

  try {
    const out = await env.AI.run(env.AI_MODEL || DEFAULT_MODEL, { messages: built.messages, max_tokens: built.maxTokens });
    const text = clean(out?.response ?? out?.result?.response ?? '', 1500).replace(/\s{3,}/g, '\n\n');
    if (!text) throw new Error('Réponse vide');
    if (Math.random() < 0.05) {
      await env.DB.prepare(`DELETE FROM login_attempts WHERE key LIKE 'ai:%' AND window_start < ?1`)
        .bind(Math.floor(Date.now() / 1000) - 3 * 86400).run();
    }
    if (isSale) {
      const m = text.match(/\{[\s\S]*\}/);
      let parsed: any = null;
      try { parsed = m ? JSON.parse(m[0]) : null; } catch { /* JSON invalide */ }
      if (!parsed || !Array.isArray(parsed.items)) throw new Error('Réponse illisible');
      const items = parsed.items.slice(0, 20).map((i: any) => ({ name: clean(i?.name, 60), qty: Math.min(9999, Math.max(1, Number(i?.qty) || 1)) })).filter((i: any) => i.name);
      const pay = ['cash', 'credit', 'mobile'].includes(parsed.payment) ? parsed.payment : null;
      return json({ parsed: { items, payment: pay, customer: clean(parsed.customer, 40) || null }, remaining: Math.max(0, shopLimit - s) });
    }
    return json({ text, remaining: Math.max(0, shopLimit - s) });
  } catch (e: any) {
    await bump(env, sKey, -1); await bump(env, gKey, -1); // l'échec ne consomme pas la limite
    const msg = String(e?.message || '');
    if (/limit|quota|capacity|10000|neuron/i.test(msg)) {
      return fail("Quota gratuit de l'IA épuisé pour aujourd'hui. Réessayez demain.", 429);
    }
    return fail("L'assistant est momentanément indisponible. Réessayez dans un instant.", 503);
  }
}
