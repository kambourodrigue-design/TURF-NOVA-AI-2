/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { Product, Sale, Expense, Customer, Supplier, ShopSettings, UserAccount } from './types';
import { storage } from './services/storage';
import { calculateCreditScore } from './services/creditScore';
import { authCache, DEMO_USER } from './services/auth';
import { api, ApiError, PlanStatus } from './services/api';
import { SyncEngine, fetchAllChanges, buildSnapshot, type Snapshot, type SyncInfo } from './services/syncEngine';
import { initialShopSettings } from './data/initialData';
import { getSectorProducts } from './data/sectorCatalogSeeds';

// Components
import { Navbar } from './components/common/Navbar';
import { BottomNav } from './components/common/BottomNav';
import { AnnouncementsBar } from './components/common/AnnouncementsBar';
import { AssistantView } from './components/assistant/AssistantView';
import { OfflineIndicator } from './components/common/OfflineIndicator';
import { SettingsModal } from './components/settings/SettingsModal';
import { AuthModal } from './components/auth/AuthModal';
import { LandingPage } from './components/landing/LandingPage';

import { Logo } from './components/brand/Logo';
import { DailyDashboard } from './components/dashboard/DailyDashboard';
import { POSView } from './components/pos/POSView';
import { StockView } from './components/stock/StockView';
import { ExpensesView } from './components/expenses/ExpensesView';
import { DebtsView } from './components/debts/DebtsView';
import { FinancesView } from './components/finances/FinancesView';
import { CreditScoreView } from './components/credit/CreditScoreView';
import { FormalizationGuide } from './components/formalization/FormalizationGuide';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { uiAlert, uiConfirm } from './components/common/dialogs';

type SessionState = 'loading' | 'out' | 'in';
type ShopRole = 'owner' | 'manager' | 'cashier';
const ALL_TABS = ['dashboard', 'pos', 'finances', 'stock', 'expenses', 'debts', 'assistant', 'credit', 'formalization'];
const tabsFor = (role: ShopRole): string[] =>
  role === 'cashier' ? ['pos', 'debts'] : ALL_TABS;
const ROLE_LABEL: Record<ShopRole, string> = { owner: 'PRO', manager: 'GÉRANT', cashier: 'CAISSIER' };

