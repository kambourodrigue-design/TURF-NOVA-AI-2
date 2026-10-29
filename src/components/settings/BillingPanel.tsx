import React, { useEffect, useState } from 'react';
import { api, PlanSettings, PlanStatus, PaymentRow } from '../../services/api';
import { Select } from '../common/dialogs';

const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n));
const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('fr-FR') : '';

/** Abonnement Pro du propriétaire : état, prix, instructions de paiement et déclaration du paiement. */
export const BillingPanel: React.FC = () => {
  const [data, setData] = useState<{ status: PlanStatus; settings: PlanSettings; payments: PaymentRow[] } | null>(null);
  const [mode, setMode] = useState<'local' | 'intl'>('local'); const [phone, setPhone] = useState(''); const [ref, setRef] = useState(''); const [method, setMethod] = useState('orange_money');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const load = () => api.billing().then(setData).catch(() => { /* hors-ligne : panneau masqué */ });
  useEffect(() => { load(); }, []);
  if (!data || !data.status.enforced) return null;     // facturation désactivée : rien à afficher
  const { status: st, settings: s } = data;
  const price = s.price12; const months = 12;
  const badge = st.state === 'paid' ? ['bg-emerald-100 text-emerald-800', `Pro jusqu'au ${day(st.paidUntil)}`]
    : st.state === 'trial' ? ['bg-amber-100 text-amber-800', `Essai Pro : ${st.daysLeft} jour(s) restant(s)`]
    : ['bg-stone-200 text-stone-700', 'Plan gratuit'];
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setMsg(''); setBusy(true);
    try { await api.billingPay({ months, method: mode === 'intl' && s.mfLink ? 'moneyfusion_link' : method, reference: ref.trim() }); setRef(''); setMsg("Merci ! Votre paiement sera validé sous peu."); await load(); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const payOnline = async () => {
    setErr(''); setMsg(''); setBusy(true);
    try { const r = await api.mfStart({ phone: phone.trim() }); window.location.href = r.url; }
    catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  const verify = async () => {
    setErr(''); setMsg(''); setBusy(true);
    try { const r = await api.mfCheck(); setMsg(r.approved ? '✅ Paiement confirmé, abonnement activé.' : r.pending ? 'Paiement pas encore confirmé, réessayez dans un instant.' : 'Aucun paiement en ligne en cours.'); await load(); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const pending = data.payments.filter(p => p.status === 'pending');
  return (
    <div className="pt-2 border-t border-stone-200/80 space-y-3" data-testid="billing-panel">
      <div className="flex items-center justify-between gap-2"><h4 className="font-bold text-stone-800 text-sm">Abonnement</h4><span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${badge[0]}`}>{badge[1]}</span></div>
      <p className="text-xs text-stone-600">Le plan Pro ouvre l'assistant IA ({`jusqu'à 15 questions/jour`} au lieu de {s.freeAiPerDay}) et permet d'ajouter autant d'employés que vous voulez (gratuit : {s.freeTeamMax}). Votre caisse et vos données restent toujours accessibles, quel que soit le plan.</p>
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center"><div className="text-xs font-bold text-emerald-900">Abonnement annuel</div><div className="text-lg font-black text-emerald-900">{fmt(price)} {s.currency} / an</div>
        <div className="mt-2 pt-2 border-t border-emerald-200 text-left text-[11px] text-emerald-900 space-y-0.5"><div className="font-bold">✅ Conseil &amp; Assistance inclus :</div><div>• Prise en main personnalisée</div><div>• Réponse prioritaire sur WhatsApp (lun–ven)</div><div>• Point mensuel sur vos chiffres</div><div>• Conseils de gestion et aide pour votre dossier bancaire</div></div></div>
      {(s.moneyFusion || s.mfLink) && <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setMode('local')} className={`rounded-xl border p-2 text-xs font-bold ${mode === 'local' ? 'border-emerald-700 bg-emerald-50 text-emerald-900' : 'border-stone-300 bg-white'}`}>Mobile Money (local)</button>
        <button type="button" onClick={() => setMode('intl')} className={`rounded-xl border p-2 text-xs font-bold ${mode === 'intl' ? 'border-emerald-700 bg-emerald-50 text-emerald-900' : 'border-stone-300 bg-white'}`} data-testid="pay-mode-intl">🌍 International (en ligne)</button>
      </div>}
      {mode === 'intl' && s.moneyFusion ? (
        <div className="space-y-2 bg-stone-50 rounded-xl p-3 border border-stone-200">
          <p className="text-xs text-stone-600">Payez en ligne de façon sécurisée avec Money Fusion (Mobile Money, carte). Votre abonnement est activé automatiquement dès le paiement confirmé.</p>
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Votre numéro de téléphone (avec indicatif)" inputMode="tel" maxLength={30} className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm" data-testid="mf-phone" />
          {err && <p className="text-xs text-red-700">{err}</p>}{msg && <p className="text-xs text-emerald-700">{msg}</p>}
          <button type="button" onClick={payOnline} disabled={busy || phone.replace(/\D/g, '').length < 8} className="w-full py-2 rounded-xl bg-emerald-700 text-white font-bold text-sm disabled:opacity-50" data-testid="mf-pay">Payer {fmt(price)} {s.currency} en ligne</button>
          <button type="button" onClick={verify} disabled={busy} className="w-full py-1.5 rounded-xl border border-stone-300 text-xs font-bold text-stone-700 disabled:opacity-50">Vérifier mon paiement</button>
        </div>
      ) : (
      <form onSubmit={submit} className="space-y-2 bg-stone-50 rounded-xl p-3 border border-stone-200">
        {mode === 'intl' && s.mfLink ? (
          <div className="text-xs bg-white border border-stone-200 rounded-lg p-2 space-y-2"><div><b>1.</b> Payez {fmt(price)} {s.currency} en ligne avec Money Fusion :</div>
            <a href={s.mfLink} target="_blank" rel="noopener noreferrer" className="block text-center py-2 rounded-xl bg-emerald-700 text-white font-bold text-sm" data-testid="mf-link">🌍 Payer en ligne</a></div>
        ) : (
          <div className="text-xs bg-white border border-stone-200 rounded-lg p-2 whitespace-pre-wrap"><b>1.</b> Envoyez {fmt(price)} {s.currency} :{'\n'}{s.payInfo}</div>)}
        <div className="text-xs font-semibold text-stone-700"><b>2.</b> Indiquez ensuite la référence de la transaction (reçue par SMS ou affichée après le paiement) :</div>
        <div className="flex gap-2">
          {mode === 'intl' && s.mfLink ? <span className="px-2 py-2 rounded-xl border border-stone-300 text-xs bg-white">Money Fusion</span> : <Select value={method} onChange={e => setMethod(e.target.value)} className="px-2 py-2 rounded-xl border border-stone-300 text-xs"><option value="orange_money">Orange Money</option><option value="wave">Wave</option><option value="mtn_momo">MTN MoMo</option><option value="moov_money">Moov Money</option><option value="bank_transfer">Virement</option></Select>}
          <input value={ref} onChange={e => setRef(e.target.value)} placeholder="Référence / n° de transaction" maxLength={40} className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-stone-300 text-sm" data-testid="pay-ref" /></div>
        {err && <p className="text-xs text-red-700">{err}</p>}{msg && <p className="text-xs text-emerald-700">{msg}</p>}
        <button disabled={busy || ref.trim().length < 4} className="w-full py-2 rounded-xl bg-emerald-700 text-white font-bold text-sm disabled:opacity-50" data-testid="pay-submit">J'ai payé : envoyer pour validation</button>
      </form>)}
      {data.payments.length > 0 && <div className="text-[11px] text-stone-500 space-y-0.5">{data.payments.slice(0, 5).map(p => <div key={p.id}>{day(p.createdAt)} • {fmt(p.amount)} {s.currency} • {p.method === 'moneyfusion' ? 'en ligne' : 'Mobile Money'} • {p.status === 'approved' ? '✅ validé' : p.status === 'rejected' ? `❌ refusé${p.note ? ' (' + p.note + ')' : ''}` : '⏳ en attente'}</div>)}</div>}
      {pending.length > 0 && <p className="text-[11px] text-stone-400">La validation se fait à la main, généralement dans la journée.</p>}
    </div>
  );
};
