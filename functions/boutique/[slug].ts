// Page publique du catalogue : /boutique/<adresse>
import { renderCatalog } from '../_lib/catalog';
import type { Env } from '../_lib/util';

export const onRequestGet: PagesFunction<Env> = async ({ env, params, request }) => {
  try { return await renderCatalog(env, String(params.slug || ''), new URL(request.url).origin); }
  catch { return new Response('Service momentanément indisponible.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
};
