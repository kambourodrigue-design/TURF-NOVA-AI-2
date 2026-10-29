import React, { useEffect, useState } from 'react';
import { api, MonitorData, BillingAdminSettings, PaymentRow } from '../../services/api';
import { uiConfirm, uiPrompt } from '../common/dialogs';

const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n));
const card = 'bg-white rounded-2xl border border-stone-200 p-4';
const inp = 'w-full px-3 py-2 rounded-xl border border-stone-300 text-sm';
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

/* ============ Surveillance ============ */
export const AdminMonitorPanel: React.FC = () => {
  const [d, setD] = useState<MonitorData | null>(null); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const load = () => api.adminMonitor().then(setD).catch(e => setErr(e.message));
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  if (err) return <p className="text-sm text-red-700">{err} (la migration v5 a-t-elle été exécutée ?)</p>;
  if (!d) return <p className="text-sm text-stone-500">Chargement…</p>;
  const color = d.level === 'green' ? 'bg-emerald-600' : d.level === 'orange' ? 'bg-amber-500' : 'bg-red-600';
  const label = d.level === 'green' ? 'Tout va bien' : d.level === 'orange' ? 'Quelques erreurs ces dernières 24 h' : 'Beaucoup d\'erreurs : à vérifier';
  const max = Math.max(1, ...d.series.map(s => s.n));
  const test = async () => { setMsg(''); try { await api.adminMonitorTest(); setMsg('Alerte de test envoyée sur Telegram.'); } catch (e) { setMsg((e as Error).message); } };
  const clear = async () => { if (await uiConfirm('Vider le journal d\'erreurs ?')) { await api.adminMonitorClear(); load(); } };
  return (
    <div className="space-y-4" data-testid="admin-monitor">
      <div className={`${card} flex items-center gap-3`}><span className={`w-4 h-4 rounded-full ${color}`} /><div><div className="font-black text-stone-900">{label}</div><div className="text-xs text-stone-500">Base de données : {d.dbMs} ms • erreurs 24 h : {d.errors24h} (serveur {d.server24h}, application {d.client24h}) • dernière heure : {d.lastHour}</div></div></div>
      <div className={card}><h4 className="text-sm font-bold text-stone-800">Erreurs par heure (24 h)</h4>
        <div className="flex items-end gap-[2px] h-16 mt-2">{d.series.map(s => <div key={s.h} title={`${s.h}h : ${s.n}`} className="flex-1 rounded-t-sm bg-red-500" style={{ height: `${Math.max(s.n ? 6 : 1, (s.n / max) * 100)}%`, opacity: s.n ? 1 : 0.2 }} />)}</div></div>
      <div className="grid md:grid-cols-2 gap-3">
        <div className={card}><h4 className="text-sm font-bold text-stone-800 mb-2">Erreurs les plus fréquentes</h4>
          {d.top.length === 0 && <p className="text-xs text-stone-400">Aucune erreur.</p>}
          {d.top.map(t => <div key={t.sig + t.source} className="text-xs border-b border-stone-100 py-1.5"><b>{t.n}×</b> <span className="text-stone-500">[{t.source}] {t.route}</span><div className="text-stone-800 break-words">{t.message}</div><div className="text-stone-400">dernière : {when(t.last)}</div></div>)}</div>
        <div className={card}><h4 className="text-sm font-bold text-stone-800 mb-2">État des services</h4>
          <ul className="text-xs space-y-1">
            <li>{d.ai ? '✅' : '⚠️'} Assistant IA {d.ai ? 'activé' : '(liaison « AI » absente)'}</li>
            <li>{d.telegram ? '✅' : '⚠️'} Alertes Telegram {d.telegram ? 'configurées' : 'non configurées (facultatif)'}</li>
            <li>{d.whatsapp ? '✅' : '⚠️'} Numéro WhatsApp d'assistance {d.whatsapp ? 'défini' : '(variable SUPPORT_WHATSAPP)'}</li>
            <li>✅ Adresse de contrôle pour UptimeRobot : <code>/api/health</code></li></ul>
          <div className="flex gap-2 mt-3"><button onClick={test} className="px-3 py-1.5 rounded-xl bg-stone-800 text-white text-xs font-bold">Tester l'alerte Telegram</button><button onClick={clear} className="px-3 py-1.5 rounded-xl border border-stone-300 text-xs font-bold">Vider le journal</button></div>
          {msg && <p className="text-xs mt-2 text-stone-700">{msg}</p>}</div>
      </div>
      <div className={card}><h4 className="text-sm font-bold text-stone-800 mb-2">Dernières erreurs</h4>
        {d.recent.length === 0 && <p className="text-xs text-stone-400">Aucune.</p>}
        <div className="overflow-x-auto"><table className="w-full text-xs"><tbody>{d.recent.map((r, i) => <tr key={i} className="border-b border-stone-100 align-top"><td className="py-1 pr-2 whitespace-nowrap text-stone-500">{when(r.ts)}</td><td className="pr-2">{r.source}{r.status ? ` ${r.status}` : ''}</td><td className="pr-2 text-stone-500">{r.route}</td><td className="break-words">{r.message}</td></tr>)}</tbody></table></div></div>
    </div>
  );
};

