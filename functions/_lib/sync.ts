// Synchronisation par lots : lecture des changements (pull) et envoi groupé (push).
//
// Principe : chaque modification d'une boutique reçoit un numéro de séquence croissant (seq).
// Un appareil retient le dernier seq reçu (« curseur ») et ne demande plus que ce qui est plus récent.
// Un envoi regroupe jusqu'à 100 modifications en UNE transaction.
//
// Sécurité de la concurrence :
//  - verrou optimiste sur le numéro de séquence de la boutique : si quelqu'un d'autre a écrit entre
//    la lecture et l'écriture, la transaction est annulée et on recommence (fusion refaite) ;
//  - chaque lot a un identifiant : un envoi répété (réponse perdue) n'est jamais appliqué deux fois.

import { isReadOnly } from './billing';
import {
  MAX_CHANGES, SETTINGS_ID, isKind, type Kind,
} from '../../shared/syncCore';
import {
  fail, jsonRaw, shopRoleOf, readBody, HttpError, type Env, type UserRow,
} from './util';
import { mergeChange, contribution, type Change, type DayDelta, type StoredRecord } from './merge';

const PULL_PAGE = 400;

// ---------- PULL ----------
export async function handlePull(req: Request, env: Env, user: UserRow) {
  const url = new URL(req.url);
  const since = Math.max(0, parseInt(url.searchParams.get('since') || '0', 10) || 0);
  let shopId = user.shop_id;
  const other = url.searchParams.get('shop');
  if (other && other !== user.shop_id) {
    if (user.role !== 'admin') return fail('Accès refusé.', 403);
    shopId = other;
  }

  const q = `SELECT kind, id, json, updated_at, deleted, seq FROM records
             WHERE shop_id = ?1 AND seq > ?2 ORDER BY seq ASC, kind ASC, id ASC LIMIT ?3`;
  const rows = (await env.DB.prepare(q).bind(shopId, since, PULL_PAGE + 1).all<any>()).results;

  let page = rows;
  let more = false;
  if (rows.length > PULL_PAGE) {
    more = true;
    // on ne coupe jamais au milieu d'un groupe de même seq (une transaction = un seq)
    const boundary = rows[PULL_PAGE].seq;
    page = rows.filter((r) => r.seq < boundary);
    if (page.length === 0) {
      page = (await env.DB.prepare(
        `SELECT kind, id, json, updated_at, deleted, seq FROM records WHERE shop_id = ?1 AND seq = ?2
         ORDER BY kind ASC, id ASC`).bind(shopId, rows[0].seq).all<any>()).results;
    }
  }
  const cursor = page.length ? page[page.length - 1].seq : since;

  // le JSON stocké est déjà valide : on l'insère tel quel (économise du temps de calcul)
  const items = page.map((r) =>
    `{"k":${JSON.stringify(r.kind)},"id":${JSON.stringify(r.id)},"t":${r.updated_at},` +
    (r.deleted ? `"del":1}` : `"d":${r.json}}`));
  return jsonRaw(`{"changes":[${items.join(',')}],"cursor":${cursor},"more":${more},"now":${Date.now()}}`);
}

// ---------- PUSH ----------
interface Result { k: Kind; id: string; s: 'ok' | 'adopt' | 'denied'; d?: any; del?: 1 }

const UPSERT_RECORDS = `
  INSERT INTO records (shop_id, kind, id, json, updated_at, deleted, seq)
  SELECT ?1, json_extract(v.value,'$.k'), json_extract(v.value,'$.id'), json_extract(v.value,'$.j'),
         json_extract(v.value,'$.t'), json_extract(v.value,'$.x'), ?3
  FROM json_each(?2) v WHERE true
  ON CONFLICT(shop_id, kind, id) DO UPDATE SET
    json = excluded.json, updated_at = excluded.updated_at, deleted = excluded.deleted, seq = excluded.seq`;

const UPSERT_DAILY = `
  INSERT INTO shop_daily (shop_id, day, sales_count, revenue, profit, expenses)
  SELECT ?1, json_extract(v.value,'$.d'), json_extract(v.value,'$.c'), json_extract(v.value,'$.r'),
         json_extract(v.value,'$.p'), json_extract(v.value,'$.e')
  FROM json_each(?2) v WHERE true
  ON CONFLICT(shop_id, day) DO UPDATE SET
    sales_count = sales_count + excluded.sales_count, revenue = revenue + excluded.revenue,
    profit = profit + excluded.profit, expenses = expenses + excluded.expenses`;

