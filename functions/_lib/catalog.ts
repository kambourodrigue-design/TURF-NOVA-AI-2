// Catalogue public de la boutique : une page web (sans connexion) listant les produits en stock,
// avec photos et commande par WhatsApp. Réglages dans app_settings (aucune migration SQL) :
//   catalog_cfg:<shopId> = {slug, on, intro}     catalog_slug:<slug> = shopId

import { json, fail, readBody, shopRoleOf, type Env, type UserRow } from './util';
import { imageResponse, readImage, PID_RE } from './images';

export interface CatalogCfg { slug: string; on: boolean; intro: string }
const clean = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ').trim().slice(0, n);
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/;

async function getKey(env: Env, key: string): Promise<string | null> {
  try { const r: any = await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first(); return r?.value ?? null; }
  catch { return null; }
}
const putKey = (env: Env, key: string, value: string) =>
  env.DB.prepare('INSERT INTO app_settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2').bind(key, value).run();

export async function loadCatalogCfg(env: Env, shopId: string): Promise<CatalogCfg> {
  const raw = await getKey(env, 'catalog_cfg:' + shopId);
  try { if (raw) return { slug: '', on: false, intro: '', ...JSON.parse(raw) }; } catch { /* ignore */ }
  return { slug: '', on: false, intro: '' };
}

export async function myCatalog(env: Env, user: UserRow) {
  if (shopRoleOf(user) === 'cashier') return fail('Accès refusé.', 403);
  return json(await loadCatalogCfg(env, user.shop_id));
}

export async function saveCatalog(req: Request, env: Env, user: UserRow) {
  if (shopRoleOf(user) !== 'owner') return fail('Réservé au propriétaire de la boutique.', 403);
  const x = await readBody(req, 3_000);
  const cur = await loadCatalogCfg(env, user.shop_id);
  const slug = clean(x.slug, 40).toLowerCase();
  const on = !!x.on;
  if (!SLUG_RE.test(slug)) return fail('Adresse invalide : 3 à 30 caractères, lettres minuscules, chiffres et tirets.');
  const owner = await getKey(env, 'catalog_slug:' + slug);
  if (owner && owner !== user.shop_id) return fail('Cette adresse est déjà prise, choisissez-en une autre.', 409);
  const next: CatalogCfg = { slug, on, intro: clean(x.intro, 200) };
  await putKey(env, 'catalog_slug:' + slug, user.shop_id);
  if (cur.slug && cur.slug !== slug) {
    const old = await getKey(env, 'catalog_slug:' + cur.slug);
    if (old === user.shop_id) await env.DB.prepare('DELETE FROM app_settings WHERE key = ?').bind('catalog_slug:' + cur.slug).run();
  }
  await putKey(env, 'catalog_cfg:' + user.shop_id, JSON.stringify(next));
  return json(next);
}

/* ---------- Photos publiques ---------- */
export async function servePublicImage(env: Env, slugRaw: string, pid: string, url: URL, waitUntil?: (p: Promise<unknown>) => void): Promise<Response> {
  const slug = String(slugRaw || '').toLowerCase();
  if (!SLUG_RE.test(slug) || !PID_RE.test(pid)) return new Response('Introuvable', { status: 404 });
  const shopId = await getKey(env, 'catalog_slug:' + slug);
  if (!shopId) return new Response('Introuvable', { status: 404 });
  const cfg = await loadCatalogCfg(env, shopId);
  if (!cfg.on || cfg.slug !== slug) return new Response('Introuvable', { status: 404 });
  const img = await readImage(env, shopId, pid);
  if (!img) return new Response('Introuvable', { status: 404 });
  return imageResponse(img, url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'public, max-age=600');
}

/* ---------- Page publique ---------- */
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fmtNum = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n)).replace(/[\u202f\u00a0]/g, ' ');
const money = (n: number, cur: string) => cur === 'EUR' ? `${fmtNum(n)} €` : cur === 'USD' ? `$${fmtNum(n)}` : cur === 'GNF' ? `${fmtNum(n)} GNF` : `${fmtNum(n)} F CFA`;

