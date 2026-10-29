import { TreasuryCard } from './TreasuryCard';
import { FeedbackCard } from './FeedbackCard';
import React, { useMemo } from 'react';
import { Sale, Expense, Customer, Supplier, Product, ShopSettings, CreditScoreResult } from '../../types';
import { formatCurrency, localDay } from '../../services/financials';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip 
} from 'recharts';
import { 
  ShoppingCart, 
  ArrowUpRight, 
  ArrowDownRight, 
  Wallet, 
  AlertTriangle, 
  PlusCircle, 
  Landmark, 
  Sparkles, 
  ChevronRight,
  Receipt,
  Users,
  Clock,
  CheckCircle2,
  TrendingUp,
  BarChart3,
  Truck,
  Scale
} from 'lucide-react';

interface DailyDashboardProps {
  sales: Sale[];
  expenses: Expense[];
  customers: Customer[];
  suppliers?: Supplier[];
  products: Product[];
  settings: ShopSettings;
  creditScore: CreditScoreResult;
  onNavigate: (tab: string) => void;
  onQuickSale: () => void;
  onQuickExpense: () => void;
  onQuickDebt: () => void;
}

export const DailyDashboard: React.FC<DailyDashboardProps> = ({
  sales,
  expenses,
  customers,
  suppliers = [],
  products,
  settings,
  creditScore,
  onNavigate,
  onQuickSale,
  onQuickExpense,
  onQuickDebt,
}) => {
  // Compute today's data
  const todayStr = localDay(new Date());
  const todaySales = sales.filter(s => s.status !== 'cancelled' && localDay(s.date) === todayStr);
  const todayExpenses = expenses.filter(e => localDay(e.date) === todayStr);

  const todayRevenue = todaySales.reduce((sum, s) => sum + s.total, 0);
  const todayCogs = todaySales.reduce((sum, s) => sum + s.totalCost, 0);
  const todayGrossProfit = todayRevenue - todayCogs;
  
  const todayOperatingExpenses = todayExpenses
    .filter(e => e.category !== 'personal_draw' && e.category !== 'supply')
    .reduce((sum, e) => sum + e.amount, 0);

  const todayEstimatedNet = todayGrossProfit - todayOperatingExpenses;
  // Achats de stock du jour : ce n'est pas une perte, leur coût sera déduit à la vente (donc non déduits ici)
  const todaySupply = todayExpenses.filter(e => e.category === 'supply').reduce((sum, e) => sum + e.amount, 0);
  const todayChargesCount = todayExpenses.filter(e => e.category !== 'personal_draw' && e.category !== 'supply').length;

  // Outstanding customer debts total
  const totalOutstandingDebts = customers.reduce((sum, c) => sum + c.totalDebt, 0);
  const debtorsCount = customers.filter(c => c.totalDebt > 0).length;

  // Supplier debts total
  const totalSupplierDebts = (suppliers || []).reduce((sum, s) => sum + s.totalDebt, 0);
  const supplierDebtsCount = (suppliers || []).filter(s => s.totalDebt > 0).length;
  const netDebtBalance = totalOutstandingDebts - totalSupplierDebts;

  // Low stock products
  const lowStockItems = products.filter(p => p.stockQuantity <= p.minAlertThreshold);

  // Practical tip of the day for informal/formal merchants
  const dailyTips = [
    {
      title: "Règle d'or : Séparation Caisse & Famille",
      desc: "Ne prélevez jamais l'argent de la popote ou des urgences familiales sans l'enregistrer dans 'Prélèvement personnel'. C'est le secret numéro 1 des commerces qui durent.",
      tag: "Trésorerie"
    },
    {
      title: "Tracez vos Mobile Money pour la Banque",
      desc: "Les paiements reçus par Wave, Orange Money ou MoMo constituent une preuve irréfutable de chiffre d'affaires pour Cofina, Baobab ou votre banquier.",
      tag: "Financement"
    },
    {
      title: "Relancez les créances le 25 du mois",
      desc: "Envoyez un rappel poli sur WhatsApp dès que les salaires tombent pour être payé avant que vos débiteurs n'aient dépensé leurs revenus.",
      tag: "Recouvrement"
    }
  ];
  const randomTip = dailyTips[Math.floor(Date.now() / 86400000) % dailyTips.length];

  // 6-Month Recharts Trend Aggregation for Dashboard
  const monthlySalesTrend = useMemo(() => {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const monthNum = d.getMonth() + 1;
      const monthKey = `${year}-${String(monthNum).padStart(2, '0')}`;
      const rawMonthLabel = d.toLocaleDateString('fr-FR', { month: 'short' });
      const monthLabel = rawMonthLabel.charAt(0).toUpperCase() + rawMonthLabel.slice(1).replace('.', '');
      const fullName = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

      const mSales = sales.filter(s => s.status !== 'cancelled' && localDay(s.date).startsWith(monthKey));
      const revenue = mSales.reduce((sum, s) => sum + s.total, 0);
      const grossProfit = mSales.reduce((sum, s) => sum + s.profit, 0);

      months.push({
        monthLabel,
        fullName,
        revenue,
        grossProfit,
      });
    }
    return months;
  }, [sales]);

  const sixMonthsTotalRevenue = useMemo(() => {
    return monthlySalesTrend.reduce((sum, m) => sum + m.revenue, 0);
  }, [monthlySalesTrend]);

  const growth6m = useMemo(() => {
    if (monthlySalesTrend.length < 2) return 0;
    const first = monthlySalesTrend[0].revenue;
    const last = monthlySalesTrend[monthlySalesTrend.length - 1].revenue;
    return first > 0 ? Math.round(((last - first) / first) * 100) : 0;
  }, [monthlySalesTrend]);

  return (
    <div className="space-y-6 pb-20">
      
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-emerald-900 via-emerald-800 to-teal-900 rounded-3xl p-5 sm:p-7 text-white shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-white/5 transform skew-x-12 pointer-events-none" />
        
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wider font-extrabold text-amber-400 bg-amber-400/10 px-2.5 py-0.5 rounded-full border border-amber-400/20">
                {settings.businessType}
              </span>
              <span className="text-xs text-emerald-200">
                Aujourd'hui, {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black mt-1 text-white">
              Bonjour, {settings.ownerName} 👋
            </h2>
            <p className="text-xs sm:text-sm text-emerald-100/90 mt-0.5">
              Suivi en temps réel de votre activité commerciale et éligibilité bancaire.
            </p>
          </div>

          {/* Credit Score Pill preview */}
          <div 
            onClick={() => onNavigate('credit')}
            className="flex items-center gap-3 bg-white/10 hover:bg-white/15 backdrop-blur-md p-3 rounded-2xl border border-white/15 cursor-pointer transition active:scale-98"
          >
            <div className="w-12 h-12 rounded-xl bg-amber-400 text-stone-950 font-black flex flex-col items-center justify-center shadow-md">
              <span className="text-xs leading-none">SCORE</span>
              <span className="text-base leading-none mt-0.5">{creditScore.totalScore}</span>
            </div>
            <div>
              <div className="text-[11px] text-emerald-200 font-semibold uppercase">Solvabilité Banques</div>
              <div className="text-sm font-bold text-white flex items-center gap-1">
                <span>{creditScore.label}</span>
                <ChevronRight className="w-3.5 h-3.5 text-amber-400" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Ventes, dépenses et bénéfice du jour : visibles d'un coup d'œil */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-4" data-testid="today-kpis">
        <button onClick={() => onNavigate('finances')} className="text-left bg-white rounded-2xl p-4 border border-stone-200 shadow-xs">
          <div className="text-xs font-semibold text-stone-500 flex items-center justify-between"><span>Ventes du jour</span><ArrowUpRight className="w-4 h-4 text-emerald-600" /></div>
          <div className="mt-1 text-xl sm:text-2xl font-black text-stone-900 font-mono-num break-words">{formatCurrency(todayRevenue, settings.currency)}</div>
          <div className="text-[11px] text-stone-500 mt-0.5">{todaySales.length} vente(s)</div>
        </button>
        <button onClick={() => onNavigate('expenses')} className="text-left bg-white rounded-2xl p-4 border border-stone-200 shadow-xs">
          <div className="text-xs font-semibold text-stone-500 flex items-center justify-between"><span>Dépenses du jour</span><ArrowDownRight className="w-4 h-4 text-rose-600" /></div>
          <div className="mt-1 text-xl sm:text-2xl font-black text-rose-600 font-mono-num break-words">{todayOperatingExpenses > 0 ? '-' : ''}{formatCurrency(todayOperatingExpenses, settings.currency)}</div>
          <div className="text-[11px] text-stone-500 mt-0.5">{todayChargesCount} charge(s)</div>
        </button>
        <button onClick={() => onNavigate('finances')} className={`col-span-2 text-left rounded-2xl p-4 border shadow-xs ${todayEstimatedNet < 0 ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50 border-emerald-200'}`}>
          <div className="text-xs font-semibold text-stone-500 flex items-center justify-between"><span>Bénéfice du jour</span><Wallet className="w-4 h-4 text-emerald-700" /></div>
          <div className={`mt-1 text-3xl font-black font-mono-num break-words ${todayEstimatedNet < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{formatCurrency(todayEstimatedNet, settings.currency)}</div>
          <div className="text-[11px] text-stone-500 mt-0.5">Gain sur les ventes {formatCurrency(todayGrossProfit, settings.currency)} − charges {formatCurrency(todayOperatingExpenses, settings.currency)}</div>
          {todaySupply > 0 && <div className="text-[11px] text-stone-500 mt-1">📦 {formatCurrency(todaySupply, settings.currency)} d'achats de stock aujourd'hui : non déduits, ils le seront à la vente de ces produits.</div>}
        </button>
      </div>

      <FeedbackCard settings={settings} sales={sales} />

      {/* Quick Action Touch Targets (Mobile-first, prominent) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-4">
        <button
          onClick={onQuickSale}
          className="flex items-center gap-3 p-3.5 sm:p-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-md shadow-emerald-700/20 transition active:scale-95 text-left"
        >
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <ShoppingCart className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="text-xs text-emerald-100 font-normal">Caisse</div>
            <div className="text-sm font-extrabold leading-tight">Nouvelle Vente</div>
          </div>
        </button>

        <button
          onClick={onQuickExpense}
          className="flex items-center gap-3 p-3.5 sm:p-4 rounded-2xl bg-white hover:bg-stone-50 border border-stone-200 text-stone-900 font-bold shadow-xs transition active:scale-95 text-left"
        >
          <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-100">
            <Receipt className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-stone-500 font-normal">Dépense</div>
            <div className="text-sm font-extrabold text-stone-800 leading-tight">Enregistrer</div>
          </div>
        </button>

        <button
          onClick={onQuickDebt}
          className="flex items-center gap-3 p-3.5 sm:p-4 rounded-2xl bg-white hover:bg-stone-50 border border-stone-200 text-stone-900 font-bold shadow-xs transition active:scale-95 text-left"
        >
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-100">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-stone-500 font-normal">Carnet Dettes</div>
            <div className="text-sm font-extrabold text-stone-800 leading-tight">Nouveau Crédit</div>
          </div>
        </button>

        <button
          onClick={() => onNavigate('stock')}
          className="flex items-center gap-3 p-3.5 sm:p-4 rounded-2xl bg-white hover:bg-stone-50 border border-stone-200 text-stone-900 font-bold shadow-xs transition active:scale-95 text-left"
        >
          <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0 border border-sky-100">
            <PlusCircle className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-stone-500 font-normal">Inventaire</div>
            <div className="text-sm font-extrabold text-stone-800 leading-tight">Entrée Stock</div>
          </div>
        </button>
      </div>

      {/* Trésorerie */}
      <TreasuryCard
        sales={sales} expenses={expenses} customers={customers} suppliers={suppliers || []}
        settings={settings} onNavigate={onNavigate}
      />

      {/* Primary KPI Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-4">
        
        {/* Customer Debts to collect */}
        <div 
          onClick={() => onNavigate('debts')}
          className="bg-white rounded-2xl p-4 sm:p-5 border border-stone-200 shadow-xs cursor-pointer hover:border-amber-300 transition"
        >
          <div className="flex items-center justify-between text-stone-500 text-xs font-semibold">
            <span>Créances Clients</span>
            <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-xl sm:text-2xl font-black text-amber-600 font-mono-num">
              {formatCurrency(totalOutstandingDebts, settings.currency)}
            </div>
            <div className="text-xs text-stone-500 font-medium mt-0.5 flex items-center gap-1">
              <span>{debtorsCount} client(s) à relancer</span>
              <ChevronRight className="w-3 h-3 text-stone-400" />
            </div>
          </div>
        </div>

        {/* Supplier Debts to Pay */}
        <div 
          onClick={() => onNavigate('debts')}
          className="bg-white rounded-2xl p-4 sm:p-5 border border-stone-200 shadow-xs cursor-pointer hover:border-indigo-300 transition col-span-2 sm:col-span-1"
        >
          <div className="flex items-center justify-between text-stone-500 text-xs font-semibold">
            <span>Dettes Grossistes</span>
            <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center">
              <Truck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-xl sm:text-2xl font-black text-indigo-700 font-mono-num">
              {formatCurrency(totalSupplierDebts, settings.currency)}
            </div>
            <div className="text-xs text-stone-500 font-medium mt-0.5 flex items-center gap-1">
              <span>{supplierDebtsCount} fournisseur(s) à régler</span>
              <ChevronRight className="w-3 h-3 text-stone-400" />
            </div>
          </div>
        </div>

      </div>

      {/* Position Nette Créances Clients / Dettes Grossistes Banner */}
      <div className="bg-gradient-to-r from-stone-900 to-stone-800 text-white rounded-2xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 ${netDebtBalance >= 0 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'}`}>
            <Scale className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs text-stone-300 font-medium">Position Nette Commerciale (Créances Clients - Dettes Grossistes) :</div>
            <div className="text-sm sm:text-base font-extrabold flex flex-wrap items-center gap-2">
              <span className={`font-mono-num ${netDebtBalance >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {netDebtBalance >= 0 ? `+${formatCurrency(netDebtBalance, settings.currency)}` : formatCurrency(netDebtBalance, settings.currency)}
              </span>
              <span className="text-xs text-stone-400 font-normal">
                ({netDebtBalance >= 0 ? 'Vos créances clients couvrent vos dettes fournisseurs' : 'Dettes fournisseurs supérieures aux créances'})
              </span>
            </div>
          </div>
        </div>
        <button
          onClick={() => onNavigate('debts')}
          className="self-start sm:self-auto px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition flex items-center gap-1.5 shrink-0"
        >
          <span>Gérer le carnet</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 🌟 RECHARTS: 6-Month Monthly Sales Trend on Main Dashboard */}
      <div className="bg-white rounded-3xl p-5 sm:p-6 border border-stone-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                <TrendingUp className="w-4 h-4" />
              </div>
              <h3 className="font-extrabold text-stone-900 text-base sm:text-lg">
                Tendance des Ventes Mensuelles (6 Derniers Mois)
              </h3>
            </div>
            <p className="text-xs text-stone-500 mt-0.5">
              Évolution de votre chiffre d'affaires et de votre bénéfice brut mensuel.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
              <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600" />
              <span>{growth6m > 0 ? '+' : ''}{growth6m}% de croissance</span>
            </span>

            <button
              onClick={() => onNavigate('finances')}
              className="text-xs font-bold text-emerald-800 hover:text-emerald-900 bg-emerald-100 hover:bg-emerald-200 px-3 py-1.5 rounded-xl transition flex items-center gap-1"
            >
              <span>Vue Ratios Complète</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Highlights banner */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
          <div className="p-2.5 bg-stone-50 rounded-xl border border-stone-100">
            <span className="text-stone-500 text-[11px]">Total 6 Mois Encaissé</span>
            <div className="font-black text-stone-900 font-mono-num text-sm sm:text-base mt-0.5">
              {formatCurrency(sixMonthsTotalRevenue, settings.currency)}
            </div>
          </div>
          <div className="p-2.5 bg-stone-50 rounded-xl border border-stone-100">
            <span className="text-stone-500 text-[11px]">Moyenne Mensuelle</span>
            <div className="font-black text-emerald-800 font-mono-num text-sm sm:text-base mt-0.5">
              {formatCurrency(Math.round(sixMonthsTotalRevenue / 6), settings.currency)}
            </div>
          </div>
          <div className="col-span-2 sm:col-span-1 p-2.5 bg-stone-50 rounded-xl border border-stone-100">
            <span className="text-stone-500 text-[11px]">Mois le Plus Fort</span>
            <div className="font-black text-amber-600 font-mono-num text-sm sm:text-base mt-0.5 truncate">
              {monthlySalesTrend[monthlySalesTrend.length - 1].monthLabel} ({formatCurrency(monthlySalesTrend[monthlySalesTrend.length - 1].revenue, settings.currency)})
            </div>
          </div>
        </div>

        {/* Recharts Area Chart */}
        <div className="w-full h-64 sm:h-72 pt-1 select-none">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={monthlySalesTrend} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
              <defs>
                <linearGradient id="dashRevenueGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--c-blue)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--c-blue)" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="dashProfitGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--c-gold)" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="var(--c-gold)" stopOpacity={0.0} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--c-grid)" />
              
              <XAxis 
                dataKey="monthLabel" 
                stroke="var(--c-axis)" 
                fontSize={12} 
                tickLine={false} 
                axisLine={{ stroke: 'var(--c-axis-line)' }}
                dy={6}
              />
              
              <YAxis 
                stroke="var(--c-axis)" 
                fontSize={11} 
                tickLine={false} 
                axisLine={false}
                tickFormatter={(val) => `${(val / 1000).toLocaleString('fr-FR')}k`}
              />
              
              <Tooltip 
                content={({ active, payload }: any) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div className="bg-stone-900/95 backdrop-blur-md text-white p-3 rounded-xl shadow-lg border border-stone-700 text-xs space-y-1 min-w-[180px]">
                        <div className="font-extrabold text-amber-400 pb-1 border-b border-stone-800">
                          {data.fullName}
                        </div>
                        <div className="flex justify-between items-center text-stone-300">
                          <span>Chiffre d'Affaires :</span>
                          <span className="font-mono-num font-black text-emerald-400">
                            {formatCurrency(data.revenue, settings.currency)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-stone-300">
                          <span>Marge Brute :</span>
                          <span className="font-mono-num font-bold text-amber-300">
                            {formatCurrency(data.grossProfit, settings.currency)}
                          </span>
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />

              <Area 
                type="monotone" 
                dataKey="revenue" 
                name="Chiffre d'Affaires"
                stroke="var(--c-blue)" 
                strokeWidth={3} 
                fillOpacity={1} 
                fill="url(#dashRevenueGradient)" 
                activeDot={{ r: 6, stroke: 'var(--c-blue-deep)', strokeWidth: 2 }}
              />

              <Area 
                type="monotone" 
                dataKey="grossProfit" 
                name="Marge Brute"
                stroke="var(--c-gold)" 
                strokeWidth={2} 
                fillOpacity={1} 
                fill="url(#dashProfitGradient)" 
                activeDot={{ r: 4, stroke: 'var(--c-gold-deep)', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Stock Alert Banner if any */}
      {lowStockItems.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-700" />
            </div>
            <div>
              <h4 className="font-bold text-amber-900 text-sm sm:text-base">
                Alerte Réapprovisionnement ({lowStockItems.length} article{lowStockItems.length > 1 ? 's' : ''})
              </h4>
              <p className="text-xs sm:text-sm text-amber-800 mt-0.5">
                Certains produits sont presque épuisés : {lowStockItems.slice(0, 3).map(p => `${p.name} (${p.stockQuantity} ${p.unit})`).join(', ')}...
              </p>
            </div>
          </div>
          <button
            onClick={() => onNavigate('stock')}
            className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs sm:text-sm transition shrink-0"
          >
            Gérer le stock
          </button>
        </div>
      )}

      {/* Two Column Layout: Daily Tip + Bank Readiness Card */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* Soutra / Daily Coaching Tip */}
        <div className="bg-gradient-to-br from-stone-900 to-stone-800 rounded-2xl p-5 text-white shadow-md flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-amber-400 text-xs font-bold">
              <Sparkles className="w-4 h-4" />
              <span>CONSEIL DE GESTION SOUTRA • {randomTip.tag}</span>
            </div>
            <h3 className="font-extrabold text-base sm:text-lg mt-2 text-white">
              {randomTip.title}
            </h3>
            <p className="text-xs sm:text-sm text-stone-300 mt-1.5 leading-relaxed">
              {randomTip.desc}
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-stone-700 flex items-center justify-between text-xs">
            <span className="text-stone-400">Pratique recommandée en Afrique de l'Ouest</span>
            <button 
              onClick={() => onNavigate('formalization')}
              className="text-amber-400 font-bold hover:underline flex items-center gap-1"
            >
              Guide Formalisation <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Bank & Microfinance Credit Readiness Teaser */}
        <div className="bg-white rounded-2xl p-5 border border-stone-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center">
                  <Landmark className="w-4 h-4" />
                </div>
                <h3 className="font-extrabold text-stone-900 text-sm sm:text-base">
                  Prêt & Financement PME
                </h3>
              </div>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${creditScore.color}`}>
                Score : {creditScore.totalScore}/1000 ({creditScore.rating})
              </span>
            </div>

            <p className="text-xs text-stone-600 mt-2.5 leading-relaxed">
              {creditScore.riskAssessment}
            </p>

            <div className="mt-3 p-3 bg-stone-50 rounded-xl flex items-center justify-between text-xs">
              <span className="text-stone-600 font-medium">Capacité d'emprunt suggérée :</span>
              <span className="font-extrabold text-emerald-800 font-mono-num text-sm">
                {formatCurrency(creditScore.maxRecommendedLoan, settings.currency)}
              </span>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-stone-100 flex items-center justify-between">
            <span className="text-xs text-stone-500">Pour Cofina, Baobab, Advans, Banques</span>
            <button
              onClick={() => onNavigate('credit')}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold transition flex items-center gap-1"
            >
              Voir mon dossier prêt <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

      </div>

      {/* Recent Sales Table / Feed */}
      <div className="bg-white rounded-2xl border border-stone-200 p-4 sm:p-5 shadow-xs">
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-stone-100">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-emerald-700" />
            <h3 className="font-bold text-stone-900 text-sm sm:text-base">
              Dernières Transactions Encaissées
            </h3>
          </div>
          <button
            onClick={() => onNavigate('pos')}
            className="text-xs font-bold text-emerald-800 hover:underline flex items-center gap-1"
          >
            Ouvrir la caisse <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {sales.length === 0 ? (
          <div className="text-center py-8 text-stone-400 text-sm">
            Aucune vente enregistrée pour le moment.
          </div>
        ) : (
          <div className="space-y-2.5">
            {sales.slice(-5).reverse().map((sale) => (
              <div 
                key={sale.id}
                className="flex items-center justify-between p-3 rounded-xl hover:bg-stone-50 border border-stone-100 transition"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold text-xs shrink-0">
                    {sale.paymentMethod === 'wave' ? '🌊' : sale.paymentMethod === 'orange_money' ? '🍊' : sale.paymentMethod === 'credit' ? '📒' : '💵'}
                  </div>
                  <div>
                    <div className="text-sm font-bold text-stone-900 flex items-center gap-2">
                      <span>{sale.invoiceNumber}</span>
                      {sale.isCredit && (
                        <span className="px-1.5 py-0.2 bg-red-100 text-red-700 rounded text-[10px] font-bold">
                          À Crédit
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-stone-500">
                      {new Date(sale.date).toLocaleDateString('fr-FR', { hour: '2-digit', minute: '2-digit' })} • {sale.items.length} article(s)
                      {sale.customerName ? ` • ${sale.customerName}` : ''}
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-sm font-black text-stone-900 font-mono-num">
                    {formatCurrency(sale.total, settings.currency)}
                  </div>
                  <div className="text-[11px] text-emerald-700 font-semibold">
                    +{formatCurrency(sale.profit, settings.currency)} gain
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
};