const UPSERT_STATS = `
  INSERT INTO shop_stats (shop_id, sales_count, revenue_total, profit_total, expenses_total, last_activity)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6)
  ON CONFLICT(shop_id) DO UPDATE SET
    sales_count = sales_count + excluded.sales_count, revenue_total = revenue_total + excluded.revenue_total,
    profit_total = profit_total + excluded.profit_total, expenses_total = expenses_total + excluded.expenses_total,
    last_activity = excluded.last_activity`;

export async function handlePush(req: Request, env: Env, user: UserRow) {
  const body = await readBody(req, 1_600_000);
  const batchId = typeof body.batch === 'string' && body.batch.length > 0 && body.batch.length <= 80 ? body.batch : '';
  if (!batchId) return fail('Lot invalide.');
  if (!Array.isArray(body.changes)) return fail('Lot invalide.');
  if (body.changes.length > MAX_CHANGES) return fail(`Trop de modifications dans un lot (max ${MAX_CHANGES}).`, 413);

  const shopId = user.shop_id;
  const role = shopRoleOf(user);
  if (await isReadOnly(env, shopId, user.role === 'admin')) return fail("Période d'essai terminée : la boutique est en lecture seule. Le propriétaire doit activer l'abonnement Pro.", 402);

  // Lot déjà appliqué (réponse perdue lors d'un envoi précédent) → on renvoie le même résultat.
  const replay = await readLog(env, batchId, shopId);
  if (replay) return jsonRaw(withNow(replay));

  // Normalisation des modifications reçues (les invalides sont ignorées)
  const changes: Change[] = [];
  const skipped: Result[] = [];
  for (const c of body.changes) {
    if (!c || !isKind(c.k) || typeof c.id !== 'string' || !c.id || c.id.length > 120) continue;
    const ch: Change = { k: c.k, id: c.id, t: Number(c.t), del: c.del ? true : undefined, c: c.c && typeof c.c === 'object' ? c.c : undefined };
    if (!ch.del) {
      if (!c.d || typeof c.d !== 'object' || Array.isArray(c.d)) { skipped.push({ k: c.k, id: c.id, s: 'denied' }); continue; }
      ch.d = c.d;
      if (c.k === 'settings') ch.d.shopId = shopId; // le serveur impose la boutique
    }
    if (c.k === 'settings' && c.id !== SETTINGS_ID) continue;
    changes.push(ch);
  }

  for (let attempt = 0; attempt < 12; attempt++) {
    if (attempt > 0) {
      const done = await readLog(env, batchId, shopId);
      if (done) return jsonRaw(withNow(done));
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 40 * Math.min(attempt, 8)));
    }

    const shop = await env.DB.prepare('SELECT seq FROM shops WHERE shop_id = ?').bind(shopId).first<{ seq: number }>();
    if (!shop) return fail('Boutique introuvable.', 404);

    // Lecture des versions actuelles en UNE requête
    const keys = changes.map((c) => ({ k: c.k, id: c.id }));
    const existing = keys.length === 0 ? [] : (await env.DB.prepare(
      `SELECT r.kind, r.id, r.json, r.updated_at, r.deleted
       FROM json_each(?2) v JOIN records r
         ON r.shop_id = ?1 AND r.kind = json_extract(v.value,'$.k') AND r.id = json_extract(v.value,'$.id')`)
      .bind(shopId, JSON.stringify(keys)).all<any>()).results;
    const working = new Map<string, StoredRecord>();
    for (const r of existing) working.set(r.kind + ':' + r.id, { json: r.json, t: r.updated_at, deleted: !!r.deleted });

    const now = Date.now();
    const results: Result[] = [...skipped];
    const writes = new Map<string, { k: Kind; id: string; j: string; t: number; x: number }>();
    const days = new Map<string, DayDelta>();
    let settingsJson: string | null = null;

    const addDelta = (day: string, v: DayDelta, sign: 1 | -1) => {
      const cur = days.get(day) || { c: 0, r: 0, p: 0, e: 0 };
      cur.c += sign * v.c; cur.r += sign * v.r; cur.p += sign * v.p; cur.e += sign * v.e;
      days.set(day, cur);
    };

    for (const ch of changes) {
      const key = ch.k + ':' + ch.id;
      const stored = working.get(key) || null;
      const out = mergeChange(ch, stored, role, now);

      if (out.write) {
        // retire l'ancienne contribution aux statistiques, ajoute la nouvelle
        if (stored && !stored.deleted) {
          let oldObj: any = null;
          try { oldObj = JSON.parse(stored.json); } catch { /* ignore */ }
          const oc = contribution(ch.k, oldObj, false);
          if (oc) addDelta(oc.day, oc.v, -1);
        }
        if (!out.deleted && out.json) {
          let newObj: any = null;
          try { newObj = JSON.parse(out.json); } catch { /* ignore */ }
          const nc = contribution(ch.k, newObj, false);
          if (nc) addDelta(nc.day, nc.v, 1);
        }
        writes.set(key, { k: ch.k, id: ch.id, j: out.json || '{}', t: out.t, x: out.deleted ? 1 : 0 });
        working.set(key, { json: out.json || '{}', t: out.t, deleted: out.deleted });
        if (ch.k === 'settings' && !out.deleted) settingsJson = out.json;
      }
      const res: Result = { k: ch.k, id: ch.id, s: out.status };
      if (out.reply?.d !== undefined) res.d = out.reply.d;
      if (out.reply?.del) res.del = 1;
      results.push(res);
    }

    if (writes.size === 0) {
      return jsonRaw(JSON.stringify({ results, seq: shop.seq, now: Date.now() }));
    }

    const newSeq = shop.seq + 1;
    const dayRows = [...days.entries()]
      .filter(([, v]) => v.c || v.r || v.p || v.e)
      .map(([d, v]) => ({ d, ...v }));
    let tc = 0, tr = 0, tp = 0, te = 0;
    for (const v of days.values()) { tc += v.c; tr += v.r; tp += v.p; te += v.e; }

    const stmts: D1PreparedStatement[] = [
      // verrou optimiste : échoue (json('x') = erreur) si la boutique a changé depuis la lecture
      env.DB.prepare(`SELECT CASE WHEN (SELECT seq FROM shops WHERE shop_id = ?1) = ?2 THEN 1 ELSE json('x') END`)
        .bind(shopId, shop.seq),
      env.DB.prepare('UPDATE shops SET seq = ?2 WHERE shop_id = ?1').bind(shopId, newSeq),
      env.DB.prepare(UPSERT_RECORDS).bind(shopId, JSON.stringify([...writes.values()]), newSeq),
    ];
    if (dayRows.length) stmts.push(env.DB.prepare(UPSERT_DAILY).bind(shopId, JSON.stringify(dayRows)));
    stmts.push(env.DB.prepare(UPSERT_STATS).bind(shopId, tc, tr, tp, te, new Date(now).toISOString()));
    if (settingsJson) {
      let s: any = {};
      try { s = JSON.parse(settingsJson); } catch { /* ignore */ }
      stmts.push(env.DB.prepare(
        `UPDATE shops SET settings = ?2, shop_name = ?3, category = ?4, city = ?5, country = ?6, formalized = ?7
         WHERE shop_id = ?1`)
        .bind(shopId, settingsJson, String(s.shopName ?? ''), String(s.businessCategory ?? ''),
          String(s.city ?? ''), String(s.country ?? ''), s.isFormalized ? 1 : 0));
    }
    const logJson = JSON.stringify({ results, seq: newSeq });
    stmts.push(env.DB.prepare(
      'INSERT INTO push_log (batch_id, shop_id, created_at, response) VALUES (?1, ?2, ?3, ?4)')
      .bind(batchId, shopId, now, logJson));
    if (Math.random() < 0.05) {
      stmts.push(env.DB.prepare('DELETE FROM push_log WHERE created_at < ?1').bind(now - 3 * 86400000));
    }

    try {
      await env.DB.batch(stmts);
      return jsonRaw(withNow(logJson));
    } catch (e) {
      const cur = await env.DB.prepare('SELECT seq FROM shops WHERE shop_id = ?').bind(shopId).first<{ seq: number }>();
      const conflict = !cur || cur.seq !== shop.seq;
      if (!conflict) throw e;           // vraie erreur (pas un conflit de concurrence)
      // sinon : quelqu'un a écrit entre-temps → on refait la lecture + la fusion
    }
  }
  throw new HttpError('Serveur occupé, réessayez dans un instant.', 503);
}

async function readLog(env: Env, batchId: string, shopId: string): Promise<string | null> {
  const r = await env.DB.prepare('SELECT response FROM push_log WHERE batch_id = ?1 AND shop_id = ?2')
    .bind(batchId, shopId).first<{ response: string }>();
  return r ? r.response : null;
}

/** Ajoute l'heure serveur (pour corriger l'horloge des téléphones mal réglés). */
function withNow(storedJson: string): string {
  return storedJson.slice(0, -1) + `,"now":${Date.now()}}`;
}

