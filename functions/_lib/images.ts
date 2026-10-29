// Photos des produits, déjà compressées par l'application (≈ 720 px, WebP/JPEG, moins de 130 Ko).
// Stockées dans D1 (table product_images, aucune configuration supplémentaire). Limites par boutique : MAX_PER_SHOP photos.
//   GET    /api/images           → { images: { <idProduit>: <version> }, max }
//   GET    /api/images/<id>      → l'image (propriétaire / équipe connectée)
//   PUT    /api/images/<id>      → envoie l'image (corps binaire image/webp ou image/jpeg)   — pas le caissier
//   DELETE /api/images/<id>      → retire l'image                                            — pas le caissier
// La lecture publique (catalogue) est dans catalog.ts : /boutique/<adresse>/img/<id>

import { json, fail, shopRoleOf, type Env, type UserRow } from './util';

export const MAX_BYTES = 130_000;
export const MAX_PER_SHOP = 200;
export const PID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function toB64(u: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(b: string): Uint8Array {
  const s = atob(b); const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
/** On ne reconnaît que WebP et JPEG (jamais de SVG ni de HTML déguisé en image). */
export function sniff(u: Uint8Array): 'image/webp' | 'image/jpeg' | null {
  if (u.length > 12 && u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46 && u[8] === 0x57 && u[9] === 0x45 && u[10] === 0x42 && u[11] === 0x50) return 'image/webp';
  if (u.length > 3 && u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff) return 'image/jpeg';
  return null;
}
export interface StoredImage { mime: string; v: number; body: Uint8Array }

export async function readImage(env: Env, shopId: string, pid: string): Promise<StoredImage | null> {
  const row: any = await env.DB.prepare('SELECT mime, data, updated_at FROM product_images WHERE shop_id = ? AND product_id = ?').bind(shopId, pid).first();
  if (!row || !row.data) return null;
  return { mime: row.mime, v: row.updated_at, body: fromB64(row.data) };
}
async function storeImage(env: Env, shopId: string, pid: string, mime: string, bytes: Uint8Array, v: number) {
  await env.DB.prepare(
    `INSERT INTO product_images (shop_id, product_id, mime, data, bytes, updated_at) VALUES (?1,?2,?3,?4,?5,?6)
     ON CONFLICT(shop_id, product_id) DO UPDATE SET mime = ?3, data = ?4, bytes = ?5, updated_at = ?6`)
    .bind(shopId, pid, mime, toB64(bytes), bytes.length, v).run();
}
async function dropImage(env: Env, shopId: string, pid: string) {
  await env.DB.prepare('DELETE FROM product_images WHERE shop_id = ? AND product_id = ?').bind(shopId, pid).run();
}

export const imageResponse = (img: StoredImage, cache: string) => {
  const len = { 'Content-Length': String(img.body.length) };
  const v = img.v;
  return new Response(img.body, {
    headers: {
      'Content-Type': img.mime, ...len, 'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff', ETag: `"${v}"`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
};

export async function handleImages(req: Request, env: Env, user: UserRow, parts: string[]): Promise<Response> {
  const m = req.method, pid = parts[1];
  const role = shopRoleOf(user);

  if (!pid) {
    if (m !== 'GET') return fail('Méthode non autorisée.', 405);
    try {
      const rows = (await env.DB.prepare('SELECT product_id, updated_at FROM product_images WHERE shop_id = ?').bind(user.shop_id).all<any>()).results;
      const images: Record<string, number> = {};
      for (const r of rows) images[r.product_id] = r.updated_at;
      return json({ images, max: MAX_PER_SHOP });
    } catch { return json({ images: {}, max: MAX_PER_SHOP, unavailable: true }); }   // table v8 pas encore créée
  }
  if (!PID_RE.test(pid)) return fail('Produit invalide.');

  if (m === 'GET') {
    const img = await readImage(env, user.shop_id, pid);
    if (!img) return fail('Photo introuvable.', 404);
    const versioned = new URL(req.url).searchParams.has('v');
    return imageResponse(img, versioned ? 'private, max-age=31536000, immutable' : 'private, max-age=300');
  }
  if (role === 'cashier') return fail('Accès refusé.', 403);

  if (m === 'DELETE') {
    await dropImage(env, user.shop_id, pid);
    return json({ ok: true });
  }
  if (m === 'PUT') {
    const declared = Number(req.headers.get('Content-Length') || 0);
    if (declared > MAX_BYTES * 1.4) return fail('Photo trop lourde.', 413);
    const buf = new Uint8Array(await req.arrayBuffer());
    if (!buf.length) return fail('Photo vide.');
    if (buf.length > MAX_BYTES) return fail('Photo trop lourde (130 Ko maximum après compression).', 413);
    const mime = sniff(buf);
    if (!mime) return fail('Format non pris en charge (WebP ou JPEG).', 415);
    const have: any = await env.DB.prepare('SELECT COUNT(*) AS n, SUM(product_id = ?2) AS same FROM product_images WHERE shop_id = ?1').bind(user.shop_id, pid).first();
    if (!have?.same && (have?.n ?? 0) >= MAX_PER_SHOP) return fail(`Limite atteinte : ${MAX_PER_SHOP} photos par boutique.`, 409);
    const v = Date.now();
    await storeImage(env, user.shop_id, pid, mime, buf, v);
    return json({ ok: true, v });
  }
  return fail('Méthode non autorisée.', 405);
}
