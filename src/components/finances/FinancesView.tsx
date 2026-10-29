import React, { useMemo, useState } from 'react';
import { Sale, Expense, ShopSettings, Product, Customer, Supplier } from '../../types';
import { formatCurrency, calculateSummaryForPeriod, localDay } from '../../services/financials';
import { ProfitPeriodCard } from './ProfitPeriodCard';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend 
} from 'recharts';
import { 
  TrendingUp, 
  Percent, 
  ShoppingBag, 
  Scale, 
  Smartphone, 
  Calendar,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  LineChart as LineChartIcon,
  Sparkles,
  Award,
  Truck,
  BookUser
} from 'lucide-react';

interface FinancesViewProps {
  sales: Sale[];
  expenses: Expense[];
  products: Product[];
  settings: ShopSettings;
  customers?: Customer[];
  suppliers?: Supplier[];
}

export const FinancesView: React.FC<FinancesViewProps> = ({
  sales,
  expenses,
  products,
  settings,
  customers = [],
  suppliers = [],
}) => {
  const [chartMode, setChartMode] = useState<'area' | 'bar'>('area');
  const [chartMetric, setChartMetric] = useState<'sales_profit' | 'sales_expenses'>('sales_profit');

  // Trade working capital
  const totalCustomerReceivables = customers.reduce((sum, c) => sum + c.totalDebt, 0);
  const totalSupplierDebts = suppliers.reduce((sum, s) => sum + s.totalDebt, 0);
  const netTradeWorkingCapital = totalCustomerReceivables - totalSupplierDebts;

  // Summary for past 30 days
  const summary30d = useMemo(() => {
    return calculateSummaryForPeriod(sales, expenses, 30);
  }, [sales, expenses]);

  // Seuil de rentabilité (Point mort financier)
  const breakEvenRevenue = useMemo(() => {
    if (summary30d.grossMarginPct <= 0) return 0;     // marge nulle ou négative : seuil inatteignable
    return (summary30d.operatingExpenses / (summary30d.grossMarginPct / 100));
  }, [summary30d]);

  const breakEvenAchieved = breakEvenRevenue > 0 ? summary30d.revenue >= breakEvenRevenue : summary30d.operatingExpenses === 0 && summary30d.grossMarginPct > 0;
  const breakEvenPct = breakEvenRevenue > 0 ? (summary30d.revenue / breakEvenRevenue) * 100 : 100;

  // 6-Month Monthly Sales Trend Aggregation
  const monthlyData = useMemo(() => {
    const months: {
      monthKey: string;
      monthLabel: string;
      fullName: string;
      revenue: number;
      grossProfit: number;
      expenses: number;
      netProfit: number;
      salesCount: number;
      growthRate: number;
    }[] = [];

    const now = new Date();
    
    // We construct the last 6 months in chronological order
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const monthNum = d.getMonth() + 1;
      const monthKey = `${year}-${String(monthNum).padStart(2, '0')}`;
      
      const rawMonthLabel = d.toLocaleDateString('fr-FR', { month: 'short' });
      // Capitalize first letter (ex: 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct')
      const monthLabel = rawMonthLabel.charAt(0).toUpperCase() + rawMonthLabel.slice(1).replace('.', '');
      const fullName = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

      // Filter sales belonging to this month
      const mSales = sales.filter(s => s.status !== 'cancelled' && localDay(s.date).startsWith(monthKey));
      const mExpenses = expenses.filter(e => localDay(e.date).startsWith(monthKey));

      const revenue = mSales.reduce((sum, s) => sum + s.total, 0);
      const grossProfit = mSales.reduce((sum, s) => sum + s.profit, 0);
      const totalCost = mSales.reduce((sum, s) => sum + s.totalCost, 0);
      // Charges d'exploitation : sans les achats de marchandises (déjà dans le coût des ventes) ni les prélèvements personnels
      const expAmount = mExpenses.filter(e => e.category !== 'supply' && e.category !== 'personal_draw').reduce((sum, e) => sum + e.amount, 0);

      const netProfit = grossProfit - expAmount;     // peut être négatif : une perte doit se voir

      months.push({
        monthKey,
        monthLabel,
        fullName,
        revenue,
        grossProfit,
        expenses: expAmount,
        netProfit,
        salesCount: mSales.length,
        growthRate: 0,
      });
    }

    // Calculate month-over-month growth rate (%)
    for (let idx = 0; idx < months.length; idx++) {
      if (idx === 0) {
        months[idx].growthRate = 0;
      } else {
        const prevRev = months[idx - 1].revenue;
        const currentRev = months[idx].revenue;
        const rate = prevRev > 0 ? ((currentRev - prevRev) / prevRev) * 100 : 0;
        months[idx].growthRate = Math.round(rate * 10) / 10;
      }
    }

    return months;
  }, [sales, expenses]);

  // Overall 6-Month Highlights
  const sixMonthsTotalRevenue = useMemo(() => {
    return monthlyData.reduce((sum, m) => sum + m.revenue, 0);
  }, [monthlyData]);

  const sixMonthsTotalNetProfit = useMemo(() => {
    return monthlyData.reduce((sum, m) => sum + m.netProfit, 0);
  }, [monthlyData]);

  const bestMonth = useMemo(() => {
    return [...monthlyData].sort((a, b) => b.revenue - a.revenue)[0];
  }, [monthlyData]);

  const totalGrowthOverall = useMemo(() => {
    if (monthlyData.length < 2) return 0;
    const first = monthlyData[0].revenue;
    const last = monthlyData[monthlyData.length - 1].revenue;
    return first > 0 ? Math.round(((last - first) / first) * 100) : 0;
  }, [monthlyData]);

  // Top products by revenue
  const topProducts = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number; profit: number }>();
    sales.forEach(sale => {
      sale.items.forEach(item => {
        const existing = map.get(item.productId) || { name: item.productName, qty: 0, revenue: 0, profit: 0 };
        existing.qty += item.quantity;
        existing.revenue += item.totalPrice;
        existing.profit += (item.totalPrice - (item.costPrice * item.quantity));
        map.set(item.productId, existing);
      });
    });

    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }, [sales]);

  // Custom Tooltip for Recharts
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-stone-900/95 backdrop-blur-md text-white p-3.5 rounded-2xl shadow-xl border border-stone-700 text-xs space-y-2 min-w-[210px]">
          <div className="flex items-center justify-between pb-1.5 border-b border-stone-800">
            <span className="font-extrabold text-sm capitalize text-amber-400">
              {data.fullName}
            </span>
            {data.growthRate !== 0 && (
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                data.growthRate > 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
              }`}>
                {data.growthRate > 0 ? `+${data.growthRate}%` : `${data.growthRate}%`}
              </span>
            )}
          </div>

          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-stone-300">Ventes totales :</span>
              <span className="font-mono-num font-black text-emerald-400">
                {formatCurrency(data.revenue, settings.currency)}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-stone-300">Bénéfice net :</span>
              <span className="font-mono-num font-bold text-amber-300">
                {formatCurrency(data.netProfit, settings.currency)}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-stone-300">Charges :</span>
              <span className="font-mono-num text-rose-400 font-semibold">
                -{formatCurrency(data.expenses, settings.currency)}
              </span>
            </div>

            <div className="pt-1 border-t border-stone-800 flex justify-between text-[11px] text-stone-400">
              <span>Volume :</span>
              <span>{data.salesCount} ticket(s) de vente</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6 pb-20">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-stone-900 tracking-tight">
            Ratios Financiers & Rentabilité
          </h2>
          <p className="text-xs sm:text-sm text-stone-500">
            Indicateurs clés de performance économique et tendance de croissance des revenus.
          </p>
        </div>

        <div className="inline-flex items-center gap-1.5 bg-emerald-100/80 text-emerald-900 px-3 py-1.5 rounded-full text-xs font-extrabold border border-emerald-300 self-start sm:self-auto">
          <TrendingUp className="w-3.5 h-3.5 text-emerald-700" />
          <span>Croissance globale 6 mois : {totalGrowthOverall > 0 ? '+' : ''}{totalGrowthOverall}%</span>
        </div>
      </div>

      <ProfitPeriodCard sales={sales} expenses={expenses} settings={settings} />

      {/* Ratios Grid (30 Days) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        
        {/* Marge Brute */}
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-stone-200 shadow-xs">
          <div className="flex items-center justify-between text-stone-500 text-xs font-semibold">
            <span>Taux de Marge Brute</span>
            <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-800 flex items-center justify-center font-bold">
              %
            </div>
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-emerald-800 font-mono-num">
              {summary30d.grossMarginPct.toFixed(1)}%
            </div>
            <div className="text-xs text-stone-500 mt-0.5">
              Gain brut : {formatCurrency(summary30d.grossProfit, settings.currency)}
            </div>
          </div>
        </div>

        {/* Marge Nette */}
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-stone-200 shadow-xs">
          <div className="flex items-center justify-between text-stone-500 text-xs font-semibold">
            <span>Marge Nette Réelle</span>
            <div className="w-7 h-7 rounded-lg bg-teal-50 text-teal-800 flex items-center justify-center font-bold">
              📈
            </div>
          </div>
          <div className="mt-2">
            <div className={`text-2xl font-black font-mono-num ${summary30d.netMarginPct >= 10 ? 'text-teal-800' : 'text-amber-600'}`}>
              {summary30d.netMarginPct.toFixed(1)}%
            </div>
            <div className="text-xs text-stone-500 mt-0.5">
              Net restant : {formatCurrency(summary30d.netProfit, settings.currency)}
            </div>
          </div>
        </div>

        {/* Panier Moyen */}
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-stone-200 shadow-xs">
          <div className="flex items-center justify-between text-stone-500 text-xs font-semibold">
            <span>Panier Moyen par Client</span>
            <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center">
              <ShoppingBag className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-stone-900 font-mono-num">
              {formatCurrency(summary30d.averageBasket, settings.currency)}
            </div>
            <div className="text-xs text-stone-500 mt-0.5">
              Sur {summary30d.totalSalesCount} achats au total
            </div>
          </div>
        </div>

        {/* Digitalisation */}
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-stone-200 shadow-xs">
          <div className="flex items-center justify-between text-stone-500 text-xs font-semibold">
            <span>Part Paiements Digitaux</span>
            <div className="w-7 h-7 rounded-lg bg-sky-50 text-sky-700 flex items-center justify-center">
              <Smartphone className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-sky-700 font-mono-num">
              {summary30d.digitalPaymentsRatio.toFixed(0)}%
            </div>
            <div className="text-xs text-stone-500 mt-0.5">
              Wave, Orange Money, MoMo
            </div>
          </div>
        </div>

      </div>

      {/* 🌟 6-MONTH MONTHLY SALES TREND (RECHARTS INTEGRATION) */}
      <div className="bg-white rounded-3xl p-5 sm:p-6 border border-stone-200 shadow-md space-y-5">
        
        {/* Top Header of Chart */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-stone-100">
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
              Visualisation continue de la croissance de votre chiffre d'affaires et de votre rentabilité nette.
            </p>
          </div>

          {/* Controls: Area/Bar toggle and metric toggle */}
          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            <div className="flex bg-stone-100 p-1 rounded-xl text-xs font-bold">
              <button
                onClick={() => setChartMetric('sales_profit')}
                className={`px-2.5 py-1 rounded-lg transition ${
                  chartMetric === 'sales_profit'
                    ? 'bg-white text-emerald-800 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                Ventes & Bénéfice
              </button>
              <button
                onClick={() => setChartMetric('sales_expenses')}
                className={`px-2.5 py-1 rounded-lg transition ${
                  chartMetric === 'sales_expenses'
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                Ventes vs Dépenses
              </button>
            </div>

            <div className="flex bg-stone-100 p-1 rounded-xl text-xs">
              <button
                onClick={() => setChartMode('area')}
                className={`p-1.5 rounded-lg transition ${
                  chartMode === 'area' ? 'bg-white text-emerald-800 shadow-xs' : 'text-stone-500'
                }`}
                title="Graphique en courbes"
              >
                <LineChartIcon className="w-4 h-4" />
              </button>
              <button
                onClick={() => setChartMode('bar')}
                className={`p-1.5 rounded-lg transition ${
                  chartMode === 'bar' ? 'bg-white text-emerald-800 shadow-xs' : 'text-stone-500'
                }`}
                title="Graphique en barres"
              >
                <BarChart3 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* 6-Month KPI Callout Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-3">
          <div className="p-3 bg-stone-50 rounded-2xl border border-stone-100">
            <span className="text-[11px] font-semibold text-stone-500">Total Ventes (6 mois)</span>
            <div className="text-base sm:text-lg font-black text-stone-900 font-mono-num mt-0.5">
              {formatCurrency(sixMonthsTotalRevenue, settings.currency)}
            </div>
            <div className="text-[10px] text-emerald-700 font-semibold mt-0.5 flex items-center gap-0.5">
              <ArrowUpRight className="w-3 h-3" /> {totalGrowthOverall > 0 ? '+' : ''}{totalGrowthOverall}% sur la période
            </div>
          </div>

          <div className="p-3 bg-stone-50 rounded-2xl border border-stone-100">
            <span className="text-[11px] font-semibold text-stone-500">Bénéfice Net Cumulé</span>
            <div className="text-base sm:text-lg font-black text-emerald-800 font-mono-num mt-0.5">
              {formatCurrency(sixMonthsTotalNetProfit, settings.currency)}
            </div>
            <div className="text-[10px] text-stone-500 mt-0.5">
              Marge nette moy : {sixMonthsTotalRevenue > 0 ? ((sixMonthsTotalNetProfit / sixMonthsTotalRevenue) * 100).toFixed(0) : 0}%
            </div>
          </div>

          <div className="p-3 bg-stone-50 rounded-2xl border border-stone-100">
            <span className="text-[11px] font-semibold text-stone-500">Mois Record</span>
            <div className="text-base sm:text-lg font-black text-stone-900 font-mono-num mt-0.5 truncate">
              {bestMonth.monthLabel}
            </div>
            <div className="text-[10px] text-stone-500 mt-0.5">
              {formatCurrency(bestMonth.revenue, settings.currency)}
            </div>
          </div>

          <div className="p-3 bg-stone-50 rounded-2xl border border-stone-100">
            <span className="text-[11px] font-semibold text-stone-500">Moyenne Mensuelle</span>
            <div className="text-base sm:text-lg font-black text-stone-900 font-mono-num mt-0.5">
              {formatCurrency(Math.round(sixMonthsTotalRevenue / 6), settings.currency)}
            </div>
            <div className="text-[10px] text-stone-500 mt-0.5">
              Revenu moyen récurrent
            </div>
          </div>
        </div>

        {/* Recharts Container */}
        <div className="w-full h-72 sm:h-80 pt-2 select-none">
          <ResponsiveContainer width="100%" height="100%">
            {chartMode === 'area' ? (
              <AreaChart data={monthlyData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                <defs>
                  {/* Revenue Emerald Gradient */}
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--c-blue)" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="var(--c-blue)" stopOpacity={0.0} />
                  </linearGradient>

                  {/* Profit Amber Gradient */}
                  <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--c-gold)" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="var(--c-gold)" stopOpacity={0.0} />
                  </linearGradient>

                  {/* Expenses Rose Gradient */}
                  <linearGradient id="expenseGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--c-rose)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--c-rose)" stopOpacity={0.0} />
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
                
                <Tooltip content={<CustomTooltip />} />
                
                <Legend 
                  verticalAlign="top" 
                  height={36} 
                  iconType="circle"
                  formatter={(value) => {
                    const label = value === 'revenue' 
                      ? "Chiffre d'Affaires" 
                      : value === 'netProfit' 
                        ? 'Bénéfice Net' 
                        : 'Dépenses';
                    return <span className="text-xs font-semibold text-stone-700">{label}</span>;
                  }}
                />

                <Area 
                  type="monotone" 
                  dataKey="revenue" 
                  name="revenue"
                  stroke="var(--c-blue)" 
                  strokeWidth={3} 
                  fillOpacity={1} 
                  fill="url(#revenueGradient)" 
                  activeDot={{ r: 6, stroke: 'var(--c-blue-deep)', strokeWidth: 2 }}
                />

                {chartMetric === 'sales_profit' ? (
                  <Area 
                    type="monotone" 
                    dataKey="netProfit" 
                    name="netProfit"
                    stroke="var(--c-gold)" 
                    strokeWidth={2.5} 
                    fillOpacity={1} 
                    fill="url(#profitGradient)" 
                    activeDot={{ r: 5, stroke: 'var(--c-gold-deep)', strokeWidth: 2 }}
                  />
                ) : (
                  <Area 
                    type="monotone" 
                    dataKey="expenses" 
                    name="expenses"
                    stroke="var(--c-rose)" 
                    strokeWidth={2.5} 
                    fillOpacity={1} 
                    fill="url(#expenseGradient)" 
                    activeDot={{ r: 5, stroke: 'var(--c-rose-deep)', strokeWidth: 2 }}
                  />
                )}
              </AreaChart>
            ) : (
              <BarChart data={monthlyData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
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
                <Tooltip content={<CustomTooltip />} />
                <Legend 
                  verticalAlign="top" 
                  height={36} 
                  iconType="circle"
                  formatter={(value) => {
                    const label = value === 'revenue' 
                      ? "Chiffre d'Affaires" 
                      : value === 'netProfit' 
                        ? 'Bénéfice Net' 
                        : 'Dépenses';
                    return <span className="text-xs font-semibold text-stone-700">{label}</span>;
                  }}
                />
                <Bar 
                  dataKey="revenue" 
                  name="revenue"
                  fill="var(--c-blue)" 
                  radius={[6, 6, 0, 0]} 
                  maxBarSize={40}
                />
                {chartMetric === 'sales_profit' ? (
                  <Bar 
                    dataKey="netProfit" 
                    name="netProfit"
                    fill="var(--c-gold)" 
                    radius={[6, 6, 0, 0]} 
                    maxBarSize={40}
                  />
                ) : (
                  <Bar 
                    dataKey="expenses" 
                    name="expenses"
                    fill="var(--c-rose)" 
                    radius={[6, 6, 0, 0]} 
                    maxBarSize={40}
                  />
                )}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>

        {/* Growth Interpretation Note */}
        <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-2xl text-xs text-emerald-900 flex items-start gap-2">
          <Sparkles className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
          <div>
            <strong>Interprétation pour votre banquier : </strong>
            Une courbe de ventes ascendante sur 6 mois consécutifs prouve la fidélisation de votre clientèle et la résilience de votre commerce, critère capital pour l'octroi d'une ligne de crédit de fonds de roulement.
          </div>
        </div>

      </div>

      {/* Break-even point (Seuil de rentabilité) Deep Dive */}
      <div className="bg-white rounded-3xl p-5 border border-stone-200 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center">
              <Scale className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-extrabold text-stone-900 text-base">
                Seuil de Rentabilité Mensuel (Point Mort)
              </h3>
              <p className="text-xs text-stone-500">
                Le chiffre d'affaires minimal à faire chaque mois pour payer toutes vos charges sans être en perte.
              </p>
            </div>
          </div>

          <span className={`px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1 ${
            breakEvenAchieved 
              ? 'bg-emerald-100 text-emerald-800' 
              : 'bg-amber-100 text-amber-800'
          }`}>
            {breakEvenAchieved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
            <span>{breakEvenAchieved ? "Seuil Atteint" : "En cours"}</span>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100 space-y-2">
            <div className="flex justify-between text-xs text-stone-600">
              <span>Charges fixes d'exploitation :</span>
              <span className="font-bold text-stone-900 font-mono-num">{formatCurrency(summary30d.operatingExpenses, settings.currency)}</span>
            </div>
            <div className="flex justify-between text-xs text-stone-600">
              <span>Seuil de CA mensuel nécessaire :</span>
              <span className="font-bold text-indigo-700 font-mono-num text-sm">{formatCurrency(breakEvenRevenue, settings.currency)}</span>
            </div>
            <div className="flex justify-between text-xs text-stone-600">
              <span>CA actuellement réalisé (30j) :</span>
              <span className="font-bold text-emerald-800 font-mono-num text-sm">{formatCurrency(summary30d.revenue, settings.currency)}</span>
            </div>
          </div>

          <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100 flex flex-col justify-center">
            <div className="flex justify-between text-xs font-bold text-stone-700 mb-1.5">
              <span>Progression vers la rentabilité</span>
              <span className="font-mono-num">{breakEvenPct.toFixed(0)}%</span>
            </div>
            <div className="w-full bg-stone-200 h-3 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all ${breakEvenAchieved ? 'bg-emerald-700' : 'bg-amber-500'}`}
                style={{ width: `${Math.min(100, breakEvenPct)}%` }}
              />
            </div>
            <p className="text-[11px] text-stone-500 mt-2">
              {breakEvenAchieved 
                ? `Félicitations ! Vous avez dépassé votre point mort de ${formatCurrency(summary30d.revenue - breakEvenRevenue, settings.currency)}. Chaque nouvelle vente génère du bénéfice net pur.`
                : `Il vous reste ${formatCurrency(Math.max(0, breakEvenRevenue - summary30d.revenue), settings.currency)} à vendre ce mois-ci pour couvrir l'ensemble de vos charges d'exploitation.`}
            </p>
          </div>
        </div>
      </div>

      {/* Top 5 Best Performing Products */}
      <div className="bg-white rounded-3xl p-5 border border-stone-200 shadow-xs">
        <h3 className="font-extrabold text-stone-900 text-base mb-3">
          Top 5 des Produits les Plus Rentables
        </h3>

        <div className="divide-y divide-stone-100">
          {topProducts.map((p, idx) => (
            <div key={idx} className="py-2.5 flex items-center justify-between gap-3 text-xs sm:text-sm">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 font-black text-xs flex items-center justify-center shrink-0">
                  {idx + 1}
                </span>
                <div className="min-w-0">
                  <div className="font-bold text-stone-900 break-words">{p.name}</div>
                  <div className="text-stone-500 text-[11px]">{p.qty} unité(s) vendue(s)</div>
                </div>
              </div>

              <div className="text-right shrink-0">
                <div className="font-bold text-stone-900 font-mono-num whitespace-nowrap">
                  {formatCurrency(p.revenue, settings.currency)}
                </div>
                <div className="text-emerald-700 font-bold text-[11px]">
                  +{formatCurrency(p.profit, settings.currency)} gain
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Working Capital / BFR & Supplier Debts Balance Card */}
      <div className="bg-white rounded-3xl p-5 border border-stone-200 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center">
              <Scale className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-extrabold text-stone-900 text-base">
                Besoin en Fonds de Roulement (BFR) & Dettes Fournisseurs
              </h3>
              <p className="text-xs text-stone-500">
                Comparatif direct entre vos créances à percevoir et vos engagements envers les grossistes.
              </p>
            </div>
          </div>
          <span className={`px-2.5 py-1 rounded-full text-xs font-bold self-start sm:self-auto ${
            netTradeWorkingCapital >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
          }`}>
            {netTradeWorkingCapital >= 0 ? 'Équilibre Sain' : 'Attention Dettes'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3.5 bg-amber-50/60 border border-amber-200 rounded-2xl">
            <div className="flex items-center gap-1.5 text-xs text-amber-900 font-semibold mb-1">
              <BookUser className="w-3.5 h-3.5 text-amber-700" />
              <span>Créances Clients (Actif)</span>
            </div>
            <div className="text-xl font-black font-mono-num text-amber-700">
              {formatCurrency(totalCustomerReceivables, settings.currency)}
            </div>
            <div className="text-[11px] text-stone-500 mt-0.5">
              Argent dehors à récupérer
            </div>
          </div>

          <div className="p-3.5 bg-indigo-50/60 border border-indigo-200 rounded-2xl">
            <div className="flex items-center gap-1.5 text-xs text-indigo-900 font-semibold mb-1">
              <Truck className="w-3.5 h-3.5 text-indigo-700" />
              <span>Dettes Fournisseurs (Passif)</span>
            </div>
            <div className="text-xl font-black font-mono-num text-indigo-700">
              {formatCurrency(totalSupplierDebts, settings.currency)}
            </div>
            <div className="text-[11px] text-stone-500 mt-0.5">
              Somme due aux grossistes
            </div>
          </div>

          <div className="p-3.5 bg-stone-50 border border-stone-200 rounded-2xl">
            <div className="text-xs text-stone-700 font-semibold mb-1">
              Solde Net Commercial
            </div>
            <div className={`text-xl font-black font-mono-num ${netTradeWorkingCapital >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
              {netTradeWorkingCapital >= 0 ? `+${formatCurrency(netTradeWorkingCapital, settings.currency)}` : formatCurrency(netTradeWorkingCapital, settings.currency)}
            </div>
            <div className="text-[11px] text-stone-500 mt-0.5">
              {netTradeWorkingCapital >= 0 ? 'Créances couvrent les dettes' : 'Dettes fournisseurs à résorber'}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};
