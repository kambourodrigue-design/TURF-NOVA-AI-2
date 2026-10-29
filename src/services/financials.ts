import { CurrencyCode, PaymentMethod, ExpenseCategory, Sale, Expense } from '../types';

/** Jour calendaire LOCAL (AAAA-MM-JJ) d'une date ISO : « aujourd'hui » doit suivre l'heure du commerçant, pas l'UTC. */
export function localDay(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

export function formatCurrency(amount: number, currency: CurrencyCode = 'XOF'): string {
  const rounded = Math.round(amount);
  const formatted = new Intl.NumberFormat('fr-FR').format(rounded);
  
  switch (currency) {
    case 'XOF':
      return `${formatted} F CFA`;
    case 'GNF':
      return `${formatted} GNF`;
    case 'USD':
      return `$${formatted}`;
    case 'EUR':
      return `${formatted} €`;
    default:
      return `${formatted} F CFA`;
  }
}

export function getPaymentMethodDetails(method: PaymentMethod): { label: string; color: string; badgeBg: string } {
  switch (method) {
    case 'cash':
      return { label: 'Espèces (Cash)', color: 'text-emerald-700', badgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    case 'wave':
      return { label: 'Wave', color: 'text-sky-600', badgeBg: 'bg-sky-50 text-sky-700 border-sky-200' };
    case 'orange_money':
      return { label: 'Orange Money', color: 'text-orange-600', badgeBg: 'bg-orange-50 text-orange-700 border-orange-200' };
    case 'mtn_momo':
      return { label: 'MTN MoMo', color: 'text-yellow-600', badgeBg: 'bg-yellow-50 text-yellow-800 border-yellow-200' };
    case 'moov_money':
      return { label: 'Moov Money', color: 'text-blue-600', badgeBg: 'bg-blue-50 text-blue-700 border-blue-200' };
    case 'bank_transfer':
      return { label: 'Banque / Virement', color: 'text-purple-600', badgeBg: 'bg-purple-50 text-purple-700 border-purple-200' };
    case 'credit':
      return { label: 'À Crédit (Dette)', color: 'text-red-600', badgeBg: 'bg-red-50 text-red-700 border-red-200' };
    default:
      return { label: method, color: 'text-stone-600', badgeBg: 'bg-stone-50 text-stone-700 border-stone-200' };
  }
}

export function getExpenseCategoryDetails(category: ExpenseCategory): { label: string; iconColor: string } {
  switch (category) {
    case 'supply':
      return { label: 'Achat de marchandises (stock)', iconColor: 'text-emerald-600' };
    case 'rent':
      return { label: 'Loyer boutique / Magasin', iconColor: 'text-indigo-600' };
    case 'transport':
      return { label: 'Transport & Livraisons', iconColor: 'text-amber-600' };
    case 'utilities':
      return { label: 'Factures (Électricité, Eau, Pass internet)', iconColor: 'text-blue-600' };
    case 'salary':
      return { label: 'Salaires & Manutentionnaires', iconColor: 'text-teal-600' };
    case 'taxes':
      return { label: 'Taxes Mairie, ODP & Impôts', iconColor: 'text-rose-600' };
    case 'personal_draw':
      return { label: 'Prélèvement personnel (Famille/Patron)', iconColor: 'text-purple-600' };
    case 'maintenance':
      return { label: 'Réparations & Imprévus', iconColor: 'text-stone-600' };
    case 'other':
    default:
      return { label: 'Autres dépenses', iconColor: 'text-stone-500' };
  }
}

export interface FinancialSummary {
  revenue: number;           // Total ventes
  cogs: number;              // Coût des marchandises vendues
  grossProfit: number;       // Marge brute
  grossMarginPct: number;    // % Marge brute
  operatingExpenses: number; // Charges d'exploitation
  personalDraws: number;     // Prélèvements perso
  netProfit: number;         // Bénéfice net d'exploitation
  netMarginPct: number;      // % Marge nette
  totalSalesCount: number;   // Nombre de transactions
  averageBasket: number;     // Panier moyen
  digitalPaymentsRatio: number; // % Encaissé en Mobile Money & Banque
}

export function calculateSummaryForPeriod(sales: Sale[], expenses: Expense[], daysLimit: number = 30): FinancialSummary {
  const cutoff = Date.now() - (daysLimit * 86400000);
  
  const periodSales = sales.filter(s => s.status !== 'cancelled' && new Date(s.date).getTime() >= cutoff);
  const periodExpenses = expenses.filter(e => new Date(e.date).getTime() >= cutoff);

  const revenue = periodSales.reduce((acc, s) => acc + s.total, 0);
  const cogs = periodSales.reduce((acc, s) => acc + s.totalCost, 0);
  const grossProfit = revenue - cogs;
  const grossMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

  // Les achats de marchandises ne sont pas des charges : leur coût est déjà dans le coût des ventes (cogs).
  const operatingExpenses = periodExpenses
    .filter(e => e.category !== 'personal_draw' && e.category !== 'supply')
    .reduce((acc, e) => acc + e.amount, 0);

  const personalDraws = periodExpenses
    .filter(e => e.category === 'personal_draw')
    .reduce((acc, e) => acc + e.amount, 0);

  const netProfit = grossProfit - operatingExpenses;
  const netMarginPct = revenue > 0 ? (netProfit / revenue) * 100 : 0;

  const totalSalesCount = periodSales.length;
  const averageBasket = totalSalesCount > 0 ? revenue / totalSalesCount : 0;

  const digitalSales = periodSales
    .filter(s => ['wave', 'orange_money', 'mtn_momo', 'moov_money', 'bank_transfer'].includes(s.paymentMethod))
    .reduce((acc, s) => acc + s.total, 0);

  const digitalPaymentsRatio = revenue > 0 ? (digitalSales / revenue) * 100 : 0;

  return {
    revenue,
    cogs,
    grossProfit,
    grossMarginPct,
    operatingExpenses,
    personalDraws,
    netProfit,
    netMarginPct,
    totalSalesCount,
    averageBasket,
    digitalPaymentsRatio,
  };
}