export default function App() {
  // Authentification
  const [session, setSession] = useState<SessionState>('loading');
  const [isDemo, setIsDemo] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserAccount>(DEMO_USER);
  const [viewingAs, setViewingAs] = useState<UserAccount | null>(null); // admin en consultation
  const [syncInfo, setSyncInfo] = useState<SyncInfo>({ status: 'idle', pending: 0, lastSync: null });

  // Master application states
  const [products, setProducts] = useState<Product[]>(() => storage.getProducts());
  const [sales, setSales] = useState<Sale[]>(() => storage.getSales());
  const [expenses, setExpenses] = useState<Expense[]>(() => storage.getExpenses());
  const [customers, setCustomers] = useState<Customer[]>(() => storage.getCustomers());
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => storage.getSuppliers());
  const [settings, setSettings] = useState<ShopSettings>(() => {
    const saved = storage.getSettings();
    return {
      ...saved,
      shopId: saved.shopId || 'shop-1',
      businessCategory: saved.businessCategory || 'retail_food',
    };
  });

  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  // --- Synchronisation serveur (voir services/syncEngine.ts) -----------------
  const shopRole: ShopRole = isDemo ? 'owner' : (currentUser.shopRole || 'owner');
  const isPlatformAdmin = currentUser.role === 'admin';
  const syncEnabled = session === 'in' && !isDemo && !viewingAs;

  // Visite anonyme comptée une fois par session de navigation (aucun cookie)
  useEffect(() => {
    try { if (sessionStorage.getItem('sb_hit')) return; sessionStorage.setItem('sb_hit', '1'); } catch { /* ignore */ }
    api.hit().catch(() => { /* ignore */ });
  }, []);

  // Visiteur non connecté : page d'accueil publique (l'application installée ouvre directement la connexion)
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(() => {
    try { return window.matchMedia('(display-mode: standalone)').matches ? 'login' : null; } catch { return null; }
  });
  const [plan, setPlan] = useState<PlanStatus | null>(null);
  // Retour de la page de paiement Money Fusion : on confirme le paiement côté serveur puis on rafraîchit le plan
  useEffect(() => {
    if (!syncEnabled || isPlatformAdmin) return;
    let back = false;
    try { back = new URLSearchParams(location.search).get('mf') === 'return'; } catch { /* ignore */ }
    if (!back) return;
    try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ }
    api.mfCheck().then(async (r) => {
      if (r.approved > 0) { uiAlert('✅ Paiement confirmé ! Votre abonnement annuel Nafora Pro est actif.'); api.billing().then(x => setPlan(x.status)).catch(() => {}); }
      else if (r.pending > 0) uiAlert("⏳ Paiement en cours de confirmation. Ouvrez Paramètres → Abonnement et touchez « Vérifier mon paiement » dans un instant.");
    }).catch(() => { /* hors-ligne : le panneau Abonnement permettra de revérifier */ });
  }, [syncEnabled, isPlatformAdmin]);
  useEffect(() => {
    if (!syncEnabled || isPlatformAdmin) { setPlan(null); return; }
    const load = () => api.billing().then(r => setPlan(r.status)).catch(() => { /* hors-ligne : on garde l'état connu */ });
    load();
    const id = setInterval(load, 10 * 60_000);   // un abonnement validé ou expiré est pris en compte sans reconnexion
    return () => clearInterval(id);
  }, [syncEnabled, isPlatformAdmin, shopRole]);
  // L'administrateur n'est jamais en lecture seule, quelle que soit la réponse du serveur
  const readOnly = !isPlatformAdmin && !!plan?.readOnly;
  const [roToast, setRoToast] = useState(false);
  const blocked = () => { setRoToast(true); setTimeout(() => setRoToast(false), 3500); };

  const latest = useRef<Snapshot>({ products, sales, expenses, customers, suppliers, settings });
  latest.current = { products, sales, expenses, customers, suppliers, settings };
  const unauthorizedRef = useRef<() => void>(() => {});
  const engineRef = useRef<SyncEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new SyncEngine({
      getSnapshot: () => latest.current,
      flush: () => { try { flushSync(() => {}); } catch { /* ignore */ } },
      setSnapshot: (p) => {
        latest.current = { ...latest.current, ...p };
        flushSync(() => {
          if (p.products) setProducts(p.products);
          if (p.sales) setSales(p.sales);
          if (p.expenses) setExpenses(p.expenses);
          if (p.customers) setCustomers(p.customers);
          if (p.suppliers) setSuppliers(p.suppliers);
          if (p.settings) setSettings(p.settings);
        });
      },
      onInfo: setSyncInfo,
      onUnauthorized: () => unauthorizedRef.current(),
      onReadOnly: () => api.billing().then(r => setPlan(r.status)).catch(() => { /* ignore */ }),
    });
  }
  const engine = engineRef.current;

  const goLoggedOut = useCallback(() => {
    engine.destroy();
    authCache.clear();
    storage.wipeLocal();
    setProducts(storage.getProducts());
    setSales(storage.getSales());
    setExpenses(storage.getExpenses());
    setCustomers(storage.getCustomers());
    setSuppliers(storage.getSuppliers());
    setSettings(storage.getSettings());
    setIsDemo(false);
    setViewingAs(null);
    setActiveTab('dashboard');
    setSession('out');
  }, [engine]);
  unauthorizedRef.current = () => {
    uiAlert('Votre session a expiré ou votre accès a été suspendu. Veuillez vous reconnecter.');
    goLoggedOut();
  };

  const firstTab = (u: UserAccount) =>
    u.role === 'admin' ? 'admin' : (u.shopRole === 'cashier' ? 'pos' : 'dashboard');

  // Au démarrage : reprendre la session si elle existe
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api.me();
        if (cancelled) return;
        setCurrentUser(me.user);
        authCache.set(me.user);
        await engine.start(me.user.shopId);
        if (cancelled) return;
        setSession('in');
        setActiveTab(firstTab(me.user));
      } catch (e) {
        if (cancelled) return;
        const cached = authCache.get();
        if (e instanceof ApiError && e.status === 0 && cached) {
          // hors-ligne : on continue avec les données locales, tout sera envoyé au retour du réseau
          setCurrentUser(cached);
          try { await engine.start(cached.shopId); } catch { /* données locales seulement */ }
          if (cancelled) return;
          setSession('in');
          setActiveTab(firstTab(cached));
        } else {
          goLoggedOut();
        }
      }
    })();
    return () => { cancelled = true; };
  }, [engine, goLoggedOut]);

  // Cache local (sert au mode hors-ligne) — pas pendant la consultation d'une autre boutique
  useEffect(() => { if (!viewingAs) storage.saveProducts(products); }, [products, viewingAs]);
  useEffect(() => { if (!viewingAs) storage.saveSales(sales); }, [sales, viewingAs]);
  useEffect(() => { if (!viewingAs) storage.saveExpenses(expenses); }, [expenses, viewingAs]);
  useEffect(() => { if (!viewingAs) storage.saveCustomers(customers); }, [customers, viewingAs]);
  useEffect(() => { if (!viewingAs) storage.saveSuppliers(suppliers); }, [suppliers, viewingAs]);
  useEffect(() => { if (!viewingAs) storage.saveSettings(settings); }, [settings, viewingAs]);

  // Chaque modification est repérée par le moteur, qui l'enverra en différé
  useEffect(() => {
    if (syncEnabled) engine.notify();
  }, [products, sales, expenses, customers, suppliers, settings, syncEnabled, engine]);

  // Dynamic Credit Score Calculation (incorporating both customers and suppliers)
  const creditScore = useMemo(() => {
    return calculateCreditScore(
      sales,
      expenses,
      customers,
      products,
      settings.isFormalized,
      suppliers
    );
  }, [sales, expenses, customers, products, settings.isFormalized, suppliers]);

  // Counts for notification badges
  const lowStockCount = useMemo(() => {
    return products.filter(p => p.stockQuantity <= p.minAlertThreshold).length;
  }, [products]);

  const debtorsCount = useMemo(() => {
    return customers.filter(c => c.totalDebt > 0).length;
  }, [customers]);

  const supplierDebtsCount = useMemo(() => {
    return suppliers.filter(s => s.totalDebt > 0).length;
  }, [suppliers]);

  // Handlers
  const handleRecordSale = (newSale: Sale, updatedProducts: Product[], updatedCustomers: Customer[]) => {
    if (readOnly) { blocked(); return; }
    setSales(prev => [newSale, ...prev]);
    setProducts(updatedProducts);
    setCustomers(updatedCustomers);
  };

  const handleAddExpense = (newExpense: Expense) => {
    if (readOnly) { blocked(); return; }
    setExpenses(prev => [newExpense, ...prev]);
  };

  const handleDeleteExpense = (expenseId: string) => {
    if (readOnly) { blocked(); return; }
    setExpenses(prev => prev.filter(e => e.id !== expenseId));
  };

  const handleUpdateProducts = (updated: Product[]) => {
    if (readOnly) { blocked(); return; }
    setProducts(updated);
  };

  const handleUpdateCustomers = (updated: Customer[]) => {
    if (readOnly) { blocked(); return; }
    setCustomers(updated);
  };

  const handleUpdateSuppliers = (updated: Supplier[]) => {
    if (readOnly) { blocked(); return; }
    setSuppliers(updated);
  };

  const handleSaveSettings = (updated: ShopSettings) => {
    if (readOnly) { blocked(); return; }
    if (!isDemo && shopRole === 'cashier') return;
    setSettings(updated);
    // If business category changed, offer to adapt products
    if (isDemo && updated.businessCategory !== settings.businessCategory) {
      setProducts(getSectorProducts(updated.businessCategory));
    }
  };

  const handleClearData = (kind: 'sales' | 'expenses' | 'customers' | 'suppliers' | 'products' | 'all' | 'sample') => {
    if (readOnly) { blocked(); return; }
    if (!isDemo && shopRole !== 'owner') return;
    if (kind === 'sales' || kind === 'all') setSales([]);
    if (kind === 'expenses' || kind === 'all') setExpenses([]);
    if (kind === 'customers' || kind === 'all') setCustomers([]);
    if (kind === 'suppliers' || kind === 'all') setSuppliers([]);
    if (kind === 'products' || kind === 'all') setProducts([]);
    if (kind === 'sample') setProducts(getSectorProducts(settings.businessCategory));
  };

  const handleReloadAllData = () => {
    setProducts(storage.getProducts());
    setSales(storage.getSales());
    setExpenses(storage.getExpenses());
    setCustomers(storage.getCustomers());
    setSuppliers(storage.getSuppliers());
    setSettings(prev => ({ ...storage.getSettings(), shopId: prev.shopId }));
  };

  // Auth Handlers
  const handleAuthSuccess = async (user: UserAccount, _shop: ShopSettings | null, _isNew: boolean) => {
    setIsDemo(false);
    setCurrentUser(user);
    authCache.set(user);
    setSession('loading');
    try {
      await engine.start(user.shopId); // le serveur fait foi : on charge les données de la boutique
      setSession('in');
      setActiveTab(firstTab(user));
    } catch {
      uiAlert('Impossible de charger vos données. Vérifiez votre connexion et réessayez.');
      try { await api.logout(); } catch { /* ignore */ }
      goLoggedOut();
    }
  };

  const handleLogout = async () => {
    if (!isDemo && syncEnabled) {
      try { await engine.syncNow(); } catch { /* dernière sauvegarde au mieux */ }
      if (engine.pendingCount() > 0 && !await uiConfirm(
        `${engine.pendingCount()} modification(s) n'ont pas encore été envoyées (pas de réseau ?). Elles seront PERDUES si vous vous déconnectez. Se déconnecter quand même ?`
      )) return;
    }
    if (!isDemo) { try { await api.logout(); } catch { /* ignore */ } }
    goLoggedOut();
  };

  // --- Espace admin : consultation d'une boutique (lecture seule) ---
  const handleImpersonate = async (user: UserAccount) => {
    try {
      await engine.syncNow();                    // envoyer d'abord ce qui attend
      engine.stop(true);                         // plus aucun envoi pendant la consultation
      const { changes } = await fetchAllChanges(user.shopId);
      const snap = buildSnapshot(changes, { settings: null });
      engine.applyForeign(snap);
      setViewingAs(user);
      setActiveTab('dashboard');
    } catch (e) { uiAlert((e as Error).message); }
  };

  const handleExitViewing = async () => {
    try {
      setSession('loading');
      await engine.restart(currentUser.shopId);
      setViewingAs(null);
      setActiveTab('admin');
      setSession('in');
    } catch { goLoggedOut(); }
  };

  if (session === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#050b24' }} role="status" aria-label="Chargement de Nafora">
        <Logo variant="stacked" on="dark" className="h-[115px]" />
      </div>
    );
  }

  if (session === 'out') {
    if (!authMode) {
      return <LandingPage onLogin={() => setAuthMode('login')} onRegister={() => setAuthMode('register')} />;
    }
    return (
      <div className="min-h-screen bg-emerald-950">
        <AuthModal
          key={authMode}
          initialMode={authMode}
          canClose={true}
          onClose={() => setAuthMode(null)}
          onAuthSuccess={handleAuthSuccess}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col text-stone-900 selection:bg-emerald-600 selection:text-white">
      
      {/* Offline Toast Indicator */}
      <OfflineIndicator />

      {/* Top Navbar */}
      <Navbar
        settings={settings}
        onOpenSettings={() => setIsSettingsOpen(true)}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        currentUser={currentUser}
        onOpenAuth={() => {}}
        onLogout={handleLogout}
        allowedTabs={isPlatformAdmin ? undefined : tabsFor(shopRole)}
        roleLabel={ROLE_LABEL[shopRole]}
      />

      {viewingAs && (
        <div className="bg-amber-400 text-stone-950 text-xs sm:text-sm font-bold px-4 py-2 flex flex-wrap items-center justify-between gap-2">
          <span>
            👁️ Consultation de la boutique de {viewingAs.name} — les modifications ne sont pas enregistrées.
          </span>
          <button onClick={handleExitViewing} className="px-3 py-1 rounded-lg bg-stone-900 text-white">
            Quitter la consultation
          </button>
        </div>
      )}
      {isDemo && (
        <div className="bg-stone-800 text-amber-300 text-xs font-bold px-4 py-1.5 text-center">
          Mode démo — les données restent sur cet appareil. Déconnectez-vous pour créer un vrai compte.
        </div>
      )}

      {syncEnabled && !isPlatformAdmin && <AnnouncementsBar userId={currentUser.id} />}
      {roToast && (
        <div className="fixed inset-x-0 top-[74px] z-[60] flex justify-center px-4 pointer-events-none">
          <div className="sb-pop inline-flex max-w-full items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold shadow-lg ring-1 ring-red-300 bg-red-50 text-red-950">🔒 Lecture seule : modification non enregistrée</div>
        </div>
      )}
      {readOnly && (
        <div className="px-3 pt-2 max-w-7xl mx-auto w-full">
          <button onClick={() => shopRole === 'owner' && setIsSettingsOpen(true)} className="w-full text-left rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-950" data-testid="readonly-banner">
            🔒 <b>Lecture seule</b> — votre période d'essai est terminée. Vous pouvez consulter vos données, mais plus rien ne s'enregistre.{' '}
            {shopRole === 'owner' ? <b>Activer l'abonnement Pro →</b> : <b>Demandez au propriétaire d'activer l'abonnement.</b>}
          </button>
        </div>
      )}
      {plan?.enforced && !readOnly && ((plan.state === 'trial' && plan.daysLeft <= 7) || plan.state === 'free') && (
        <div className="px-3 pt-2 max-w-7xl mx-auto w-full">
          <button onClick={() => setIsSettingsOpen(true)} className="w-full text-left rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950" data-testid="plan-banner">
            {plan.state === 'trial' ? `Votre essai Pro se termine dans ${plan.daysLeft} jour(s).` : 'Vous êtes sur le plan gratuit.'} <b>Voir l'abonnement →</b>
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-5 lg:p-6 pb-24 xl:pb-8">
        {activeTab === 'dashboard' && (
          <DailyDashboard
            sales={sales}
            expenses={expenses}
            customers={customers}
            suppliers={suppliers}
            products={products}
            settings={settings}
            creditScore={creditScore}
            onNavigate={(tab) => setActiveTab(tab)}
            onQuickSale={() => setActiveTab('pos')}
            onQuickExpense={() => setActiveTab('expenses')}
            onQuickDebt={() => setActiveTab('debts')}
          />
        )}

        {activeTab === 'pos' && readOnly && (
          <div className="max-w-md mx-auto mt-10 text-center bg-white rounded-3xl border border-stone-200 shadow-sm p-8" data-testid="pos-locked">
            <div className="text-4xl mb-3">🔒</div>
            <h3 className="text-lg font-black text-stone-800">Caisse en lecture seule</h3>
            <p className="text-sm text-stone-600 mt-2">Votre période d'essai est terminée. Activez l'abonnement Pro pour enregistrer de nouvelles ventes. Vos ventes et vos données restent consultables.</p>
            {shopRole === 'owner' && <button onClick={() => setIsSettingsOpen(true)} className="mt-5 px-5 py-3 rounded-2xl bg-emerald-700 text-white font-bold">Activer l'abonnement</button>}
          </div>
        )}
        {activeTab === 'pos' && !readOnly && (
          <POSView
            products={products}
            customers={customers}
            settings={settings}
            onRecordSale={handleRecordSale}
          />
        )}

        {activeTab === 'stock' && (
          <StockView
            products={products}
            settings={settings}
            onUpdateProducts={handleUpdateProducts}
            suppliers={suppliers}
            onUpdateSuppliers={handleUpdateSuppliers}
            onAddExpense={handleAddExpense}
          />
        )}

        {activeTab === 'expenses' && (
          <ExpensesView
            expenses={expenses}
            settings={settings}
            onAddExpense={handleAddExpense}
            onDeleteExpense={handleDeleteExpense}
            suppliers={suppliers}
            onUpdateSuppliers={handleUpdateSuppliers}
            products={products}
            onUpdateProducts={handleUpdateProducts}
          />
        )}

        {activeTab === 'debts' && (
          <DebtsView
            customers={customers}
            suppliers={suppliers}
            settings={settings}
            onUpdateCustomers={handleUpdateCustomers}
            onUpdateSuppliers={handleUpdateSuppliers}
            allowSuppliers={shopRole !== 'cashier'}
            onAddExpense={shopRole !== 'cashier' ? handleAddExpense : undefined}
            products={products}
            onUpdateProducts={handleUpdateProducts}
          />
        )}


        {activeTab === 'assistant' && (
          <AssistantView
            sales={sales} expenses={expenses} customers={customers}
            suppliers={suppliers} products={products} settings={settings}
          />
        )}

        {activeTab === 'finances' && (
          <FinancesView
            sales={sales}
            expenses={expenses}
            products={products}
            customers={customers}
            suppliers={suppliers}
            settings={settings}
          />
        )}

        {activeTab === 'credit' && (
          <CreditScoreView
            creditScore={creditScore}
            settings={settings}
            sales={sales}
            expenses={expenses}
            products={products}
            customers={customers}
            suppliers={suppliers}
            onNavigateToFormalization={() => setActiveTab('formalization')}
          />
        )}

        {activeTab === 'formalization' && (
          <FormalizationGuide
            settings={settings}
            onUpdateSettings={handleSaveSettings}
          />
        )}

        {activeTab === 'admin' && (
          <AdminDashboard
            currentUser={currentUser}
            onImpersonate={handleImpersonate}
            onUnauthorized={() => unauthorizedRef.current()}
          />
        )}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <BottomNav
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        lowStockCount={lowStockCount}
        totalDebtorsCount={debtorsCount + supplierDebtsCount}
        isAdmin={isPlatformAdmin}
        allowedTabs={isPlatformAdmin ? undefined : tabsFor(shopRole)}
      />

      {/* Settings & Offline Backup Modal */}
      {isSettingsOpen && (
        <SettingsModal
          settings={settings}
          onSaveSettings={handleSaveSettings}
          onClose={() => setIsSettingsOpen(false)}
          onReloadAllData={handleReloadAllData}
          onClearData={handleClearData}
          isDemo={isDemo}
          shopRole={shopRole}
        />
      )}

      {/* Indicateur de synchronisation : pastille centrée au-dessus de la barre du bas */}
      {syncEnabled && (syncInfo.status === 'syncing' || syncInfo.status === 'error' || (syncInfo.status === 'pending' && syncInfo.pending > 0) || (syncInfo.status === 'offline' && syncInfo.pending > 0)) && (
        <div className="fixed inset-x-0 bottom-[84px] xl:bottom-5 z-40 flex justify-center px-4 pointer-events-none" role="status" aria-live="polite">
          <div className={`sb-pop-up inline-flex max-w-full whitespace-nowrap items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold leading-none shadow-lg ring-1 backdrop-blur ${
            syncInfo.status === 'error' ? 'bg-rose-50/95 text-rose-900 ring-rose-300'
            : syncInfo.status === 'offline' ? 'bg-amber-50/95 text-amber-950 ring-amber-300'
            : 'bg-white/95 text-stone-700 ring-stone-300'
          }`}>
            {syncInfo.status === 'syncing' && (<><span className="w-3.5 h-3.5 rounded-full border-2 border-emerald-600 border-t-transparent animate-spin" /> Synchronisation…</>)}
            {syncInfo.status === 'pending' && `☁️ ${syncInfo.pending} modification${syncInfo.pending > 1 ? 's' : ''} à envoyer`}
            {syncInfo.status === 'offline' && `📴 ${syncInfo.pending} modification${syncInfo.pending > 1 ? 's' : ''} en attente de réseau`}
            {syncInfo.status === 'error' && '⚠️ Échec de l\'envoi, nouvelle tentative…'}
          </div>
        </div>
      )}

    </div>
  );
}
