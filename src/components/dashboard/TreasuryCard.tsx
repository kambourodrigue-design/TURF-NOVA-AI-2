import React, { useMemo } from 'react';
import { Sale, Expense, Customer, Supplier, ShopSettings } from '../../types';
import { computeTreasury } from '../../services/treasury';
import { formatCurrency } from '../../services/financials';
import { Landmark, Banknote, Smartphone, Building2, ArrowDownLeft, ArrowUpRight } from 'lucide-react';

interface Props {
  sales: Sale[];
  expenses: Expense[];
  customers: Customer[];
  suppliers: Supplier[];
  settings: ShopSettings;
  onOpenSettings?: () => void;
  onNavigate: (tab: string) => void;
}

export const TreasuryCard: React.FC<Props> = ({ sales, expenses, customers, suppliers, settings, onNavigate }) => {
  const t = useMemo(
    () => computeTreasury(sales, expenses, customers, suppliers, settings),
    [sales, expenses, customers, suppliers, settings],
  );
  const cur = settings.currency;
  const neg = t.balances.total < 0;
  const channels = [
    { key: 'cash', label: 'Espèces en caisse', icon: Banknote, v: t.balances.cash, tone: 'text-emerald-700 bg-emerald-50' },
    { key: 'mobile', label: 'Mobile Money', icon: Smartphone, v: t.balances.mobile, tone: 'text-orange-700 bg-orange-50' },
    { key: 'bank', label: 'Banque', icon: Building2, v: t.balances.bank, tone: 'text-purple-700 bg-purple-50' },
  ] as const;

  return (
    <section className="bg-white rounded-3xl border border-stone-200 shadow-xs p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-stone-500">
            <Landmark className="w-4 h-4 text-emerald-800" /> Trésorerie
          </div>
          <div className={`text-2xl sm:text-3xl font-black font-mono-num mt-1 ${neg ? 'text-rose-600' : 'text-stone-900'}`}>
            {formatCurrency(t.balances.total, cur)}
          </div>
          <div className="text-[11px] text-stone-500">Argent réellement disponible (≠ bénéfice)</div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-100">
            <div className="flex items-center gap-1 text-emerald-800 font-bold"><ArrowDownLeft className="w-3.5 h-3.5" />Entrées 30 j</div>
            <div className="font-black font-mono-num text-emerald-900">{formatCurrency(t.in30, cur)}</div>
          </div>
          <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-100">
            <div className="flex items-center gap-1 text-rose-800 font-bold"><ArrowUpRight className="w-3.5 h-3.5" />Sorties 30 j</div>
            <div className="font-black font-mono-num text-rose-900">{formatCurrency(t.out30, cur)}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {channels.map(({ key, label, icon: Icon, v, tone }) => (
          <div key={key} className="flex items-center gap-3 p-3 rounded-2xl border border-stone-200">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tone}`}><Icon className="w-4 h-4" /></div>
            <div className="min-w-0">
              <div className="text-[11px] text-stone-500 font-semibold truncate">{label}</div>
              <div className={`font-black font-mono-num text-sm sm:text-base truncate ${v < 0 ? 'text-rose-600' : 'text-stone-900'}`}>{formatCurrency(v, cur)}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
        <button onClick={() => onNavigate('debts')} className="text-left p-3 rounded-2xl bg-amber-50 border border-amber-200 hover:border-amber-400 transition">
          <div className="font-bold text-amber-900">À encaisser (clients)</div>
          <div className="font-black font-mono-num text-amber-700 text-sm">+ {formatCurrency(t.receivables, cur)}</div>
        </button>
        <button onClick={() => onNavigate('debts')} className="text-left p-3 rounded-2xl bg-indigo-50 border border-indigo-200 hover:border-indigo-400 transition">
          <div className="font-bold text-indigo-900">À payer (fournisseurs)</div>
          <div className="font-black font-mono-num text-indigo-700 text-sm">− {formatCurrency(t.payables, cur)}</div>
        </button>
        <div className="p-3 rounded-2xl bg-stone-50 border border-stone-200">
          <div className="font-bold text-stone-700">Trésorerie nette prévue</div>
          <div className={`font-black font-mono-num text-sm ${t.projected < 0 ? 'text-rose-600' : 'text-stone-900'}`}>{formatCurrency(t.projected, cur)}</div>
          <div className="text-[10px] text-stone-500">disponible + à encaisser − à payer</div>
        </div>
      </div>

      {!t.hasOpening && (
        <p className="text-[11px] text-stone-500 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2">
          💡 Pour une trésorerie exacte, indiquez l'argent que vous aviez au départ (espèces, Mobile Money, banque) dans <strong>Paramètres → Trésorerie de départ</strong>. Sans cela, seuls les mouvements enregistrés sont comptés.
        </p>
      )}
    </section>
  );
};
