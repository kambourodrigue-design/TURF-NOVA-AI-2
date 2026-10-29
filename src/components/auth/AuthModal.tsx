import { Logo } from '../brand/Logo';
import React, { useState } from 'react';
import { UserAccount, ShopSettings, BusinessCategoryType } from '../../types';
import { api, ApiError } from '../../services/api';
import { BUSINESS_PRESETS } from '../../services/businessPresets';
import { 
  User, 
  LogIn, 
  UserPlus, 
  Store, 
  ShieldCheck, 
  X, 
  CheckCircle, 
  Sparkles,
  ArrowRight,
  Phone,
  Mail
} from 'lucide-react';
import { Select } from '../common/dialogs';

interface AuthModalProps {
  onClose: () => void;
  onAuthSuccess: (user: UserAccount, shop: ShopSettings | null, isNew: boolean) => void;
  initialMode?: 'login' | 'register';
  canClose?: boolean;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  onClose,
  onAuthSuccess,
  initialMode = 'login',
  canClose = true,
}) => {
  const [activeTab, setActiveTab] = useState<'login' | 'register'>(initialMode);
  
  // Login fields
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotId, setForgotId] = useState('');
  const [forgotDone, setForgotDone] = useState<{ contact: string } | null>(null);

  // Register fields
  const [regFullName, setRegFullName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regShopName, setRegShopName] = useState('');
  const [regSector, setRegSector] = useState<BusinessCategoryType>('retail_food');
  const [regCity, setRegCity] = useState('Abidjan');
  const [regCountry, setRegCountry] = useState("Côte d'Ivoire");
  const [regPassword, setRegPassword] = useState('');
  const [regPassword2, setRegPassword2] = useState('');
  const [regError, setRegError] = useState<string | null>(null);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setBusy(true);
    try {
      const res = await api.login(loginIdentifier, loginPassword);
      onAuthSuccess(res.user, res.shop, false);
      onClose();
    } catch (err) {
      setLoginError(
        err instanceof ApiError && err.status === 0
          ? 'Connexion internet requise pour se connecter.'
          : (err as Error).message
      );
    } finally {
      setBusy(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setBusy(true);
    try {
      const res = await api.forgot(forgotId);
      setForgotDone({ contact: res.contact || '' });
    } catch (err) {
      setLoginError(
        err instanceof ApiError && err.status === 0 ? 'Connexion internet requise.' : (err as Error).message
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError(null);
    if (!regFullName.trim() || !regPhone.trim() || !regShopName.trim()) {
      setRegError("Veuillez renseigner votre nom, téléphone et nom d'entreprise.");
      return;
    }
    if (regPassword.length < 8) {
      setRegError('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    if (regPassword !== regPassword2) {
      setRegError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.register({
        fullName: regFullName,
        email: regEmail,
        phone: regPhone,
        password: regPassword,
        shopName: regShopName,
        businessCategory: regSector,
        city: regCity,
        country: regCountry,
      });
      onAuthSuccess(res.user, res.shop, true);
      onClose();
    } catch (err) {
      setRegError(
        err instanceof ApiError && err.status === 0
          ? "Connexion internet requise pour créer un compte."
          : (err as Error).message
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-stone-200 p-5 sm:p-7 my-auto animate-in fade-in zoom-in-95 space-y-5 max-h-[92vh] overflow-y-auto">
        
        {/* Top Header */}
        <div className="flex items-center justify-between pb-3 border-b border-stone-100">
          <div className="flex items-center gap-2">
            <Logo variant="mark" on="auto" className="h-11 shrink-0" />
            <div>
              <h3 className="font-black text-lg text-stone-900">Espace Utilisateur Nafora</h3>
              <p className="text-xs text-stone-500">Connexion et Inscription multi-activités</p>
            </div>
          </div>
          {canClose && (
            <button onClick={onClose} className="p-1 rounded-xl text-stone-400 hover:text-stone-700">✕</button>
          )}
        </div>

        {/* Tab switch */}
        <div className="grid grid-cols-2 p-1 bg-stone-100 rounded-2xl text-xs sm:text-sm font-bold">
          <button
            onClick={() => setActiveTab('login')}
            className={`py-2 rounded-xl transition ${
              activeTab === 'login'
                ? 'bg-white text-emerald-900 shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Se Connecter
          </button>
          <button
            onClick={() => setActiveTab('register')}
            className={`py-2 rounded-xl transition ${
              activeTab === 'register'
                ? 'bg-white text-emerald-900 shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Créer un Compte
          </button>
        </div>

        {/* LOGIN TAB */}
        {activeTab === 'login' && forgotMode && (
          <div className="space-y-4">
            {forgotDone ? (
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm font-semibold">
                  ✅ Demande envoyée. Si ce compte existe, l'administrateur vous enverra un mot de passe temporaire.
                </div>
                {forgotDone.contact && (
                  <a
                    href={`https://wa.me/${forgotDone.contact}?text=${encodeURIComponent(`Bonjour, j'ai oublié mon mot de passe Nafora. Mon identifiant : ${forgotId}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full text-center py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm"
                  >
                    💬 Contacter l'administrateur sur WhatsApp
                  </a>
                )}
              </div>
            ) : (
              <form onSubmit={handleForgotSubmit} className="space-y-3.5">
                <p className="text-xs text-stone-600">
                  Indiquez votre téléphone ou email. L'administrateur sera prévenu et vous enverra un mot de passe temporaire.
                </p>
                <input
                  type="text"
                  required
                  placeholder="Téléphone ou email du compte"
                  value={forgotId}
                  onChange={(e) => setForgotId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-medium"
                />
                {loginError && (
                  <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">{loginError}</div>
                )}
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full py-3 rounded-xl bg-emerald-800 hover:bg-emerald-900 disabled:opacity-60 text-white font-black text-sm"
                >
                  {busy ? 'Envoi…' : 'Envoyer la demande'}
                </button>
              </form>
            )}
            <button
              type="button"
              onClick={() => { setForgotMode(false); setForgotDone(null); setLoginError(null); }}
              className="w-full text-xs text-stone-500 underline"
            >
              ← Retour à la connexion
            </button>
          </div>
        )}

        {activeTab === 'login' && !forgotMode && (
          <div className="space-y-4">
            <form onSubmit={handleLoginSubmit} className="space-y-3.5">
              <div>
                <label className="text-xs font-bold text-stone-700">Email ou Numéro de Téléphone *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: nom@exemple.com ou +225 07..."
                  autoComplete="username"
                  value={loginIdentifier}
                  onChange={(e) => setLoginIdentifier(e.target.value)}
                  className="w-full mt-1 px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-emerald-700"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-stone-700">Mot de passe *</label>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="w-full mt-1 px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-emerald-700"
                />
              </div>

              {loginError && (
                <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">
                  {loginError}
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full py-3 rounded-xl bg-emerald-800 hover:bg-emerald-900 disabled:opacity-60 text-white font-black text-sm shadow-sm transition active:scale-95 flex items-center justify-center gap-2"
              >
                <LogIn className="w-4 h-4" />
                <span>{busy ? 'Connexion…' : 'Se Connecter'}</span>
              </button>
            </form>

            <button
              type="button"
              onClick={() => { setForgotMode(true); setLoginError(null); setForgotId(loginIdentifier); }}
              className="w-full text-xs text-emerald-800 font-bold underline"
            >
              Mot de passe oublié ?
            </button>


          </div>
        )}

        {/* REGISTER TAB */}
        {activeTab === 'register' && (
          <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
            <div>
              <label className="text-xs font-bold text-stone-700">Nom & Prénoms du Promoteur / Gérant *</label>
              <input
                type="text"
                required
                placeholder="Ex: Seydou Kouamé"
                value={regFullName}
                onChange={(e) => setRegFullName(e.target.value)}
                className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-stone-700">Nom du Commerce ou de l'Entreprise *</label>
              <input
                type="text"
                required
                placeholder="Ex: Quincaillerie de la Paix, Atelier Chic..."
                value={regShopName}
                onChange={(e) => setRegShopName(e.target.value)}
                className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm"
              />
            </div>

            {/* Economic Sector Selector */}
            <div>
              <label className="text-xs font-bold text-stone-700">
                Secteur d'Activité Économique *
              </label>
              <Select
                value={regSector}
                onChange={(e) => setRegSector(e.target.value as BusinessCategoryType)}
                className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs sm:text-sm font-bold text-emerald-900"
              >
                {Object.values(BUSINESS_PRESETS).map(preset => (
                  <option key={preset.id} value={preset.id}>
                    {preset.icon} {preset.title}
                  </option>
                ))}
              </Select>
              <p className="text-[11px] text-stone-500 mt-1 italic">
                {BUSINESS_PRESETS[regSector]?.tagline}
              </p>
            </div>

            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-stone-700">Téléphone / WhatsApp *</label>
                <input
                  type="tel"
                  required
                  placeholder="+225 07..."
                  value={regPhone}
                  onChange={(e) => setRegPhone(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-stone-700">Email (optionnel)</label>
                <input
                  type="email"
                  placeholder="contact@exemple.com"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-stone-700">Pays *</label>
                <input
                  type="text"
                  required
                  value={regCountry}
                  onChange={(e) => setRegCountry(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-stone-700">Ville & Quartier *</label>
                <input
                  type="text"
                  required
                  value={regCity}
                  onChange={(e) => setRegCity(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-stone-700">Mot de passe * (8 car. min.)</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-stone-700">Confirmer *</label>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={regPassword2}
                  onChange={(e) => setRegPassword2(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm"
                />
              </div>
            </div>

            {regError && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">
                {regError}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full py-3 rounded-xl bg-emerald-800 hover:bg-emerald-900 disabled:opacity-60 text-white font-black text-sm shadow-sm transition active:scale-95 flex items-center justify-center gap-2"
            >
              <UserPlus className="w-4 h-4" />
              <span>{busy ? 'Création…' : 'Créer mon Compte PME'}</span>
            </button>
          </form>
        )}

      </div>
    </div>
  );
};
