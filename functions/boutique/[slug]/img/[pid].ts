// Photo publique d'un produit du catalogue : /boutique/<adresse>/img/<idProduit>
// Une copie est gardée 1 h dans le cache Cloudflare pour ne pas relire la base à chaque affichage.
import { servePublicImage } from '../../../_lib/catalog';
import type { Env } from '../../../_lib/util';

export const onRequestGet: PagesFunction<Env> = async ({ env, params, request, waitUntil }) => {
  try {
    const url = new URL(request.url);
    const cache = (globalThis as any).caches?.default as Cache | undefined;
    const key = new Request(url.toString(), { method: 'GET' });
    const hit = await cache?.match(key);
    if (hit) return hit;
    const res = await servePublicImage(env, String(params.slug || ''), String(params.pid || ''), url);
    if (cache && res.status === 200) {
      const copy = new Response(res.clone().body, res);
      copy.headers.set('Cache-Control', 'public, max-age=3600');
      waitUntil(cache.put(key, copy));
    }
    return res;
  } catch { return new Response('Indisponible', { status: 503 }); }
};
