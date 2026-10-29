import React, { useState } from 'react';
import { ShopSettings, CurrencyCode } from '../../types';
import { storage } from '../../services/storage';
import { api } from '../../services/api';
import { TeamPanel } from './TeamPanel';
import { BillingPanel } from './BillingPanel';
import { CatalogPanel } from './CatalogPanel';
import { 
  Settings as SettingsIcon, 
  X, 
  Save, 
  Download, 
  Upload, 
  RotateCcw, 
  ShieldCheck, 
  HardDrive,
  Check
} from 'lucide-react';
import { Select } from '../common/dialogs';
import { uiAlert, uiConfirm } from '../common/dialogs';

interface SettingsModalProps {
  settings: ShopSettings;
  onSaveSettings: (settings: ShopSettings) => void;
  onClose: () => void;
  onReloadAllData: () => void;
  onClearData: (kind: 'sales' | 'expenses' | 'customers' | 'suppliers' | 'products' | 'all' | 'sample') => void;
  isDemo?: boolean;
  shopRole?: 'owner' | 'manager' | 'cashier';
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  onSaveSettings,
  onClose,
  onReloadAllData,
  onClearData,
  isDemo = false,
  shopRole = 'owner',
}) => {
  const isOwner = isDemo || shopRole === 'owner';
  const isCashier = !isDemo && shopRole === 'cashier';
  const [formData, setFormData] = useState<ShopSettings>({ ...settings });
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const [pwCur, setPwCur] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwMsg, setPwMsg] = useState<string | null>(null);

  const handleChangePassword = async () => {
    setPwMsg(null);
    if (pwNew.length < 8) { setPwMsg('Nouveau mot de passe : 8 caractères minimum.'); return; }
    try {
      await api.changePassword(pwCur, pwNew);
      setPwMsg('✅ Mot de passe modifié.');
      setPwCur(''); setPwNew('');
    } catch (e) { setPwMsg('❌ ' + (e as Error).message); }
  };

  const handleLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 256;
      const ratio = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * ratio);
      c.height = Math.round(img.height * ratio);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      let data = c.toDataURL('image/png');
      if (data.length > 90_000) data = c.toDataURL('image/jpeg', 0.8); // garde le fichier léger
      setFormData(f => ({ ...f, logo: data }));
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { uiAlert('Image illisible.'); URL.revokeObjectURL(url); };
    img.src = url;
    e.target.value = '';
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings(formData);
    onClose();
  };

  const handleExportBackup = () => {
    const jsonStr = storage.exportBackupJson();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `nafora_sauvegarde_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const success = storage.importBackupJson(content);
      if (success) {
        setImportStatus("Sauvegarde restaurée avec succès !");
        setTimeout(() => {
          onReloadAllData();
          onClose();
        }, 1200);
      } else {
        setImportStatus("Erreur : Fichier de sauvegarde invalide.");
      }
    };
    reader.readAsText(file);
  };

  const handleResetDemo = async () => {
    const msg = isDemo
      ? "Réinitialiser les données avec les exemples par défaut ?"
      : "Effacer TOUTES les données de votre boutique (produits, ventes, dépenses, clients) ? Cette action est définitive.";
    if (await uiConfirm(msg)) {
      if (isDemo) { storage.resetToDemo(); onReloadAllData(); } else { onClearData('all'); }
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-stone-200 p-5 sm:p-6 my-auto animate-in fade-in zoom-in-95 space-y-5 max-h-[92vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-stone-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
              <SettingsIcon className="w-4 h-4" />
            </div>
            <h3 className="font-black text-lg text-stone-900">Paramètres de la Boutique</h3>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 p-1 rounded-xl">✕</button>
        </div>

        {!isCashier && (<form onSubmit={handleSubmit} className="space-y-4">
          
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-stone-50 border border-stone-200">
            <div className="w-16 h-16 rounded-xl bg-white border border-stone-200 flex items-center justify-center overflow-hidden shrink-0">
              {formData.logo
                ? <img src={formData.logo} alt="Logo" className="w-full h-full object-contain" />
                : <span className="text-2xl">🏪</span>}
            </div>
            <div className="flex-1 space-y-1.5">
              <span className="text-xs font-bold text-stone-700 block">Logo de la boutique (en-tête et reçus)</span>
              <div className="flex gap-2">
                <label className="px-3 py-1.5 rounded-lg bg-emerald-800 hover:bg-emerald-900 text-white font-bold text-xs cursor-pointer">
                  Choisir une image
                  <input type="file" accept="image/*" onChange={handleLogoFile} className="hidden" />
                </label>
                {formData.logo && (
                  <button type="button" onClick={() => setFormData({ ...formData, logo: undefined })}
                    className="px-3 py-1.5 rounded-lg bg-stone-200 text-stone-700 font-bold text-xs">Retirer</button>
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-stone-700">Nom du Commerce / Boutique *</label>
            <input
              type="text"
              required
              value={formData.shopName}
              onChange={(e) => setFormData({ ...formData, shopName: e.target.value })}
              className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm font-semibold"
            />
          </div>

          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-stone-700">Nom du Gérant / Propriétaire</label>
              <input
                type="text"
                value={formData.ownerName}
                onChange={(e) => setFormData({ ...formData, ownerName: e.target.value })}
                className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-stone-700">Devise Principale</label>
              <Select
                value={formData.currency}
                onChange={(e) => setFormData({ ...formData, currency: e.target.value as CurrencyCode })}
                className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold text-emerald-800"
              >
                <option value="XOF">FCFA (XOF - UEMOA)</option>
                <option value="GNF">GNF (Franc Guinéen)</option>
                <option value="USD">USD ($ Dollar)</option>
                <option value="EUR">EUR (€ Euro)</option>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-stone-700">Pays</label>
              <input
                type="text"
                value={formData.country}
                onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-stone-700">Ville & Quartier</label>
              <input
                type="text"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-stone-700">Téléphone / Compte Mobile Money</label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm"
                placeholder="+225 07..."
              />
            </div>

            <div>
              <label className="text-xs font-bold text-stone-700">Secteur d'Activité</label>
              <Select
                value={formData.businessCategory || 'retail_food'}
                onChange={(e) => setFormData({ ...formData, businessCategory: e.target.value as any })}
                className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs sm:text-sm font-bold text-emerald-900"
              >
                <option value="retail_food">🛒 Commerce Général & Alimentation</option>
                <option value="fashion_tailor">👗 Couture & Atelier Mode</option>
                <option value="hardware_craft">🔨 Quincaillerie & BTP</option>
                <option value="restaurant_maquis">🍽️ Restaurant, Fast-food & Maquis</option>
                <option value="beauty_salon">💇 Salon Coiffure & Esthétique</option>
                <option value="garage_mechanic">🔧 Garage & Pièces Auto/Moto</option>
                <option value="services_cyber">📱 Services, Cyber & Mobile Money</option>
                <option value="health_pharma">💊 Dépôt Pharmaceutique</option>
                <option value="other">🏢 Autre Activité</option>
              </Select>
            </div>
          </div>

          {/* Legal / Formalization identifiers */}
          <div className="p-3 bg-stone-50 rounded-2xl border border-stone-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-stone-800 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-800" />
                <span>Statut Légal & Numéros d'Enregistrement</span>
              </span>
              <label className="flex items-center gap-1.5 text-xs text-stone-600 font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.isFormalized}
                  onChange={(e) => setFormData({ ...formData, isFormalized: e.target.checked })}
                  className="rounded text-emerald-800 focus:ring-emerald-700"
                />
                <span>Formalisé (RCCM)</span>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <input
                  type="text"
                  placeholder="N° RCCM (ex: CI-ABJ-...)"
                  value={formData.rccmNumber || ''}
                  onChange={(e) => setFormData({ ...formData, rccmNumber: e.target.value })}
                  className="w-full px-2.5 py-1.5 bg-white border border-stone-200 rounded-lg text-xs"
                />
              </div>
              <div>
                <input
                  type="text"
                  placeholder="N° Compte Contribuable / IFU"
                  value={formData.taxId || ''}
                  onChange={(e) => setFormData({ ...formData, taxId: e.target.value })}
                  className="w-full px-2.5 py-1.5 bg-white border border-stone-200 rounded-lg text-xs"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-3 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white font-black text-sm shadow-sm flex items-center justify-center gap-2 active:scale-95"
          >
            <Save className="w-4 h-4" />
            <span>Enregistrer les Paramètres</span>
          </button>

        </form>)}

        {/* Offline Storage & Backup Management */}
        <div className="pt-3 border-t border-stone-200 space-y-3">
          <div className="flex items-center gap-2 text-stone-800 font-bold text-xs uppercase tracking-wider">
            <HardDrive className="w-4 h-4 text-stone-600" />
            <span>Sauvegarde Locale & Sécurité Hors-Ligne</span>
          </div>

          <p className="text-xs text-stone-500">
            Toutes vos données sont stockées directement sur votre téléphone/appareil et fonctionnent 100% sans connexion internet.
          </p>

          {importStatus && (
            <div className="p-2.5 bg-emerald-100 text-emerald-900 rounded-xl text-xs font-semibold text-center">
              {importStatus}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleExportBackup}
              className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 font-bold text-xs transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exporter Données</span>
            </button>

            {isOwner && (            <label className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 font-bold text-xs transition cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>Restaurer Fichier</span>
              <input
                type="file"
                accept=".json"
                onChange={handleImportBackup}
                className="hidden"
              />
            </label>)}
          </div>

          {!isDemo && (
            <div className="pt-2 border-t border-stone-200/80 space-y-2">
              <span className="text-[11px] font-extrabold text-stone-600 uppercase tracking-wider block">
                Mon mot de passe
              </span>
              <div className="grid grid-cols-2 gap-2">
                <input type="password" placeholder="Mot de passe actuel" autoComplete="current-password" value={pwCur}
                  onChange={(e) => setPwCur(e.target.value)}
                  className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm" />
                <input type="password" placeholder="Nouveau (8 car. min.)" autoComplete="new-password" value={pwNew}
                  onChange={(e) => setPwNew(e.target.value)}
                  className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm" />
              </div>
              <button type="button" onClick={handleChangePassword}
                className="w-full py-2 rounded-xl bg-stone-800 hover:bg-stone-900 text-white font-bold text-xs">
                Changer mon mot de passe
              </button>
              {pwMsg && <p className="text-xs font-semibold text-stone-700">{pwMsg}</p>}
            </div>
          )}

          {isOwner && (
            <div className="pt-2 border-t border-stone-200/80 space-y-2">
              <span className="text-[11px] font-extrabold text-stone-600 uppercase tracking-wider block">
                Trésorerie de départ
              </span>
              <p className="text-[11px] text-stone-500">L'argent que vous aviez avant de commencer à enregistrer (sert au calcul de la trésorerie du tableau de bord).</p>
              <div className="grid grid-cols-3 gap-2">
                {([['openingCash', 'Espèces'], ['openingMobile', 'Mobile Money'], ['openingBank', 'Banque']] as const).map(([k, label]) => (
                  <div key={k}>
                    <label className="text-[10px] font-bold text-stone-600">{label}</label>
                    <input type="number" min="0" value={(formData as any)[k] ?? ''}
                      onChange={(e) => setFormData({ ...formData, [k]: e.target.value === '' ? undefined : Number(e.target.value) } as ShopSettings)}
                      className="w-full px-2 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm font-mono-num" />
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => { onSaveSettings(formData); setImportStatus('Trésorerie de départ enregistrée.'); }}
                className="w-full py-2 rounded-xl bg-stone-800 hover:bg-stone-900 text-white font-bold text-xs">
                Enregistrer la trésorerie de départ
              </button>
            </div>
          )}

          {!isDemo && isOwner && <CatalogPanel shopName={formData.shopName || ''} />}
          {!isDemo && isOwner && <BillingPanel />}
          {!isDemo && isOwner && <TeamPanel />}

          {/* Gestion des données */}
          {isOwner && (<>
          <div className="pt-2 border-t border-stone-200/80 space-y-2">
            <span className="text-[11px] font-extrabold text-stone-600 uppercase tracking-wider block">
              Effacer des données (pour saisir vos vraies données)
            </span>
            <div className="grid grid-cols-2 gap-2">
              {([
                ['sales', '🧾 Ventes'],
                ['expenses', '💸 Dépenses / achats'],
                ['customers', '👥 Clients & créances'],
                ['suppliers', '🚚 Fournisseurs & dettes'],
                ['products', '📦 Produits & stock'],
              ] as const).map(([kind, label]) => (
                <button
                  key={kind}
                  type="button"
                  onClick={async () => {
                    if (await uiConfirm(`Effacer définitivement : ${label.slice(3)} ?`)) onClearData(kind);
                  }}
                  className="p-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-800 font-bold text-xs border border-rose-200 transition"
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={async () => {
                  if (await uiConfirm("Charger un catalogue d'exemple de votre secteur ? Il REMPLACERA vos produits actuels.")) onClearData('sample');
                }}
                className="p-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 font-bold text-xs border border-stone-200 transition"
              >
                ✨ Catalogue d'exemple
              </button>
            </div>
          </div>

          <div className="pt-2 text-center">
            <button
              type="button"
              onClick={handleResetDemo}
              className="text-xs text-stone-400 hover:text-stone-600 underline flex items-center justify-center gap-1 mx-auto"
            >
              <RotateCcw className="w-3 h-3" /> {isDemo ? 'Réinitialiser les données exemples' : 'Effacer toutes les données de la boutique'}
            </button>
          </div>
          </>)}

        </div>

      </div>
    </div>
  );
};