/* ============ Abonnements ============ */
export const AdminBillingPanel: React.FC = () => {
  const [d, setD] = useState<Awaited<ReturnType<typeof api.adminBilling>> | null>(null);
  const [f, setF] = useState<BillingAdminSettings | null>(null);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const load = () => api.adminBilling().then(r => { setD(r); setF(r.settings); }).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  if (err && !d) return <p className="text-sm text-red-700">{err} (la migration v5 a-t-elle été exécutée ?)</p>;
  if (!d || !f) return <p className="text-sm text-stone-500">Chargement…</p>;
  const num = (k: keyof BillingAdminSettings) => <input type="number" min={0} className={inp} value={f[k] as number} onChange={e => setF({ ...f, [k]: Number(e.target.value) })} />;
  const save = async () => { setErr(''); setMsg(''); try { await api.adminBillingSave(f); setMsg('Réglages enregistrés.'); load(); } catch (e) { setErr((e as Error).message); } };
  const decide = async (p: PaymentRow, a: 'approve' | 'reject') => {
    const note = a === 'reject' ? (await uiPrompt('Motif du refus (facultatif) :') ?? '') : '';
    try { await api.adminPayDecide(p.id, a, note); load(); } catch (e) { setErr((e as Error).message); }
  };
  const row = (p: PaymentRow, actions: boolean) => (
    <div key={p.id} className="border-b border-stone-100 py-2 text-xs flex flex-wrap items-center justify-between gap-2">
      <div><b>{p.shopName || p.shopId}</b> — {p.userName} • {p.phone}<div className="text-stone-600">{fmt(p.amount)} {f.currency} • {p.months} mois • {p.method} • réf. <code>{p.reference}</code></div><div className="text-stone-400">{when(p.createdAt)}{!actions ? ` → ${p.status === 'approved' ? '✅ validé' : '❌ refusé'} ${when(p.decidedAt)}${p.note ? ' (' + p.note + ')' : ''}` : ''}</div></div>
      {actions && <div className="flex gap-1.5"><button onClick={() => decide(p, 'approve')} className="px-3 py-1.5 rounded-xl bg-emerald-700 text-white font-bold" data-testid={`approve-${p.id}`}>Valider</button><button onClick={() => decide(p, 'reject')} className="px-3 py-1.5 rounded-xl border border-stone-300 font-bold">Refuser</button></div>}
    </div>);
  return (
    <div className="space-y-4" data-testid="admin-billing">
      <div className="grid grid-cols-3 gap-3">
        <div className={card}><div className="text-xs text-stone-500">Encaissé (30 j)</div><div className="text-xl font-black">{fmt(d.revenue30d)} {f.currency}</div></div>
        <div className={card}><div className="text-xs text-stone-500">Abonnés actifs</div><div className="text-xl font-black">{d.activeSubs}</div></div>
        <div className={card}><div className="text-xs text-stone-500">À valider</div><div className="text-xl font-black">{d.pending.length}</div></div>
      </div>
      <div className={card}><h4 className="font-bold text-stone-800 text-sm mb-1">Paiements en attente de validation</h4>
        <p className="text-[11px] text-stone-400 mb-1">Vérifiez la référence sur votre application Mobile Money avant de valider. (Les paiements Money Fusion sont validés automatiquement.)</p>
        {d.pending.length === 0 && <p className="text-xs text-stone-400">Aucun.</p>}{d.pending.map(p => row(p, true))}</div>
      <div className={card + ' space-y-3'}>
        <h4 className="font-bold text-stone-800 text-sm">Réglages de l'abonnement Pro</h4>
        <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={f.enabled} onChange={e => setF({ ...f, enabled: e.target.checked })} data-testid="billing-enabled" /> Facturation activée (désactivée = tout le monde garde toutes les fonctions)</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-semibold text-stone-600">
          <label>Prix annuel{num('price12')}</label><label>Essai gratuit (jours){num('trialDays')}</label>
          <label>Questions IA/jour (gratuit){num('freeAiPerDay')}</label><label>Employés (gratuit){num('freeTeamMax')}</label>
          <label>Devise<input className={inp} value={f.currency} onChange={e => setF({ ...f, currency: e.target.value })} /></label></div>
        <label className="flex items-start gap-2 text-sm font-bold"><input type="checkbox" className="mt-1" checked={!!f.readOnlyAfterTrial} onChange={e => setF({ ...f, readOnlyAfterTrial: e.target.checked })} data-testid="billing-readonly" /><span>Lecture seule après l'essai<span className="block text-[11px] font-normal text-stone-500">Sans abonnement payé, la boutique peut consulter ses données mais ne peut plus enregistrer (ventes, stock, dépenses, dettes).</span></span></label>
        <label className="block text-xs font-semibold text-stone-600">Lien de paiement Money Fusion (clients internationaux, tarif annuel)
          <input className={inp} placeholder="https://www.pay.moneyfusion.net/..." maxLength={400} value={f.mfLink || ''} onChange={e => setF({ ...f, mfLink: e.target.value })} data-testid="billing-mflink" /></label>
        <label className="block text-xs font-semibold text-stone-600">Instructions de paiement affichées aux commerçants
          <textarea className={inp} rows={3} maxLength={600} placeholder="Orange Money : 07 00 00 00 (Nom du bénéficiaire)&#10;Wave : …" value={f.payInfo} onChange={e => setF({ ...f, payInfo: e.target.value })} data-testid="billing-payinfo" /></label>
        {err && <p className="text-xs text-red-700">{err}</p>}{msg && <p className="text-xs text-emerald-700">{msg}</p>}
        <button onClick={save} className="px-4 py-2 rounded-xl bg-emerald-700 text-white font-bold text-sm" data-testid="billing-save">Enregistrer</button>
        <p className="text-[11px] text-stone-400">À l'activation, chaque boutique reçoit {f.trialDays} jours d'essai Pro. Sans l'option « lecture seule », le plan gratuit ne bloque jamais la caisse ni les données : il limite seulement l'assistant IA et le nombre d'employés.</p>
      </div>
      <div className={card}><h4 className="font-bold text-stone-800 text-sm mb-1">Derniers paiements traités</h4>
        {d.recent.length === 0 && <p className="text-xs text-stone-400">Aucun.</p>}{d.recent.map(p => row(p, false))}</div>
    </div>
  );
};


