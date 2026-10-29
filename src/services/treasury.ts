// Trésorerie : l'argent réellement disponible (≠ bénéfice). Calculée à partir des mouvements enregistrés :
//  + ventes encaissées (hors ventes à crédit) + remboursements de clients
//  − dépenses et achats payés + paiements aux fournisseurs
// Les ventes à crédit et les achats à crédit ne bougent la trésorerie qu'au moment du paiement.

import { Sale, Expense, Customer, Supplier, ShopSettings, PaymentMethod } from '../types';

export type Channel = 'cash' | 'mobile' | 'bank';
export const channelOf = (m: PaymentMethod | string): Channel | null => {
  if (m === 'cash') return 'cash';
  if (m === 'bank_transfer') return 'bank';
  if (m === 'wave' || m === 'orange_money' || m === 'mtn_momo' || m === 'moov_money') return 'mobile';
  return null; // 'credit' : pas de mouvement d'argent
};

/** Montant d'une dépense réellement sorti de la caisse (un achat à crédit n'en sort qu'une partie). */
export const paidNow = (e: Expense): number =>
  typeof e.paidAmount === 'number' ? Math.min(Math.max(0, e.paidAmount), e.amount) : e.amount;
export const creditPart = (e: Expense): number => Math.max(0, e.amount - paidNow(e));

/** Un achat de marchandises n'est pas une charge : son coût est déjà dans le coût des ventes. */
export const isStockPurchase = (e: Expense) => e.category === 'supply';

export interface TreasuryResult {
  balances: Record<Channel, number> & { total: number };
  in30: number;
  out30: number;
  receivables: number;      // à encaisser (clients)
  payables: number;         // à payer (fournisseurs)
  projected: number;        // disponible + à encaisser − à payer
  hasOpening: boolean;
}

export function computeTreasury(
  sales: Sale[], expenses: Expense[], customers: Customer[], suppliers: Supplier[], settings: ShopSettings,
): TreasuryResult {
  const bal: Record<Channel, number> = {
    cash: Number(settings.openingCash) || 0,
    mobile: Number(settings.openingMobile) || 0,
    bank: Number(settings.openingBank) || 0,
  };
  const cutoff = Date.now() - 30 * 86400000;
  let in30 = 0, out30 = 0;
  const inflow = (method: string, amount: number, date: string) => {
    const ch = channelOf(method);
    if (!ch || !(amount > 0)) return;
    bal[ch] += amount;
    if (new Date(date).getTime() >= cutoff) in30 += amount;
  };
  const outflow = (method: string, amount: number, date: string) => {
    const ch = channelOf(method);
    if (!ch || !(amount > 0)) return;
    bal[ch] -= amount;
    if (new Date(date).getTime() >= cutoff) out30 += amount;
  };

  for (const s of sales) {
    if (s.status === 'cancelled' || s.isCredit) continue;
    inflow(s.paymentMethod, s.total, s.date);
  }
  for (const c of customers) for (const p of c.payments || []) inflow(p.paymentMethod, p.amount, p.date);
  for (const e of expenses) outflow(e.paymentMethod, paidNow(e), e.date);
  for (const sp of suppliers) for (const p of sp.payments || []) outflow(p.paymentMethod, p.amount, p.date);

  const receivables = customers.reduce((n, c) => n + (c.totalDebt || 0), 0);
  const payables = suppliers.reduce((n, s) => n + (s.totalDebt || 0), 0);
  const total = bal.cash + bal.mobile + bal.bank;
  return {
    balances: { ...bal, total },
    in30, out30, receivables, payables,
    projected: total + receivables - payables,
    hasOpening: !!(settings.openingCash || settings.openingMobile || settings.openingBank),
  };
}
