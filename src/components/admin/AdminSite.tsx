import React, { useEffect, useState } from 'react';
import { api, SiteStats, AdminAnnouncement } from '../../services/api';
import { formatCurrency } from '../../services/financials';
import { Select } from '../common/dialogs';
import { uiConfirm } from '../common/dialogs';

const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n));
const card = 'bg-white rounded-2xl border border-stone-200 p-4';

const Bars: React.FC<{ data: { day: string; v: number }[]; color: string; label: string }> = ({ data, color, label }) => {
  const max = Math.max(1, ...data.map(d => d.v));
  const total = data.reduce((a, d) => a + d.v, 0);
  return (
    <div className={card}>
      <div className="flex items-baseline justify-between"><h4 className="text-sm font-bold text-stone-800">{label}</h4><span className="text-xs text-stone-500">30 j : {fmt(total)}</span></div>
      <div className="flex items-end gap-[2px] h-24 mt-3" role="img" aria-label={`${label} sur 30 jours`}>
        {data.map(d => <div key={d.day} title={`${d.day} : ${fmt(d.v)}`} className="flex-1 rounded-t-sm" style={{ height: `${Math.max(d.v ? 4 : 1, (d.v / max) * 100)}%`, background: color, opacity: d.v ? 1 : 0.25 }} />)}
      </div>
      <div className="flex justify-between text-[10px] text-stone-400 mt-1"><span>{data[0]?.day.slice(5)}</span><span>{data[data.length - 1]?.day.slice(5)}</span></div>
    </div>
  );
};
const Rank: React.FC<{ title: string; rows: { k: string; n: number }[] }> = ({ title, rows }) => {
  const max = Math.max(1, ...rows.map(r => r.n));
  return (
    <div className={card}><h4 className="text-sm font-bold text-stone-800 mb-2">{title}</h4>
      {rows.length === 0 && <p className="text-xs text-stone-400">Aucune donnée.</p>}
      {rows.map(r => <div key={r.k} className="flex items-center gap-2 text-xs mb-1"><span className="w-28 truncate">{r.k}</span><div className="flex-1 bg-stone-100 rounded h-2"><div className="h-2 rounded bg-emerald-600" style={{ width: `${(r.n / max) * 100}%` }} /></div><span className="w-8 text-right font-bold">{r.n}</span></div>)}
    </div>
  );
};

export const AdminStatsPanel: React.FC = () => {
  const [d, setD] = useState<SiteStats | null>(null); const [err, setErr] = useState('');
  useEffect(() => { api.adminStats().then(setD).catch(e => setErr(e.message)); }, []);
  if (err) return <p className="text-sm text-red-700">{err} (la migration v4 a-t-elle été exécutée ?)</p>;
  if (!d) return <p className="text-sm text-stone-500">Chargement…</p>;
  const t = d.totals; const ai = d.ai[0];
  const kp: [string, string][] = [['Commerçants', fmt(t.merchants)], ['Actifs (7 j)', fmt(t.active7d)], ['Inscriptions (30 j)', fmt(t.signups30d)], ['Visites (30 j)', fmt(t.visits30d)], ['Employés', fmt(t.teamMembers)], ['Ventes enregistrées', fmt(t.sales)], ['Volume cumulé', formatCurrency(t.revenue, 'XOF' as any)], ['Comptes suspendus', fmt(t.suspended)]];
  return (
    <div className="space-y-4" data-testid="admin-stats">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{kp.map(([l, v]) => <div key={l} className={card}><div className="text-xs text-stone-500">{l}</div><div className="text-xl font-black text-stone-900">{v}</div></div>)}</div>
      <div className="grid md:grid-cols-2 gap-3">
        <Bars label="Visites du site" color="var(--c-cyan)" data={d.series.map(s => ({ day: s.day, v: s.visits }))} />
        <Bars label="Nouvelles inscriptions" color="var(--c-gold-deep)" data={d.series.map(s => ({ day: s.day, v: s.signups }))} />
        <Bars label="Boutiques actives par jour" color="var(--c-blue)" data={d.series.map(s => ({ day: s.day, v: s.activeShops }))} />
        <Bars label="Ventes enregistrées par jour" color="var(--c-violet)" data={d.series.map(s => ({ day: s.day, v: s.sales }))} />
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        <Rank title="Secteurs" rows={d.categories} /><Rank title="Pays" rows={d.countries} />
        <div className={card}><h4 className="text-sm font-bold text-stone-800 mb-2">Utilisation de l'IA gratuite</h4>
          <p className="text-xs text-stone-600">Aujourd'hui : <b>{ai && ai.day === new Date().toISOString().slice(0, 10) ? ai.count : 0}</b> / {d.aiDailyGlobal} requêtes (plafond plateforme).</p>
          <p className="text-[11px] text-stone-400 mt-1">Les 7 derniers jours : {d.ai.map(a => a.count).join(' · ') || '—'}</p></div>
      </div>
      <p className="text-[11px] text-stone-400">Les « visites » comptent une ouverture de l'application par appareil et par session, sans cookie ni donnée personnelle.</p>
    </div>
  );
};

