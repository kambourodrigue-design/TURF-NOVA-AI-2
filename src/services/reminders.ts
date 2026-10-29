import { Customer } from '../types';
import { cleanPhoneNumber } from './whatsapp';

/** Délai minimum entre deux relances d'un même client (évite de harceler). */
export const REMINDER_GAP_DAYS = 7;

export const daysSince = (iso?: string): number | null =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null;

export const hasUsablePhone = (c: Customer) => cleanPhoneNumber(c.phone || '').replace(/\D/g, '').length >= 8;

/** Clients qui doivent de l'argent, joignables, et pas relancés depuis REMINDER_GAP_DAYS jours. Les plus gros montants d'abord. */
export function dueReminders(customers: Customer[], gap = REMINDER_GAP_DAYS): Customer[] {
  return customers
    .filter((c) => c.totalDebt > 0 && hasUsablePhone(c))
    .filter((c) => { const d = daysSince(c.lastReminderSentDate); return d === null || d >= gap; })
    .sort((a, b) => b.totalDebt - a.totalDebt);
}
