import { Sale, Customer, ShopSettings } from '../types';
import { formatCurrency } from './financials';

export function cleanPhoneNumber(phone: string): string {
  // Remove spaces, dashes, dots, parenthesis
  let cleaned = phone.replace(/[\s\-\(\)\.]/g, '');
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1);
  }
  return cleaned;
}

export function generateReceiptWhatsAppUrl(
  sale: Sale, 
  settings: ShopSettings, 
  customerPhone?: string
): string {
  const dateFormatted = new Date(sale.date).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const lines: string[] = [
    `🧾 *REÇU DE VENTE - ${settings.shopName.toUpperCase()}*`,
    `📍 ${settings.city}, ${settings.country}`,
    `📞 Contact : ${settings.phone}`,
    `--------------------------------`,
    `N° Facture : *${sale.invoiceNumber}*`,
    `Date : ${dateFormatted}`,
    sale.customerName ? `Client : *${sale.customerName}*` : '',
    `--------------------------------`,
    `*ARTICLES ACHETÉS :*`,
  ];

  sale.items.forEach((item, idx) => {
    lines.push(`${idx + 1}. ${item.productName} (x${item.quantity}) : *${formatCurrency(item.totalPrice, settings.currency)}*`);
  });

  lines.push(`--------------------------------`);
  lines.push(`*TOTAL À PAYER : ${formatCurrency(sale.total, settings.currency)}*`);
  lines.push(`Mode de paiement : ${sale.paymentMethod.toUpperCase()}`);
  
  if (sale.isCredit) {
    lines.push(`⚠️ *Achat à crédit - Reste dû : ${formatCurrency(sale.total, settings.currency)}*`);
    if (sale.creditDueDate) {
      const dueDate = new Date(sale.creditDueDate).toLocaleDateString('fr-FR');
      lines.push(`Date convenue de règlement : ${dueDate}`);
    }
  } else {
    lines.push(`Montant reçu : ${formatCurrency(sale.amountPaid, settings.currency)}`);
    if (sale.changeGiven > 0) {
      lines.push(`Monnaie rendue : ${formatCurrency(sale.changeGiven, settings.currency)}`);
    }
    lines.push(`Statut : ✅ Payé`);
  }

  lines.push(`--------------------------------`);
  lines.push(`🙏 *Merci pour votre confiance et à très bientôt !*`);
  lines.push(`_Généré via Nafora_`);

  const text = encodeURIComponent(lines.filter(l => l.length > 0).join('\n'));
  const phoneParam = customerPhone ? cleanPhoneNumber(customerPhone) : '';

  return `https://wa.me/${phoneParam}?text=${text}`;
}

export function generateDebtReminderWhatsAppUrl(
  customer: Customer,
  settings: ShopSettings
): string {
  const lines: string[] = [
    `Bonjour M./Mme *${customer.name}*,`,
    ``,
    `J'espère que vous vous portez bien.`,
    `C'est la boutique *${settings.shopName}* (${settings.ownerName}) qui vous contacte amicalement.`,
    ``,
    `Sauf erreur de notre part, votre solde de compte s'élève actuellement à :`,
    `👉 *${formatCurrency(customer.totalDebt, settings.currency)}*`,
    ``,
    `Vous pouvez effectuer le règlement en boutique ou directement par Mobile Money :`,
    `📲 *Wave / Orange Money / MoMo* au : *${settings.phone}*`,
    ``,
    `Merci d'avance pour votre fidélité et excellente journée à vous !`,
    `🙏 *${settings.shopName}*`
  ];

  const text = encodeURIComponent(lines.join('\n'));
  const phoneParam = cleanPhoneNumber(customer.phone);

  return `https://wa.me/${phoneParam}?text=${text}`;
}
