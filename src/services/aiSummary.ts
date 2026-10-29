// Résumé compact des chiffres de la boutique envoyé à l'assistant IA.
// Aucun numéro de téléphone ni nom de client : seulement des totaux.
import { Sale, Expense, Customer, Supplier, Product, ShopSettings } from '../types';
import { computeTreasury, isStockPurchase } from './treasury';
import { formatCurrency } from './financials';

const DAY = 86400000;

export function buildAiSummary(
  sales: Sale[], expenses: Expense[], customers: Customer[], suppliers: Supplier[],
  products: Product[], settings: ShopSettings,
): string {
  const f = (n: number) => formatCurrency(Math.round(n), settings.currency);
  const now = Date.now();
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const valid = sales.filter(s => s.status !== 'cancelled');
  const inRange = (d: string, from: number, to = Infinity) => { const t = new Date(d).getTime(); return t >= from && t < to; };
  const agg = (from: number, to = Infinity) => {
    const ss = valid.filter(s => inRange(s.date, from, to));
    const ex = expenses.filter(e => !isStockPurchase(e) && e.category !== 'personal_draw' && inRange(e.date, from, to));
    const revenue = ss.reduce((a, s) => a + s.total, 0);
    const gross = ss.reduce((a, s) => a + s.profit, 0);
    const exp = ex.reduce((a, e) => a + e.amount, 0);
    return { n: ss.length, revenue, gross, exp, net: gross - exp };
  };
  const t0 = startToday.getTime();
  const today = agg(t0);
  const w1 = agg(now - 7 * DAY);
  const w0 = agg(now - 14 * DAY, now - 7 * DAY);
  const m1 = agg(now - 30 * DAY);

  const byProd = new Map<string, { q: number; r: number }>();
  for (const s of valid.filter(s => inRange(s.date, now - 30 * DAY)))
    for (const it of s.items) {
      const x = byProd.get(it.productName) || { q: 0, r: 0 };
      x.q += it.quantity; x.r += it.totalPrice; byProd.set(it.productName, x);
    }
  const top = [...byProd.entries()].sort((a, b) => b[1].r - a[1].r).slice(0, 5)
    .map(([n, v]) => `${n} (${v.q} vendus, ${f(v.r)})`);
  const low = products.filter(p => p.stockQuantity <= p.minAlertThreshold)
    .slice(0, 10).map(p => `${p.name} (reste ${p.stockQuantity} ${p.unit})`);
  const debtors = customers.filter(c => c.totalDebt > 0);
  const owed = debtors.reduce((a, c) => a + c.totalDebt, 0);
  const supDebt = suppliers.filter(x => x.totalDebt > 0);
  const owe = supDebt.reduce((a, x) => a + x.totalDebt, 0);
  const tr = computeTreasury(sales, expenses, customers, suppliers, settings);
  const trend = w0.revenue > 0 ? `${Math.round(((w1.revenue - w0.revenue) / w0.revenue) * 100)} %` : 'n/a';

  return [
    `Boutique : ${settings.shopName} (${settings.businessType || settings.businessCategory}, ${settings.city}). Devise : ${settings.currency}.`,
    `Aujourd'hui : ${today.n} ventes, chiffre d'affaires ${f(today.revenue)}, marge brute ${f(today.gross)}.`,
    `7 derniers jours : ${w1.n} ventes, CA ${f(w1.revenue)}, marge brute ${f(w1.gross)}, dépenses ${f(w1.exp)}, bénéfice net ${f(w1.net)}. Évolution du CA vs semaine précédente : ${trend}.`,
    `30 derniers jours : ${m1.n} ventes, CA ${f(m1.revenue)}, marge brute ${f(m1.gross)}, dépenses ${f(m1.exp)}, bénéfice net ${f(m1.net)}.`,
    `Produits les plus vendus (30 j) : ${top.join(' ; ') || 'aucun'}.`,
    `Stock bas : ${low.join(' ; ') || 'aucun'}.`,
    `Clients qui doivent de l'argent : ${debtors.length} pour un total de ${f(owed)}.`,
    `Dettes envers fournisseurs : ${supDebt.length} pour un total de ${f(owe)}.`,
    `Trésorerie disponible : ${f(tr.balances.total)} (espèces ${f(tr.balances.cash)}, mobile money ${f(tr.balances.mobile)}, banque ${f(tr.balances.bank)}). Entrées 30 j : ${f(tr.in30)}, sorties 30 j : ${f(tr.out30)}.`,
  ].join('\n').slice(0, 5800);
}
