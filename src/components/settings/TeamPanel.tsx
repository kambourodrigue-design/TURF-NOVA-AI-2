import React, { useCallback, useEffect, useState } from 'react';
import { api, TeamMember } from '../../services/api';
import { Users, UserPlus, KeyRound, Trash2, Ban, CheckCircle2 } from 'lucide-react';
import { Select } from '../common/dialogs';
import { uiConfirm, uiPrompt } from '../common/dialogs';

const ROLE_TXT: Record<string, string> = {
  owner: 'Propriétaire', manager: 'Gérant', cashier: 'Caissier',
};
const ROLE_HELP: Record<string, string> = {
  manager: 'Gérant : vend, gère stocks, dépenses, clients et fournisseurs.',
  cashier: 'Caissier : caisse et crédits clients uniquement (ne voit ni les bénéfices, ni les dépenses).',
};

export const TeamPanel: React.FC = () => {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'manager' | 'cashier'>('cashier');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setMembers((await api.teamList()).members); setMsg(null); }
    catch (e) { setMsg('❌ ' + (e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) setMsg('✅ ' + ok); await load(); }
    catch (e) { setMsg('❌ ' + (e as Error).message); }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.teamAdd({ name: name.trim(), phone: phone.trim(), password, shopRole: role });
      setName(''); setPhone(''); setPassword(''); setAdding(false);
      setMsg('✅ Compte créé. Communiquez-lui son téléphone et son mot de passe.');
      await load();
    } catch (er) { setMsg('❌ ' + (er as Error).message); }
    finally { setBusy(false); }
  };

  const input = 'px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm w-full';

  return (
    <div className="pt-2 border-t border-stone-200/80 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-extrabold text-stone-600 uppercase tracking-wider flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" /> Mon équipe (même boutique, en même temps)
        </span>
        <button type="button" onClick={() => setAdding(a => !a)}
          className="text-xs font-bold text-emerald-800 flex items-center gap-1">
          <UserPlus className="w-3.5 h-3.5" /> {adding ? 'Annuler' : 'Ajouter'}
        </button>
      </div>

      {adding && (
        <form onSubmit={add} className="p-3 rounded-2xl bg-emerald-50/60 border border-emerald-200 space-y-2">
          <input className={input} placeholder="Nom de l'employé" value={name} onChange={e => setName(e.target.value)} required />
          <input className={input} placeholder="Téléphone (sert d'identifiant)" value={phone} onChange={e => setPhone(e.target.value)} required />
          <input className={input} type="password" autoComplete="new-password" placeholder="Mot de passe (8 caractères min.)"
            value={password} onChange={e => setPassword(e.target.value)} minLength={8} required />
          <Select className={input} value={role} onChange={e => setRole(e.target.value as 'manager' | 'cashier')}>
            <option value="cashier">Caissier</option>
            <option value="manager">Gérant</option>
          </Select>
          <p className="text-[11px] text-stone-600">{ROLE_HELP[role]}</p>
          <button disabled={busy} className="w-full py-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white font-bold text-xs disabled:opacity-60">
            {busy ? 'Création…' : 'Créer le compte'}
          </button>
        </form>
      )}

      {loading && <p className="text-xs text-stone-500">Chargement…</p>}
      <ul className="space-y-1.5">
        {members.map(m => {
          const isOwner = m.shopRole === 'owner';
          return (
            <li key={m.id} className="p-2.5 rounded-xl bg-stone-50 border border-stone-200 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-stone-900 truncate">{m.name}</div>
                  <div className="text-stone-500 truncate">{m.phone}</div>
                </div>
                {isOwner ? (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 font-bold shrink-0">{ROLE_TXT.owner}</span>
                ) : (
                  <Select value={m.shopRole}
                    onChange={e => act(() => api.teamUpdate(m.id, { shopRole: e.target.value as 'manager' | 'cashier' }), 'Rôle modifié (l\'employé devra se reconnecter).')}
                    className="px-2 py-1 rounded-lg border border-stone-200 bg-white font-semibold shrink-0">
                    <option value="cashier">Caissier</option>
                    <option value="manager">Gérant</option>
                  </Select>
                )}
              </div>
              {!isOwner && (
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {m.status === 'active' ? (
                    <button type="button" onClick={() => act(() => api.teamUpdate(m.id, { status: 'suspended' }), 'Accès suspendu.')}
                      className="px-2 py-1 rounded-lg bg-amber-100 text-amber-900 font-bold flex items-center gap-1"><Ban className="w-3 h-3" />Suspendre</button>
                  ) : (
                    <button type="button" onClick={() => act(() => api.teamUpdate(m.id, { status: 'active' }), 'Accès rétabli.')}
                      className="px-2 py-1 rounded-lg bg-emerald-100 text-emerald-900 font-bold flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Réactiver</button>
                  )}
                  <button type="button" onClick={async () => {
                    const pw = await uiPrompt(`Nouveau mot de passe pour ${m.name} (8 caractères min.) :`);
                    if (pw) act(() => api.teamResetPassword(m.id, pw), 'Mot de passe changé.');
                  }} className="px-2 py-1 rounded-lg bg-stone-200 text-stone-800 font-bold flex items-center gap-1"><KeyRound className="w-3 h-3" />Mot de passe</button>
                  <button type="button" onClick={async () => {
                    if (await uiConfirm(`Supprimer le compte de ${m.name} ? Ses ventes déjà enregistrées sont conservées.`)) act(() => api.teamRemove(m.id), 'Compte supprimé.');
                  }} className="px-2 py-1 rounded-lg bg-rose-100 text-rose-800 font-bold flex items-center gap-1"><Trash2 className="w-3 h-3" />Supprimer</button>
                  {m.status === 'suspended' && <span className="text-rose-700 font-bold">Suspendu</span>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {msg && <p className="text-xs font-semibold text-stone-700">{msg}</p>}
    </div>
  );
};
