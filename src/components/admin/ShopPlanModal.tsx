import React, { useEffect, useState } from 'react';
import { api, AdminShopPlan } from '../../services/api';
import { uiAlert, uiConfirm } from '../common/dialogs';

interface Props { shopId: string; shopName: string; onClose: () => void }

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');

/** Abonnement d'une boutique : activer l'annuel, le retirer, bloquer/débloquer à la fin de l'essai. */
export const ShopPlanModal: React.FC<Props> = ({ shopId, shopName, onClose }) => {
  const [d, setD] = useState<AdminShopPlan | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.adminShopPlan(shopId).then(setD).catch((e: any) => uiAlert(e?.message || 'Erreur de chargement.')); }, [shopId]);

  const act = async (action: 'activate' | 'revoke' | 'block' | 'unblock', ask?: string) => {
    if (ask && !(await uiConfirm(ask))) return;
    setBusy(true);
    try { setD(await api.adminShopPlanAct(shopId, action)); }
    catch (e: any) { uiAlert(e?.message || 'Action impossible.'); }
    setBusy(false);
  };

  const st = d?.status;
  const label = !st ? '…'
    : st.state === 'paid' ? `Abonné jusqu'au ${fmt(st.paidUntil)}`
    : st.state === 'trial' ? `Essai jusqu'au ${fmt(st.trialEndsAt)} (${st.daysLeft} j restants)`
    : st.state === 'free' ? `Essai terminé le ${fmt(st.trialEndsAt)}${d?.blocked ? ' — bloqué (lecture seule)' : ''}`
    : 'Facturation désactivée';

  return (
    <div className="fixed inset-0 z-[300] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-3 border border-stone-200" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0"><h3 className="font-black text-stone-900">Abonnement</h3><p className="text-xs text-stone-500 truncate">{shopName}</p></div>
          <button onClick={onClose} className="text-stone-400 p-1">✕</button>
        </div>
        <div className="rounded-xl bg-stone-50 border border-stone-200 p-3 text-sm font-bold text-stone-800 break-words">{label}</div>
        {d && !d.billingEnabled && <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg p-2">La facturation est désactivée globalement : ces réglages s'appliqueront dès son activation (Admin → Abonnements).</p>}
        <div className="grid gap-2">
          <button disabled={busy || !d} onClick={() => act('activate', `Activer l'abonnement annuel (12 mois) pour ${shopName} ?`)}
            className="py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs disabled:opacity-50">Activer l'abonnement annuel (12 mois)</button>
          {st?.state === 'paid' && <button disabled={busy} onClick={() => act('revoke', `Retirer l'abonnement de ${shopName} ?`)}
            className="py-2.5 rounded-xl border border-stone-300 text-stone-700 font-bold text-xs disabled:opacity-50">Retirer l'abonnement</button>}
          {d && (d.blocked
            ? <button disabled={busy} onClick={() => act('unblock')} className="py-2.5 rounded-xl border border-emerald-300 text-emerald-800 font-bold text-xs disabled:opacity-50">Débloquer (autoriser après l'essai)</button>
            : <button disabled={busy} onClick={() => act('block', `Bloquer ${shopName} (lecture seule) dès la fin de son essai ?`)} className="py-2.5 rounded-xl border border-rose-300 text-rose-700 font-bold text-xs disabled:opacity-50">Bloquer à la fin de l'essai</button>)}
        </div>
        <p className="text-[11px] text-stone-500">Bloqué : le client garde l'accès en lecture mais ne peut plus enregistrer tant qu'il n'est pas abonné.</p>
      </div>
    </div>
  );
};