const CSS = `
:root{--bg:#f5f8ff;--card:#fff;--bd:#dce3f2;--tx:#111b40;--mu:#64729a;--pr:#1a4bd1;--pr2:#2f6bff;--gold:#ffbf1f;--soft:#eef4ff;--sh:0 6px 24px rgba(11,31,102,.08);color-scheme:light}
@media(prefers-color-scheme:dark){:root{--bg:#050b24;--card:#0f1b47;--bd:#22346f;--tx:#eef3ff;--mu:#93a3ce;--pr:#2f6bff;--pr2:#5c8cff;--soft:#14235f;--sh:0 6px 24px rgba(0,0,0,.35);color-scheme:dark}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}[hidden]{display:none!important}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--tx);line-height:1.45}
a{color:inherit}.wrap{max-width:1040px;margin:0 auto;padding:0 14px}
.hero{background:radial-gradient(900px 300px at 85% -10%,rgba(255,191,31,.28),transparent 60%),linear-gradient(160deg,#060f3d 0%,#0b1f66 55%,#1a4bd1 135%);color:#fff;padding:26px 0 30px}
.brand{display:flex;align-items:center;gap:14px}.av{width:60px;height:60px;border-radius:18px;background:linear-gradient(135deg,#ffbf1f,#f5a800);color:#0b1f66;font-weight:900;font-size:28px;display:flex;align-items:center;justify-content:center;flex:none;box-shadow:0 6px 18px rgba(0,0,0,.25)}
h1{margin:0;font-size:clamp(22px,5vw,32px);line-height:1.15;letter-spacing:-.01em}.loc{margin:3px 0 0;font-size:14px;color:#bcd1ff}
.intro{margin:14px 0 0;font-size:15.5px;color:#e6eeff;max-width:640px}
.cta{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}.btn{display:inline-flex;align-items:center;gap:8px;padding:12px 18px;border-radius:14px;font-weight:800;font-size:15px;text-decoration:none;border:0;cursor:pointer}
.cta .btn{flex:1 1 auto;justify-content:center}.btn.wa{background:#22c55e;color:#06210f}.btn.gh{background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.28)}
.pills{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.pills span{font-size:12.5px;padding:5px 10px;border-radius:999px;background:rgba(255,255,255,.1);color:#dbe7ff;border:1px solid rgba(255,255,255,.16)}
.tools{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--bd);padding:10px 0}
.search{width:100%;padding:12px 14px 12px 40px;border:1px solid var(--bd);border-radius:14px;font-size:16px;background:var(--card) url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%2364729a' stroke-width='2.4' stroke-linecap='round'><circle cx='11' cy='11' r='7'/><path d='m20 20-3.5-3.5'/></svg>") no-repeat 13px center;color:var(--tx)}
.chips{display:flex;gap:8px;overflow-x:auto;padding:10px 0 2px;scrollbar-width:none}.chips::-webkit-scrollbar{display:none}
.chip{flex:none;padding:7px 14px;border-radius:999px;border:1px solid var(--bd);background:var(--card);color:var(--tx);font-size:13.5px;font-weight:700;cursor:pointer}.chip.on{background:var(--pr);border-color:var(--pr);color:#fff}
main{padding:6px 0 130px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--mu);margin:22px 2px 10px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}@media(min-width:640px){.grid{grid-template-columns:repeat(3,1fr)}}@media(min-width:900px){.grid{grid-template-columns:repeat(4,1fr)}}
.card{background:var(--card);border:1px solid var(--bd);border-radius:18px;overflow:hidden;display:flex;flex-direction:column;box-shadow:var(--sh)}
.ph{aspect-ratio:1/1;background:var(--soft);position:relative;overflow:hidden}.ph img{width:100%;height:100%;object-fit:cover;display:block;cursor:zoom-in}
.ph .em{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:44px;font-weight:900;color:var(--pr);opacity:.35}
.inf{padding:10px 12px 12px;display:flex;flex-direction:column;gap:6px;flex:1}.nm{font-weight:700;font-size:14.5px;line-height:1.25;overflow-wrap:anywhere}
.pr{font-weight:900;font-size:16px;color:var(--pr)}.pr small{font-weight:500;color:var(--mu);font-size:12px}
.ctl{margin-top:auto}.add{width:100%;padding:10px;border-radius:12px;border:0;background:var(--pr);color:#fff;font-weight:800;font-size:14px;cursor:pointer}
.st{display:flex;align-items:center;justify-content:space-between;background:var(--soft);border-radius:12px;padding:3px}.st button{width:38px;height:38px;border-radius:10px;border:0;background:var(--card);color:var(--tx);font-size:20px;font-weight:800;cursor:pointer}.st b{min-width:24px;text-align:center}
.none,.empty{text-align:center;color:var(--mu);padding:46px 10px}
#bar{position:fixed;left:0;right:0;bottom:0;z-index:30;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:var(--card);border-top:1px solid var(--bd);box-shadow:0 -8px 24px rgba(0,0,0,.12)}
#bar button{display:flex;width:100%;max-width:1012px;margin:0 auto;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-radius:16px;border:0;background:var(--pr);color:#fff;font-weight:800;font-size:15.5px;cursor:pointer}
#ov{position:fixed;inset:0;background:rgba(2,6,23,.6);z-index:40}#sh{position:fixed;left:0;right:0;bottom:0;z-index:41;background:var(--card);border-radius:22px 22px 0 0;max-height:88vh;overflow:auto;padding:16px 16px calc(16px + env(safe-area-inset-bottom));max-width:640px;margin:0 auto}
#sh h3{margin:0 0 8px;font-size:18px}.ln{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--bd)}.ln .t{flex:1;min-width:0;font-weight:700;font-size:14px;overflow-wrap:anywhere}.ln .t small{display:block;color:var(--mu);font-weight:500}
.ln .st{width:112px}.ln .st button{width:32px;height:32px}.tot{display:flex;justify-content:space-between;font-size:17px;font-weight:900;padding:14px 2px}
.fld{width:100%;padding:12px;border:1px solid var(--bd);border-radius:12px;font-size:16px;background:var(--bg);color:var(--tx);margin-top:8px;font-family:inherit}
.send{display:block;width:100%;margin-top:12px;padding:15px;border-radius:14px;border:0;background:#22c55e;color:#06210f;font-weight:900;font-size:16px;text-align:center;text-decoration:none;cursor:pointer}.clr{display:block;margin:10px auto 0;background:none;border:0;color:var(--mu);font-size:13px;cursor:pointer}
#lb{position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:50;display:flex;align-items:center;justify-content:center;padding:14px}#lb img{max-width:100%;max-height:100%;border-radius:14px}
footer{text-align:center;font-size:12.5px;color:var(--mu);padding:8px 14px 34px}footer a{color:var(--pr2);font-weight:700;text-decoration:none}
`;

