import { Customer, Expense, Product, Sale, ShopSettings } from '../types';
import { formatCurrency, localDay } from './financials';
import { cleanPhoneNumber } from './whatsapp';
import { dueReminders } from './reminders';


export interface DailySummary {
  salesCount: number; revenue: number; profit: number; expensesTotal: number; net: number;
  lowStock: Product[]; toRemind: Customer[]; text: string;
}

/** Résumé de la journée (heure locale de l'appareil) : ventes, bénéfice, ruptures, dettes à relancer. */
export function buildDailySummary(
  sales: Sale[], expenses: Expense[], products: Product[], customers: Customer[], s: ShopSettings, now = new Date(),
): DailySummary {
  const today = localDay(now);
  const isToday = (iso: string) => localDay(iso) === today;
  const todaySales = sales.filter((x) => x.status !== 'cancelled' && isToday(x.date));
  const revenue = todaySales.reduce((a, x) => a + x.total, 0);
  const profit = todaySales.reduce((a, x) => a + x.profit, 0);
  const expensesTotal = expenses
    .filter((e) => isToday(e.date) && e.category !== 'personal_draw' && e.category !== 'supply')
    .reduce((a, e) => a + e.amount, 0);
  const net = profit - expensesTotal;
  const lowStock = products.filter((p) => p.stockQuantity <= p.minAlertThreshold).sort((a, b) => a.stockQuantity - b.stockQuantity);
  const toRemind = dueReminders(customers);
  const m = (n: number) => formatCurrency(n, s.currency);
  const date = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  const lines = [
    `📊 *Résumé du ${date}*`, `🏪 ${s.shopName}`, '',
    `🛒 Ventes : *${todaySales.length}* pour *${m(revenue)}*`,
    `💸 Dépenses : *${m(expensesTotal)}*`,
    `${net >= 0 ? '✅' : '⚠️'} Bénéfice du jour : *${m(net)}*`,
  ];
  if (lowStock.length) {
    lines.push('', `📦 *À racheter (${lowStock.length})* :`);
    lowStock.slice(0, 5).forEach((p) => lines.push(`• ${p.name} (reste ${p.stockQuantity})`));
    if (lowStock.length > 5) lines.push(`… et ${lowStock.length - 5} autre(s)`);
  }
  if (toRemind.length) {
    lines.push('', `📒 *Dettes à relancer (${toRemind.length})* : ${m(toRemind.reduce((a, c) => a + c.totalDebt, 0))}`);
    toRemind.slice(0, 3).forEach((c) => lines.push(`• ${c.name} : ${m(c.totalDebt)}`));
  }
  lines.push('', '_Nafora_');
  return { salesCount: todaySales.length, revenue, profit, expensesTotal, net, lowStock, toRemind, text: lines.join('\n') };
}

/** Lien WhatsApp vers soi-même (numéro de la boutique) ; sans numéro valide, WhatsApp laisse choisir le contact. */
export const summaryWhatsAppUrl = (text: string, phone: string) => {
  const p = cleanPhoneNumber(phone || '').replace(/\D/g, '');
  return `https://wa.me/${p.length >= 8 ? p : ''}?text=${encodeURIComponent(text)}`;
};
