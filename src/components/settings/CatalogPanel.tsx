import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { usePhotos, loadPhotos } from '../../services/photos';

const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

/** Catalogue public de la boutique : un lien à partager sur WhatsApp, avec les produits en stock et la commande par WhatsApp. */
export const CatalogPanel: React.FC<{ shopName: string }> = ({ shopName }) => {
  const [loaded, setLoaded] = useState(false);
  const [on, setOn] = useState(false); const [slug, setSlug] = useState(''); const [intro, setIntro] = useState('');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const photoCount = Object.keys(usePhotos().map).length;
  useEffect(() => { loadPhotos(); }, []);
  useEffect(() => {
    api.catalog().then((c) => { setOn(c.on); setSlug(c.slug || slugify(shopName)); setIntro(c.intro || ''); setLoaded(true); }).catch(() => { /* hors-ligne : panneau masqué */ });
  }, [shopName]);
  if (!loaded) return null;
  const url = `${location.origin}/boutique/${slug}`;
  const save = async (nextOn: boolean) => {
    setErr(''); setMsg(''); setBusy(true);
    try { const c = await api.catalogSave({ slug: slug.trim().toLowerCase(), on: nextOn, intro: intro.trim() }); setOn(c.on); setSlug(c.slug); setMsg(c.on ? 'Catalogue en ligne ✅' : 'Catalogue désactivé.'); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const wa = `https://wa.me/?text=${encodeURIComponent(`Découvrez mes produits et leurs prix : ${url}`)}`;
  return (
    <div className="pt-2 border-t border-stone-200/80 space-y-2" data-testid="catalog-panel">
      <div className="flex items-center justify-between gap-2"><h4 className="font-bold text-stone-800 text-sm">🛍️ Catalogue en ligne</h4>
        <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${on ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-200 text-stone-700'}`}>{on ? 'En ligne' : 'Désactivé'}</span></div>
      <p className="text-xs text-stone-600">Vos produits en stock et leurs prix sur une page à partager sur WhatsApp. Vos clients choisissent et vous envoient leur commande en un appui. Ni vos prix d'achat ni vos quantités ne sont visibles.</p>
      <p className="text-xs text-stone-600 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2">📷 {photoCount > 0 ? `${photoCount} produit${photoCount > 1 ? 's' : ''} avec photo.` : 'Aucune photo pour le moment.'} Pour en ajouter : onglet Stock → modifier un article → « Ajouter une photo ». Les articles avec photo se vendent mieux.</p>
      <label className="block text-xs font-semibold text-stone-600">Adresse de la page
        <div className="flex items-center mt-1 rounded-xl border border-stone-300 bg-white overflow-hidden"><span className="pl-3 text-xs text-stone-400 whitespace-nowrap">/boutique/</span>
          <input value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} maxLength={30} className="flex-1 min-w-0 px-1 py-2 text-sm outline-none" data-testid="catalog-slug" /></div></label>
      <label className="block text-xs font-semibold text-stone-600">Petit texte d'accueil (facultatif)
        <input value={intro} onChange={e => setIntro(e.target.value)} maxLength={200} placeholder="Ex : Livraison possible dans toute la ville" className="mt-1 w-full px-3 py-2 rounded-xl border border-stone-300 text-sm" /></label>
      {err && <p className="text-xs text-red-700">{err}</p>}{msg && <p className="text-xs text-emerald-700">{msg}</p>}
      <div className="flex gap-2">
        <button onClick={() => save(true)} disabled={busy || slug.length < 3} className="flex-1 py-2 rounded-xl bg-emerald-700 text-white font-bold text-sm disabled:opacity-50" data-testid="catalog-save">{on ? 'Enregistrer' : 'Activer le catalogue'}</button>
        {on && <button onClick={() => save(false)} disabled={busy} className="px-3 py-2 rounded-xl border border-stone-300 text-xs font-bold text-stone-700">Désactiver</button>}
      </div>
      {on && <div className="flex gap-2 text-xs">
        <a href={url} target="_blank" rel="noopener noreferrer" className="flex-1 text-center py-2 rounded-xl border border-stone-300 font-bold">Voir ma page</a>
        <a href={wa} target="_blank" rel="noopener noreferrer" className="flex-1 text-center py-2 rounded-xl bg-green-600 text-white font-bold">Partager sur WhatsApp</a>
        <button onClick={() => { try { navigator.clipboard.writeText(url); setMsg('Lien copié.'); } catch { /* ignore */ } }} className="px-3 py-2 rounded-xl border border-stone-300 font-bold">Copier</button></div>}
    </div>
  );
};