/* ============ Avis des commerçants ============ */
export const AdminFeedbackPanel: React.FC = () => {
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.adminFeedback>>['items']>([]);
  const [err, setErr] = useState('');
  const load = () => api.adminFeedback().then(r => setItems(r.items)).catch(e => setErr(e?.message || 'Erreur'));
  useEffect(() => { load(); }, []);
  const set = async (id: string, status: 'new' | 'published' | 'hidden') => {
    setErr(''); try { await api.adminFeedbackSet(id, status); await load(); } catch (e: any) { setErr(e?.message || 'Erreur'); }
  };
  const del = async (id: string) => { if (!await uiConfirm('Supprimer cet avis ?')) return; try { await api.adminFeedbackDelete(id); await load(); } catch (e: any) { setErr(e?.message || 'Erreur'); } };
  const label: Record<string, string> = { new: 'À examiner', published: 'Publié', hidden: 'Masqué' };
  return (
    <div className="space-y-3">
      <p className="text-xs text-stone-500">Seuls les avis <b>validés ici</b> ET dont le commerçant a accepté la publication apparaissent sur la page d'accueil.</p>
      {err && <p className="text-xs font-semibold text-rose-700">{err}</p>}
      {items.length === 0 && <p className="text-sm text-stone-400">Aucun avis pour le moment.</p>}
      {items.map(f => (
        <div key={f.id} className="rounded-2xl border border-stone-200 bg-white p-4 space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-bold text-stone-900">{'★'.repeat(f.rating)}<span className="text-stone-300">{'★'.repeat(5 - f.rating)}</span> · {f.name || 'Anonyme'}{f.shop_label ? ` · ${f.shop_label}` : ''}{f.city ? `, ${f.city}` : ''}</span>
            <span className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 font-semibold whitespace-nowrap">{label[f.status]}</span>
          </div>
          <p className="text-sm text-stone-700">« {f.text} »</p>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={f.consent ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-semibold'}>{f.consent ? '✓ Publication autorisée' : '✗ Publication refusée par le commerçant'}</span>
            <span className="flex-1" />
            {f.consent === 1 && f.status !== 'published' && <button onClick={() => set(f.id, 'published')} className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white font-bold">Publier</button>}
            {f.status === 'published' && <button onClick={() => set(f.id, 'hidden')} className="px-3 py-1.5 rounded-lg border border-stone-300 font-bold">Retirer</button>}
            {f.status === 'new' && <button onClick={() => set(f.id, 'hidden')} className="px-3 py-1.5 rounded-lg border border-stone-300 font-bold">Masquer</button>}
            <button onClick={() => del(f.id)} className="px-3 py-1.5 rounded-lg text-rose-700 font-bold">Supprimer</button>
          </div>
        </div>
      ))}
    </div>
  );
};
