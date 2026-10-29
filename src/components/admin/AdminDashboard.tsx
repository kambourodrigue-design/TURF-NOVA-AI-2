import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { AdminStatsPanel, AdminMessagesPanel } from './AdminSite';
import { AdminMonitorPanel, AdminBillingPanel, AdminFeedbackPanel } from './AdminOps';
import { UserAccount, ShopSettings } from '../../types';
import { api, ApiError, AdminListResponse } from '../../services/api';
import { BUSINESS_PRESETS } from '../../services/businessPresets';
import { formatCurrency } from '../../services/financials';
import {
  Users,
  Store,
  ShieldCheck,
  Search,
  TrendingUp,
  MapPin,
  Download,
  Landmark,
  Eye,
  UserCheck,
  UserX,
  Building2,
  KeyRound,
  Trash2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  CreditCard,
} from 'lucide-react';
import { ShopPlanModal } from './ShopPlanModal';
import { Select } from '../common/dialogs';
import { uiAlert, uiConfirm, uiPrompt } from '../common/dialogs';

interface AdminDashboardProps {
  currentUser: UserAccount;
  onImpersonate: (user: UserAccount) => void;
  onUnauthorized: () => void;
}

const EMPTY_SHOP = (user: UserAccount): ShopSettings => ({
  shopId: user.shopId,
  shopName: 'Commerce',
  ownerName: user.name,
  country: '',
  city: '',
  phone: user.phone,
  currency: 'XOF' as const,
  isFormalized: false,
  businessType: 'Commerce Général',
  businessCategory: 'retail_food' as const,
  foundedYear: new Date().getFullYear(),
});

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ currentUser, onImpersonate, onUnauthorized }) => {
  // La liste est chargée page par page (25 commerçants) ; les chiffres viennent de statistiques précalculées.
  const [data, setData] = useState<AdminListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSector, setSelectedSector] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [planShop, setPlanShop] = useState<{ id: string; name: string } | null>(null);
  const [inspectUser, setInspectUser] = useState<{ user: UserAccount; shop: ShopSettings } | null>(null);
  const reqId = useRef(0);
  const [sub, setSub] = useState<'users' | 'stats' | 'messages' | 'billing' | 'feedback' | 'monitor'>('users');

  useEffect(() => {
    const t = setTimeout(() => { setSearchQuery(searchInput.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    try {
      setError(null);
      const res = await api.adminList({ page, q: searchQuery, status: selectedStatus, sector: selectedSector });
      if (id === reqId.current) setData(res);
    } catch (e) {
      if (id !== reqId.current) return;
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) { onUnauthorized(); return; }
      setError((e as Error).message);
    }
  }, [page, searchQuery, selectedStatus, selectedSector, onUnauthorized]);
  useEffect(() => { load(); }, [load]);

  const resetRequests = data?.resetRequests || [];
  const kpis = data?.kpis;

  const handleResetPw = async (user: UserAccount) => {
    const pw = await uiPrompt(`Nouveau mot de passe pour ${user.name} (8 caractères minimum) :`);
    if (!pw) return;
    if (pw.length < 8) { uiAlert('Mot de passe trop court (8 caractères minimum).'); return; }
    try {
      await api.adminResetPassword(user.id, pw);
      uiAlert(`Mot de passe modifié. Communiquez-le à ${user.name} ; ses sessions ont été fermées.`);
      load();
    } catch (e) { uiAlert((e as Error).message); }
  };

  const handleDelete = async (user: UserAccount) => {
    if (!await uiConfirm(`Supprimer définitivement la boutique de ${user.name}, son équipe et toutes ses données ? Cette action est irréversible.`)) return;
    try { await api.adminDelete(user.id); load(); } catch (e) { uiAlert((e as Error).message); }
  };

  const handleToggleStatus = async (user: UserAccount) => {
    const next = user.status === 'active' ? 'suspended' : 'active';
    if (next === 'suspended' && !await uiConfirm(`Suspendre ${user.name} ? Son équipe sera aussi bloquée.`)) return;
    try { await api.adminSetStatus(user.id, next); load(); } catch (e) { uiAlert((e as Error).message); }
  };

  const genTempPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const a = crypto.getRandomValues(new Uint32Array(10));
    return Array.from(a, n => chars[n % chars.length]).join('');
  };

  const handleTempPasswordWhatsApp = async (u: { id: string; name: string; phone: string }) => {
    if (!await uiConfirm(`Générer un mot de passe temporaire pour ${u.name} et ouvrir WhatsApp ?`)) return;
    const pw = genTempPassword();
    try {
      await api.adminResetPassword(u.id, pw);
      const phone = u.phone.replace(/\D/g, '');
      const msg = `Bonjour ${u.name}, voici votre mot de passe temporaire Nafora : ${pw}\nConnectez-vous puis changez-le dans Paramètres > Mon mot de passe.`;
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
      load();
    } catch (e) { uiAlert((e as Error).message); }
  };

  const filteredMerchants = useMemo(() => (data?.items || []).map(({ user, shop, stats, teamCount }) => {
    const sh = shop || EMPTY_SHOP(user);
    return {
      user,
      shop: sh,
      preset: BUSINESS_PRESETS[sh.businessCategory] || BUSINESS_PRESETS.other,
      revenue30d: stats.revenue30d,
      salesCount: stats.salesCount,
      teamCount,
    };
  }), [data]);

  const totalMerchants = kpis?.merchants ?? 0;
  const activeMerchants = kpis?.active ?? 0;
  const formalizedCount = kpis?.formalized ?? 0;
  const totalVolume = kpis?.revenue30d ?? 0;
  const newThisMonth = kpis?.new30 ?? 0;

  // L'export complet est préparé par le serveur (tous les commerçants, pas seulement la page affichée)
  const handleExportCsv = async () => {
    try {
      const res = await fetch(api.adminExportUrl, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`Export impossible (erreur ${res.status}).`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `nafora_commercants_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) { uiAlert((e as Error).message); }
  };

  return (
    <div className="space-y-6 pb-20">
      
      {/* Top Banner Admin */}
      <div className="bg-gradient-to-r from-stone-900 via-stone-800 to-emerald-950 rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-amber-400 text-stone-950 uppercase tracking-wider">
                Espace Superviseur
              </span>
              <span className="text-xs text-stone-300">
                Connecté en tant que <strong>{currentUser.name}</strong>
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-white mt-1">
              Plateforme d'Administration & Suivi des PME
            </h2>
            <p className="text-xs sm:text-sm text-stone-300 max-w-xl">
              Supervisez les commerçants enregistrés, suivez leur transition vers le formel et facilitez leur financement bancaire.
            </p>
          </div>

          <button
            onClick={handleExportCsv}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm transition self-start md:self-auto shadow-sm active:scale-95"
          >
            <Download className="w-4 h-4" />
            <span>Exporter Répertoire (CSV)</span>
          </button>
        </div>
      </div>

      <div className="flex gap-1.5 overflow-x-auto" role="tablist">
        {([['users', 'Commerçants'], ['stats', 'Statistiques du site'], ['messages', 'Messages'], ['billing', 'Abonnements'], ['feedback', 'Avis'], ['monitor', 'Surveillance']] as const).map(([id, l]) => (
          <button key={id} role="tab" aria-selected={sub === id} onClick={() => setSub(id)} data-testid={`admin-tab-${id}`}
            className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap ${sub === id ? 'bg-stone-900 text-white' : 'bg-white border border-stone-200 text-stone-700'}`}>{l}</button>
        ))}
      </div>
      {sub === 'stats' && <AdminStatsPanel />}
      {sub === 'messages' && <AdminMessagesPanel />}
      {sub === 'billing' && <AdminBillingPanel />}
      {sub === 'feedback' && <AdminFeedbackPanel />}
      {sub === 'monitor' && <AdminMonitorPanel />}
      {sub === 'users' && (<>
      {resetRequests.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 space-y-2">
          <h3 className="font-extrabold text-amber-900 text-sm flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> Demandes de mot de passe oublié ({resetRequests.length})
          </h3>
          {resetRequests.map(r => {
            const u = { id: r.userId, name: r.name, phone: r.phone };
            return (
              <div key={r.userId} className="flex flex-wrap items-center justify-between gap-2 bg-white rounded-xl p-3 border border-amber-200">
                <div className="text-xs sm:text-sm">
                  <span className="font-bold text-stone-900">{u.name}</span>
                  <span className="text-stone-500"> • 📞 {u.phone} • {new Date(r.createdAt).toLocaleString('fr-FR')}</span>
                </div>
                <button
                  onClick={() => handleTempPasswordWhatsApp(u)}
                  className="px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs"
                >
                  💬 Mot de passe temporaire → WhatsApp
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Platform Macro KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-stone-200 shadow-xs">
          <div className="flex items-center justify-between text-stone-500 text-xs font-semibold">
            <span>PME Enregistrées</span>
            <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-800 flex items-center justify-center font-bold">
              <Store className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-stone-900 font-mono-num">
              {totalMerchants}
            </div>
            <div className="text-xs text-emerald-700 font-semibold mt-0.5">
              {activeMerchants} comptes actifs
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-stone-200 shadow-xs">
          <div className="flex items-center justify-between text-stone-500 text-xs font-semibold">
            <span>Chiffre d'Affaires (30 j)</span>
            <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center font-bold">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-xl sm:text-2xl font-black text-stone-900 font-mono-num truncate">
              {formatCurrency(totalVolume, 'XOF')}
            </div>
            <div className="text-xs text-stone-500 mt-0.5">
              Ventes enregistrées sur 30 jours
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-stone-200 shadow-xs">
          <div className="flex items-center justify-between text-stone-500 text-xs font-semibold">
            <span>Nouveaux (30 jours)</span>
            <div className="w-7 h-7 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center font-bold">
              <Landmark className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-teal-800 font-mono-num">
              {newThisMonth}
            </div>
            <div className="text-xs text-teal-700 font-semibold mt-0.5">
              Inscriptions récentes
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-stone-200 shadow-xs">
          <div className="flex items-center justify-between text-stone-500 text-xs font-semibold">
            <span>Taux de Formalisation</span>
            <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center font-bold">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-indigo-800 font-mono-num">
              {totalMerchants > 0 ? Math.round((formalizedCount / totalMerchants) * 100) : 0}%
            </div>
            <div className="text-xs text-stone-500 mt-0.5">
              {formalizedCount} avec RCCM validé
            </div>
          </div>
        </div>

      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl p-3 sm:p-4 border border-stone-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            type="text"
            placeholder="Rechercher par gérant, boutique, ville..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs sm:text-sm focus:ring-2 focus:ring-emerald-700"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto text-xs font-medium">
          <Select
            value={selectedSector}
            onChange={(e) => { setSelectedSector(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl font-bold text-stone-700"
          >
            <option value="all">Tous les secteurs d'activité</option>
            <option value="retail_food">🛒 Commerce & Alimentation</option>
            <option value="fashion_tailor">👗 Couture & Mode</option>
            <option value="hardware_craft">🔨 Quincaillerie & BTP</option>
            <option value="restaurant_maquis">🍽️ Restaurant & Maquis</option>
            <option value="beauty_salon">💇 Salon de Coiffure</option>
            <option value="garage_mechanic">🔧 Garage & Pièces</option>
          </Select>

          <Select
            value={selectedStatus}
            onChange={(e) => { setSelectedStatus(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl font-bold text-stone-700"
          >
            <option value="all">Tous les statuts</option>
            <option value="active">Actifs</option>
            <option value="suspended">Suspendus</option>
          </Select>
        </div>
      </div>

      {/* Merchants Registry Table */}
      <div className="bg-white rounded-3xl border border-stone-200 overflow-hidden shadow-xs">
        <div className="p-4 border-b border-stone-100 flex items-center justify-between">
          <h3 className="font-extrabold text-stone-900 text-base flex items-center gap-2">
            <Users className="w-4 h-4 text-emerald-800" />
            <span>Répertoire des Commerçants et PME ({data?.total ?? 0})</span>
          </h3>
          <button onClick={load} className="text-xs text-stone-600 hover:text-stone-900 flex items-center gap-1 font-semibold">
            <RefreshCw className="w-3.5 h-3.5" /> Actualiser
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-stone-50 text-stone-500 font-extrabold uppercase tracking-wider text-[11px] border-b border-stone-200">
              <tr>
                <th className="py-3 px-4">Commerçant & Boutique</th>
                <th className="py-3 px-3">Secteur</th>
                <th className="py-3 px-3">Localisation</th>
                <th className="py-3 px-3 text-center">Ventes</th>
                <th className="py-3 px-3 text-right">CA 30 jours</th>
                <th className="py-3 px-3 text-center">Statut</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filteredMerchants.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-stone-400">
                    {error ? `Erreur : ${error}` : !data ? 'Chargement…' : 'Aucun commerçant ne correspond aux filtres appliqués.'}
                  </td>
                </tr>
              ) : (
                filteredMerchants.map(({ user, shop, preset, revenue30d, salesCount, teamCount }) => (
                  <tr key={user.id} className="hover:bg-stone-50/70 transition">
                    
                    {/* User and Shop info */}
                    <td className="py-3.5 px-4 font-bold text-stone-900">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-stone-100 border border-stone-200 flex items-center justify-center text-sm font-black text-stone-800 shrink-0">
                          {preset.icon}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-stone-950 font-extrabold">{shop.shopName}</span>
                            {shop.isFormalized && (
                              <span title="Entreprise Formalisée (RCCM)" className="text-amber-500">
                                <ShieldCheck className="w-3.5 h-3.5" />
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-stone-500 font-normal mt-0.5">
                            Gérant : {user.name} • 📞 {user.phone}{user.email ? ` • ✉️ ${user.email}` : ''}{teamCount > 1 ? ` • 👥 ${teamCount} comptes` : ''}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Sector */}
                    <td className="py-3.5 px-3">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-stone-100 text-stone-800">
                        <span>{preset.icon}</span>
                        <span>{preset.title.split(',')[0]}</span>
                      </span>
                    </td>

                    {/* Location */}
                    <td className="py-3.5 px-3 text-xs text-stone-600">
                      <div className="flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-stone-400" />
                        <span>{shop.city}</span>
                      </div>
                      <div className="text-[10px] text-stone-400 font-semibold">{shop.country}</div>
                    </td>

                    {/* Score */}
                    <td className="py-3.5 px-3 text-center">
                      <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-black font-mono-num bg-emerald-100 text-emerald-800">
                        {salesCount}
                      </span>
                    </td>

                    {/* Revenue */}
                    <td className="py-3.5 px-3 text-right font-mono-num font-bold text-stone-900">
                      {formatCurrency(revenue30d, shop.currency)}
                    </td>

                    {/* Status */}
                    <td className="py-3.5 px-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                        user.status === 'active' 
                          ? 'bg-emerald-100 text-emerald-800' 
                          : 'bg-rose-100 text-rose-800'
                      }`}>
                        {user.status === 'active' ? 'Actif' : 'Suspendu'}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        
                        {/* Switch / Impersonate */}
                        <button
                          onClick={() => onImpersonate(user)}
                          className="px-2.5 py-1 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs transition flex items-center gap-1"
                          title="Accéder à la gestion de cette boutique"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Prendre la main</span>
                        </button>

                        {/* Audit / Details */}
                        <button
                          onClick={() => setInspectUser({ user, shop })}
                          className="p-1.5 rounded-xl text-stone-500 hover:text-stone-900 hover:bg-stone-100"
                          title="Fiche d'audit"
                        >
                          <Building2 className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => setPlanShop({ id: user.shopId, name: shop.shopName })}
                          className="p-1.5 rounded-xl text-stone-500 hover:text-emerald-700 hover:bg-emerald-50"
                          title="Abonnement (activer / bloquer)"
                        >
                          <CreditCard className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => handleResetPw(user)}
                          className="p-1.5 rounded-xl text-stone-400 hover:text-amber-700 hover:bg-amber-50"
                          title="Réinitialiser le mot de passe"
                        >
                          <KeyRound className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => handleDelete(user)}
                          className="p-1.5 rounded-xl text-stone-400 hover:text-rose-600 hover:bg-rose-50"
                          title="Supprimer le compte"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>

                        {/* Toggle active / suspend */}
                        <button
                          onClick={() => handleToggleStatus(user)}
                          className={`p-1.5 rounded-xl transition ${
                            user.status === 'active' 
                              ? 'text-stone-400 hover:text-rose-600 hover:bg-rose-50' 
                              : 'text-emerald-700 hover:bg-emerald-50'
                          }`}
                          title={user.status === 'active' ? "Suspendre ce compte" : "Réactiver"}
                        >
                          {user.status === 'active' ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                        </button>

                      </div>
                    </td>

                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {data && data.pages > 1 && (
          <div className="flex items-center justify-between gap-2 p-3 border-t border-stone-100 text-xs font-semibold text-stone-600">
            <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}
              className="px-3 py-1.5 rounded-xl border border-stone-200 disabled:opacity-40 flex items-center gap-1">
              <ChevronLeft className="w-3.5 h-3.5" /> Précédent
            </button>
            <span>Page {data.page} / {data.pages}</span>
            <button disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 rounded-xl border border-stone-200 disabled:opacity-40 flex items-center gap-1">
              Suivant <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Inspect Merchant Audit Modal */}
      {planShop && <ShopPlanModal shopId={planShop.id} shopName={planShop.name} onClose={() => setPlanShop(null)} />}
      {inspectUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-stone-200 p-5 sm:p-6 my-auto animate-in fade-in zoom-in-95 space-y-4">
            
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center text-lg">
                  {BUSINESS_PRESETS[inspectUser.shop.businessCategory]?.icon || '🏢'}
                </div>
                <div>
                  <h3 className="font-black text-base text-stone-900">{inspectUser.shop.shopName}</h3>
                  <p className="text-xs text-stone-500">{inspectUser.shop.businessType} • {inspectUser.shop.city}</p>
                </div>
              </div>
              <button onClick={() => setInspectUser(null)} className="text-stone-400 p-1">✕</button>
            </div>

            <div className="space-y-3 text-xs sm:text-sm">
              <div className="p-3 bg-stone-50 rounded-2xl border border-stone-100 space-y-1">
                <div className="flex justify-between">
                  <span className="text-stone-500">Gérant :</span>
                  <span className="font-bold text-stone-900">{inspectUser.user.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Contact Téléphone / WhatsApp :</span>
                  <span className="font-bold text-stone-900">{inspectUser.user.phone}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Email :</span>
                  <span className="font-mono text-stone-700">{inspectUser.user.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Date d'inscription :</span>
                  <span>{new Date(inspectUser.user.createdAt).toLocaleDateString('fr-FR')}</span>
                </div>
              </div>

              <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 space-y-1">
                <div className="font-bold text-amber-900 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-amber-700" />
                  <span>Statut Légal & Éligibilité Bancaire</span>
                </div>
                <div className="flex justify-between text-xs mt-1">
                  <span className="text-amber-800">Formalisation RCCM :</span>
                  <span className="font-bold">{inspectUser.shop.isFormalized ? `Inscrit (${inspectUser.shop.rccmNumber || 'RCCM Actif'})` : 'Activité Informelle'}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-amber-800">Devise de transaction :</span>
                  <span className="font-mono-num font-bold">{inspectUser.shop.currency}</span>
                </div>
              </div>
            </div>

            <div className="pt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setInspectUser(null)}
                className="flex-1 py-2.5 rounded-xl border border-stone-300 text-stone-700 font-bold text-xs"
              >
                Fermer
              </button>
              <button
                type="button"
                onClick={() => {
                  onImpersonate(inspectUser.user);
                  setInspectUser(null);
                }}
                className="flex-1 py-2.5 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white font-bold text-xs flex items-center justify-center gap-1.5"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Ouvrir la Caisse & Gestion</span>
              </button>
            </div>

          </div>
        </div>
      )}

      </>)}
    </div>
  );
};
