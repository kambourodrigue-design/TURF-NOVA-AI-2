import React, { useState } from 'react';
import { 
  LayoutDashboard, 
  ShoppingCart, 
  Package, 
  Receipt, 
  BookUser, 
  Landmark,
  TrendingUp,
  MoreHorizontal,
  Wallet,
  Sparkles,
  ShieldCheck,
  X
} from 'lucide-react';

interface BottomNavProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  lowStockCount: number;
  totalDebtorsCount: number;
  isAdmin?: boolean;
  allowedTabs?: string[];
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  setActiveTab,
  lowStockCount,
  totalDebtorsCount,
  isAdmin = false,
  allowedTabs,
}) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const ok = (id: string) => !allowedTabs || allowedTabs.includes(id);
  const moreTabs = [
    { id: 'assistant', label: 'Assistant IA', icon: Sparkles },
    { id: 'expenses', label: 'Dépenses', icon: Wallet },
    { id: 'credit', label: 'Score Crédit', icon: Landmark },
    { id: 'formalization', label: 'Formalisation', icon: ShieldCheck },
  ].filter(t => ok(t.id));
  const moreActive = moreTabs.some(t => t.id === activeTab);

  const tabs = [
    { id: 'dashboard', label: 'Accueil', icon: LayoutDashboard },
    { id: 'pos', label: 'Caisse', icon: ShoppingCart, highlight: true },
    { id: 'finances', label: 'Ratios', icon: TrendingUp },
    { id: 'stock', label: 'Stocks', icon: Package, badge: lowStockCount > 0 ? lowStockCount : null },
    { id: 'debts', label: 'Dettes', icon: BookUser, badge: totalDebtorsCount > 0 ? totalDebtorsCount : null },
    ...(isAdmin ? [{ id: 'admin', label: 'Admin', icon: Landmark, badge: '👑' }] : []),
  ].filter(t => t.id === 'admin' || ok(t.id));
  const cols = tabs.length + (moreTabs.length ? 1 : 0);

  return (
    <div className="xl:hidden fixed -bottom-px left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-stone-200 px-1 py-1.5 pb-[calc(0.375rem+1px)] shadow-lg safe-bottom">
      <div className="grid gap-0.5 max-w-xl mx-auto" style={{ gridTemplateColumns: `repeat(${Math.max(cols, 2)}, minmax(0, 1fr))` }}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex flex-col items-center justify-center py-1 rounded-xl transition ${
                isActive
                  ? 'text-emerald-800 font-bold'
                  : 'text-stone-500 hover:text-stone-800'
              }`}
            >
              {/* Highlight circle for POS */}
              <div className={`relative p-1 rounded-xl transition ${
                tab.highlight && !isActive ? 'bg-amber-100 text-amber-900' : ''
              } ${isActive ? 'bg-emerald-100 text-emerald-800' : ''}`}>
                <Icon className={`w-5 h-5 ${tab.highlight ? 'stroke-[2.5]' : ''}`} />
                
                {/* Notification Badge */}
                {tab.badge && (
                  <span className="absolute -top-1 -right-1.5 min-w-[16px] h-4 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                    {tab.badge}
                  </span>
                )}
              </div>
              <span className={`text-[10px] tracking-tight mt-0.5 truncate max-w-[48px] ${isActive ? 'font-bold' : 'font-medium'}`}>
                {tab.label}
              </span>
            </button>
          );
        })}

        {/* Menu "Plus" : rubriques secondaires */}
        {moreTabs.length > 0 && <button
          onClick={() => setMoreOpen(o => !o)}
          className={`relative flex flex-col items-center justify-center py-1 rounded-xl transition ${
            moreActive || moreOpen ? 'text-emerald-800 font-bold' : 'text-stone-500 hover:text-stone-800'
          }`}
        >
          <div className={`p-1 rounded-xl ${moreActive || moreOpen ? 'bg-emerald-100 text-emerald-800' : ''}`}>
            <MoreHorizontal className="w-5 h-5" />
          </div>
          <span className="text-[10px] tracking-tight mt-0.5">Plus</span>
        </button>}
      </div>

      {moreOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
          <div className="absolute bottom-full right-2 mb-2 z-50 w-56 bg-white rounded-2xl shadow-2xl border border-stone-200 p-2 space-y-1">
            <div className="flex items-center justify-between px-2 pt-1 pb-0.5">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-stone-500">Plus</span>
              <button onClick={() => setMoreOpen(false)} className="text-stone-400 p-0.5"><X className="w-4 h-4" /></button>
            </div>
            {moreTabs.map(t => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => { setActiveTab(t.id); setMoreOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-left ${
                    activeTab === t.id ? 'bg-emerald-100 text-emerald-900' : 'text-stone-700 hover:bg-stone-100'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
