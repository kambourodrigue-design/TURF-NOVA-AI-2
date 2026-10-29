// /sitemap.xml : pages publiques (adresse du site déduite automatiquement).
export const onRequestGet: PagesFunction = async ({ request }) => {
  const o = new URL(request.url).origin;
  const pages = ['/', '/a-propos.html', '/contact.html', '/confidentialite.html', '/conditions.html'];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    pages.map(p => `  <url><loc>${o}${p}</loc></url>`).join('\n') + `\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