const page = (status: number, title: string, body: string, extraHead = '') =>
  new Response(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0b1f66"><title>${esc(title)}</title>${extraHead}<link rel="icon" href="/favicon.png"><style>${CSS}</style></head><body>${body}</body></html>`, {
    status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': status === 200 ? 'public, max-age=60' : 'no-store' },
  });

const EMOJI: Array<[RegExp, string]> = [
  [/boisson|jus|eau|soda/i, '🥤'], [/aliment|épicerie|epicerie|riz|céréale/i, '🛒'], [/vêt|vet|mode|habit/i, '👕'], [/cosm|beauté|beaute|soin/i, '💄'],
  [/pharma|santé|sante/i, '💊'], [/électr|electr|phone|télé/i, '📱'], [/quincaill|bricol|outil/i, '🔧'], [/légume|legume|fruit|marché/i, '🥬'],
];
const catEmoji = (c: string) => (EMOJI.find(([re]) => re.test(c)) || [null, '🛍️'])[1];

export async function renderCatalog(env: Env, slugRaw: string, origin = ''): Promise<Response> {
  const notFound = () => page(404, 'Boutique introuvable', '<main class="wrap"><div class="empty"><h1>Boutique introuvable</h1><p>Ce lien n\'est plus actif.</p></div></main>', '<meta name="robots" content="noindex">');
  const slug = String(slugRaw || '').toLowerCase();
  if (!SLUG_RE.test(slug)) return notFound();
  const shopId = await getKey(env, 'catalog_slug:' + slug);
  if (!shopId) return notFound();
  const cfg = await loadCatalogCfg(env, shopId);
  if (!cfg.on || cfg.slug !== slug) return notFound();

  const shop: any = await env.DB.prepare('SELECT settings FROM shops WHERE shop_id = ?').bind(shopId).first();
  let st: any = {}; try { st = JSON.parse(shop?.settings || '{}'); } catch { /* ignore */ }
  const rows = (await env.DB.prepare("SELECT json FROM records WHERE shop_id = ? AND kind = 'products' AND deleted = 0 LIMIT 600").bind(shopId).all<any>()).results;
  const photos: Record<string, number> = {};
  try { for (const r of (await env.DB.prepare('SELECT product_id, updated_at FROM product_images WHERE shop_id = ?').bind(shopId).all<any>()).results) photos[r.product_id] = r.updated_at; }
  catch { /* table v8 absente : catalogue sans photos */ }

  const cur = String(st.currency || 'XOF');
  const items = rows.map((r) => { try { return JSON.parse(r.json); } catch { return null; } })
    .filter((p: any) => p && p.name && Number(p.sellingPrice) > 0 && Number(p.stockQuantity) > 0)
    .sort((a: any, b: any) => String(a.category).localeCompare(String(b.category), 'fr') || String(a.name).localeCompare(String(b.name), 'fr'));

  const rawPhone = String(st.phone || '');
  const phone = rawPhone.replace(/\D/g, '');
  const canOrder = phone.length >= 8;
  const shopName = String(st.shopName || 'Boutique');
  const place = [st.city, st.country].filter(Boolean).join(', ');
  const initial = esc(shopName.trim().charAt(0).toUpperCase() || 'N');
  const imgUrl = (p: any) => `/boutique/${slug}/img/${encodeURIComponent(String(p.id))}?v=${photos[String(p.id)]}`;
  const cats: string[] = [];
  const groups = new Map<string, any[]>();
  for (const p of items) { const k = String(p.category || 'Produits'); if (!groups.has(k)) { groups.set(k, []); cats.push(k); } groups.get(k)!.push(p); }

  let list = '', idx = 0;
  const data: any[] = [];
  for (const [cat, ps] of groups) {
    list += `<section class="sec"><h2>${catEmoji(cat)} ${esc(cat)}</h2><div class="grid">`;
    for (const p of ps) {
      const has = !!photos[String(p.id)];
      list += `<article class="card" data-i="${idx}" data-name="${esc(String(p.name).toLowerCase())}" data-cat="${esc(cat)}">
<div class="ph">${has ? `<img loading="lazy" decoding="async" width="400" height="400" src="${esc(imgUrl(p))}" alt="${esc(p.name)}" data-full="1">` : `<div class="em">${esc(String(p.name).trim().charAt(0).toUpperCase())}</div>`}</div>
<div class="inf"><div class="nm">${esc(p.name)}</div><div class="pr">${esc(money(Number(p.sellingPrice), cur))} <small>/ ${esc(p.unit || 'pièce')}</small></div>${canOrder ? '<div class="ctl"></div>' : ''}</div></article>`;
      data.push({ n: String(p.name), p: Math.round(Number(p.sellingPrice)), u: String(p.unit || 'pièce') });
      idx++;
    }
    list += '</div></section>';
  }
  const dataJson = JSON.stringify(data).replace(/</g, '\\u003c').replace(new RegExp('[\\u2028\\u2029]', 'g'), '');
  const firstPhoto = items.find((p: any) => photos[String(p.id)]);
  const ogImg = origin ? (firstPhoto ? origin + imgUrl(firstPhoto) : origin + '/og-image.png') : '';
  const desc = cfg.intro || `Catalogue de ${shopName} : produits disponibles et prix. Commandez par WhatsApp.`;
  const head = `<meta name="description" content="${esc(desc)}"><meta property="og:title" content="${esc(shopName)} — catalogue en ligne"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="website">${ogImg ? `<meta property="og:image" content="${esc(ogImg)}"><meta name="twitter:card" content="summary_large_image">` : ''}`;
  const tel = rawPhone.replace(/[^\d+]/g, '');
  const waHello = `https://wa.me/${phone}?text=${encodeURIComponent(`Bonjour ${shopName}, je consulte votre catalogue.`)}`;

  const body = `<header class="hero"><div class="wrap">
<div class="brand"><div class="av" aria-hidden="true">${initial}</div><div><h1>${esc(shopName)}</h1>${place ? `<p class="loc">📍 ${esc(place)}</p>` : ''}</div></div>
${cfg.intro ? `<p class="intro">${esc(cfg.intro)}</p>` : ''}
${canOrder ? `<div class="cta"><a class="btn wa" href="${esc(waHello)}" rel="noopener">💬 Écrire sur WhatsApp</a>${tel.length >= 8 ? `<a class="btn gh" href="tel:${esc(tel)}">📞 Appeler</a>` : ''}</div>` : ''}
<div class="pills"><span>✔ ${items.length} produit${items.length > 1 ? 's' : ''} disponible${items.length > 1 ? 's' : ''}</span>${canOrder ? '<span>💬 Commande en un appui</span>' : ''}<span>🕒 Prix à jour</span></div>
</div></header>
<div class="tools"><div class="wrap"><input class="search" id="q" type="search" placeholder="Rechercher un produit…" aria-label="Rechercher">
${cats.length > 1 ? `<div class="chips" id="chips"><button class="chip on" data-c="">Tout</button>${cats.map((c) => `<button class="chip" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}</div></div>
<main class="wrap">${items.length ? list : '<div class="empty">Aucun produit disponible pour le moment.</div>'}<div class="none" id="none" hidden>Aucun produit ne correspond à votre recherche.</div></main>
${canOrder ? `<div id="bar" hidden><button id="open"><span id="cnt"></span><span id="tt"></span></button></div>
<div id="ov" hidden></div><div id="sh" hidden role="dialog" aria-modal="true" aria-label="Ma commande"><h3>🛒 Ma commande</h3><div id="lines"></div><div class="tot"><span>Total</span><span id="sum"></span></div>
<input class="fld" id="nm" maxlength="60" placeholder="Votre nom (facultatif)" autocomplete="name"><textarea class="fld" id="nt" rows="2" maxlength="200" placeholder="Précisions : livraison, heure de passage… (facultatif)"></textarea>
<a class="send" id="go" href="#" rel="noopener">Envoyer la commande sur WhatsApp</a><button class="clr" id="clr">Vider la commande</button></div>` : ''}
<div id="lb" hidden><img alt=""></div>
<footer>Catalogue propulsé par <a href="/">Nafora</a> — <a href="/">créez votre boutique en ligne</a></footer>
<script>(function(){var D=${dataJson},C={},SHOP=${JSON.stringify(shopName).replace(/</g, '\\u003c')},PH=${JSON.stringify(phone)},CUR=${JSON.stringify(cur)},CAN=${canOrder ? 'true' : 'false'};
function f(n){var s=String(Math.round(n)).replace(/\\B(?=(\\d{3})+(?!\\d))/g,' ');return CUR==='EUR'?s+' €':CUR==='USD'?'$'+s:CUR==='GNF'?s+' GNF':s+' F CFA'}
function $(s){return document.querySelector(s)}function $$(s,r){return [].slice.call((r||document).querySelectorAll(s))}
var cards=$$('.card'),q=$('#q'),cat='';
function filter(){var v=q.value.toLowerCase().trim(),n=0;cards.forEach(function(e){var ok=(!v||e.getAttribute('data-name').indexOf(v)>-1)&&(!cat||e.getAttribute('data-cat')===cat);e.hidden=!ok;if(ok)n++});$$('.sec').forEach(function(s){s.hidden=!$$('.card:not([hidden])',s).length});$('#none').hidden=n>0||!cards.length}
q.addEventListener('input',filter);
$$('.chip').forEach(function(b){b.onclick=function(){cat=b.getAttribute('data-c');$$('.chip').forEach(function(x){x.classList.toggle('on',x===b)});filter()}});
function stp(i,small){return '<div class="st"><button data-m="'+i+'" aria-label="Retirer">−</button><b>'+C[i]+'</b><button data-p="'+i+'" aria-label="Ajouter">+</button></div>'}
function upd(){if(!CAN)return;var n=0,t=0,h='',m=['Bonjour '+SHOP+', je souhaite commander :'];
cards.forEach(function(e){var i=e.getAttribute('data-i'),c=e.querySelector('.ctl');c.innerHTML=C[i]?stp(i):'<button class="add" data-p="'+i+'">Ajouter</button>'});
for(var i in C){var k=C[i];if(k>0){n+=k;t+=k*D[i].p;m.push('- '+k+' x '+D[i].n+' ('+f(D[i].p)+')');h+='<div class="ln"><div class="t">'+esc(D[i].n)+'<small>'+f(D[i].p)+' / '+esc(D[i].u)+'</small></div>'+stp(i)+'</div>'}}
$('#lines').innerHTML=h;$('#sum').textContent=f(t);$('#bar').hidden=!n;$('#cnt').textContent='🛒 '+n+' article'+(n>1?'s':'');$('#tt').textContent=f(t)+'  ›';
if(!n){$('#sh').hidden=true;$('#ov').hidden=true}
m.push('Total : '+f(t));var nm=$('#nm').value.trim(),nt=$('#nt').value.trim();if(nm)m.push('Nom : '+nm);if(nt)m.push('Note : '+nt);
$('#go').href='https://wa.me/'+PH+'?text='+encodeURIComponent(m.join('\\n'))}
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
document.addEventListener('click',function(e){var t=e.target;if(!t.getAttribute)return;var p=t.getAttribute('data-p'),m=t.getAttribute('data-m');
if(p!==null){C[p]=(C[p]||0)+1;upd()}else if(m!==null){C[m]=Math.max(0,(C[m]||0)-1);upd()}
else if(t.getAttribute('data-full')){$('#lb img').src=t.src;$('#lb').hidden=false}
else if(t.id==='lb'||t.closest&&t.closest('#lb')){$('#lb').hidden=true}});
if(CAN){$('#open').onclick=function(){$('#ov').hidden=false;$('#sh').hidden=false};$('#ov').onclick=function(){$('#ov').hidden=true;$('#sh').hidden=true};
$('#clr').onclick=function(){C={};upd()};$('#nm').addEventListener('input',upd);$('#nt').addEventListener('input',upd);upd()}
})();</script>`;
  return page(200, `${shopName} — catalogue en ligne`, body, head);
}