const AUD_LABEL = (a: string) => a === 'all' ? 'Tous' : a === 'owners' ? 'Propriétaires' : a.startsWith('category:') ? `Secteur ${a.slice(9)}` : `Pays ${a.slice(8)}`;

export const AdminMessagesPanel: React.FC = () => {
  const [items, setItems] = useState<AdminAnnouncement[]>([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ title: '', body: '', audience: 'all', value: '', level: 'info', days: 14 });
  const load = () => api.adminAnnouncements().then(r => setItems(r.items)).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    const audience = f.audience === 'category' ? `category:${f.value.trim()}` : f.audience === 'country' ? `country:${f.value.trim()}` : f.audience;
    try { await api.adminAnnouncementAdd({ title: f.title, body: f.body, audience, level: f.level, days: f.days }); setF({ ...f, title: '', body: '' }); await load(); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const del = async (id: string) => { if (await uiConfirm('Supprimer ce message ?')) { await api.adminAnnouncementDelete(id).catch(x => setErr(x.message)); load(); } };
  const inp = 'w-full px-3 py-2 rounded-xl border border-stone-300 text-sm';
  return (
    <div className="space-y-4" data-testid="admin-messages">
      <form onSubmit={send} className={card + ' space-y-2'}>
        <h4 className="font-bold text-stone-800 text-sm">Nouveau message aux utilisateurs</h4>
        <input className={inp} placeholder="Titre (80 car. max)" maxLength={80} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} data-testid="msg-title" />
        <textarea className={inp} rows={3} maxLength={1000} placeholder="Votre message…" value={f.body} onChange={e => setF({ ...f, body: e.target.value })} data-testid="msg-body" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Select className={inp} value={f.audience} onChange={e => setF({ ...f, audience: e.target.value })}>
            <option value="all">Tous les utilisateurs</option><option value="owners">Propriétaires seulement</option><option value="category">Un secteur</option><option value="country">Un pays</option></Select>
          {(f.audience === 'category' || f.audience === 'country') && <input className={inp} placeholder={f.audience === 'category' ? 'code secteur' : 'ex : Burkina Faso'} value={f.value} onChange={e => setF({ ...f, value: e.target.value })} />}
          <Select className={inp} value={f.level} onChange={e => setF({ ...f, level: e.target.value })}><option value="info">Information</option><option value="important">Important</option></Select>
          <Select className={inp} value={f.days} onChange={e => setF({ ...f, days: Number(e.target.value) })}>{[3, 7, 14, 30, 90].map(n => <option key={n} value={n}>Visible {n} jours</option>)}</Select>
        </div>
        {err && <p className="text-xs text-red-700">{err}</p>}
        <button disabled={busy || !f.title.trim() || !f.body.trim()} className="px-4 py-2 rounded-xl bg-emerald-700 text-white font-bold text-sm disabled:opacity-50" data-testid="msg-send">Publier le message</button>
        <p className="text-[11px] text-stone-400">Le message s'affiche en haut de l'application des destinataires jusqu'à ce qu'ils le ferment.</p>
      </form>
      <div className="space-y-2">
        {items.length === 0 && <p className="text-sm text-stone-400">Aucun message envoyé.</p>}
        {items.map(a => (
          <div key={a.id} className={card + (a.active ? '' : ' opacity-60')}>
            <div className="flex items-start justify-between gap-2"><div><b className="text-sm">{a.title}</b>{a.level === 'important' && <span className="ml-2 text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-bold">Important</span>}</div>
              <button onClick={() => del(a.id)} className="text-xs text-red-700 font-bold">Supprimer</button></div>
            <p className="text-sm text-stone-700 whitespace-pre-wrap">{a.body}</p>
            <p className="text-[11px] text-stone-500 mt-1">{AUD_LABEL(a.audience)} • lu par {a.reads}/{a.audienceSize} • {new Date(a.createdAt).toLocaleDateString('fr-FR')} → {new Date(a.expiresAt).toLocaleDateString('fr-FR')} {a.active ? '' : '(expiré)'}</p>
          </div>))}
      </div>
    </div>
  );
};
