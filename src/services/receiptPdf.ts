import type { Sale, ShopSettings } from '../types';
import { formatCurrency, getPaymentMethodDetails } from './financials';

// jsPDF n'aime pas les espaces insécables (Intl.NumberFormat fr-FR) : on les normalise.
const clean = (t: string) => t.replace(/[   ]/g, ' ');

/** Génère le reçu / la facture en PDF (chargé à la demande, fonctionne hors-ligne une fois en cache). */
export async function buildReceiptPdf(sale: Sale, settings: ShopSettings): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a5' });
  const W = doc.internal.pageSize.getWidth();
  const M = 12;
  const money = (n: number) => clean(formatCurrency(n, settings.currency));
  const green: [number, number, number] = [11, 31, 102]; // marine Nafora
  let y = 14;

  // --- En-tête : logo + identité boutique
  let textX = M;
  if (settings.logo) {
    try {
      const fmt = settings.logo.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(settings.logo, fmt, M, y - 4, 20, 20);
      textX = M + 24;
    } catch { /* logo illisible : on continue sans */ }
  }
  doc.setTextColor(...green);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(clean(settings.shopName.toUpperCase()), textX, y + 2, { maxWidth: W - textX - M });
  doc.setTextColor(80, 80, 80);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  let hy = y + 8;
  const info = [
    `${settings.city}, ${settings.country}`,
    `Tel : ${settings.phone}`,
    settings.rccmNumber ? `RCCM : ${settings.rccmNumber}` : '',
    settings.taxId ? `N° contribuable : ${settings.taxId}` : '',
  ].filter(Boolean);
  info.forEach(l => { doc.text(clean(l), textX, hy); hy += 4.2; });
  y = Math.max(hy, y + 22) + 2;

  doc.setDrawColor(...green);
  doc.setLineWidth(0.6);
  doc.line(M, y, W - M, y);
  y += 7;

  // --- Titre + méta
  doc.setTextColor(20, 20, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('REÇU / FACTURE', M, y);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`N° ${sale.invoiceNumber}`, W - M, y, { align: 'right' });
  y += 5.5;
  doc.setTextColor(90, 90, 90);
  doc.text(
    clean(new Date(sale.date).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })),
    M, y
  );
  if (sale.customerName) doc.text(clean(`Client : ${sale.customerName}`), W - M, y, { align: 'right' });
  y += 6;

  // --- Tableau articles
  const colQty = W - M - 52, colPU = W - M - 28, colTot = W - M;
  doc.setFillColor(...green);
  doc.rect(M, y, W - 2 * M, 7, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Article', M + 2, y + 4.8);
  doc.text('Qté', colQty, y + 4.8, { align: 'right' });
  doc.text('P.U.', colPU, y + 4.8, { align: 'right' });
  doc.text('Total', colTot - 2, y + 4.8, { align: 'right' });
  y += 7;
  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'normal');
  sale.items.forEach((it, i) => {
    if (y > 175) { doc.addPage(); y = 15; }
    if (i % 2 === 1) { doc.setFillColor(244, 247, 245); doc.rect(M, y, W - 2 * M, 6.5, 'F'); }
    const name = doc.splitTextToSize(clean(it.productName), colQty - M - 14) as string[];
    doc.text(name[0], M + 2, y + 4.5);
    doc.text(String(it.quantity), colQty, y + 4.5, { align: 'right' });
    doc.text(money(it.unitPrice), colPU, y + 4.5, { align: 'right' });
    doc.text(money(it.totalPrice), colTot - 2, y + 4.5, { align: 'right' });
    y += 6.5;
  });
  y += 3;
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.line(M, y, W - M, y);
  y += 6;

  // --- Totaux
  const row = (label: string, value: string, bold = false, color: [number, number, number] = [30, 30, 30]) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 12 : 9);
    doc.setTextColor(...color);
    doc.text(label, W - M - 60, y);
    doc.text(value, W - M, y, { align: 'right' });
    y += bold ? 7 : 5;
  };
  if (sale.discount > 0) {
    row('Sous-total', money(sale.subtotal));
    row('Remise', '- ' + money(sale.discount));
  }
  row('TOTAL', money(sale.total), true, green);
  row('Paiement', clean(getPaymentMethodDetails(sale.paymentMethod).label));
  if (sale.isCredit) {
    y += 1;
    doc.setFillColor(254, 226, 226);
    doc.roundedRect(M, y - 4, W - 2 * M, sale.creditDueDate ? 12 : 8, 1.5, 1.5, 'F');
    doc.setTextColor(153, 27, 27);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(`Achat à crédit - Reste dû : ${money(sale.total)}`, W / 2, y + 1, { align: 'center' });
    if (sale.creditDueDate) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.text(`Échéance : ${new Date(sale.creditDueDate).toLocaleDateString('fr-FR')}`, W / 2, y + 6, { align: 'center' });
    }
    y += 12;
  } else {
    row('Montant reçu', money(sale.amountPaid));
    if (sale.changeGiven > 0) row('Monnaie rendue', money(sale.changeGiven));
    y += 1;
    doc.setTextColor(26, 75, 209);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('PAYÉ', W - M, y, { align: 'right' });
  }

  // --- Pied de page
  const H = doc.internal.pageSize.getHeight();
  doc.setTextColor(110, 110, 110);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('Merci pour votre confiance !', W / 2, H - 14, { align: 'center' });
  doc.setFontSize(7.5);
  doc.text('Les marchandises vendues ne sont ni reprises ni échangées.', W / 2, H - 10, { align: 'center' });

  return doc.output('blob');
}

/** Partage le PDF (feuille de partage du téléphone → WhatsApp) ou, à défaut, le télécharge + ouvre WhatsApp avec le texte. */
export async function shareReceiptPdf(
  sale: Sale,
  settings: ShopSettings,
  fallbackWhatsAppUrl: string
): Promise<'shared' | 'downloaded'> {
  const blob = await buildReceiptPdf(sale, settings);
  const fileName = `Recu-${sale.invoiceNumber}.pdf`.replace(/[^\w.\-]+/g, '_');
  const file = new File([blob], fileName, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: `Reçu ${sale.invoiceNumber}`, text: `Reçu - ${settings.shopName}` });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared'; // l'utilisateur a annulé
    }
  }
  downloadBlob(blob, fileName);
  window.open(fallbackWhatsAppUrl, '_blank', 'noopener');
  return 'downloaded';
}

export async function downloadReceiptPdf(sale: Sale, settings: ShopSettings) {
  const blob = await buildReceiptPdf(sale, settings);
  downloadBlob(blob, `Recu-${sale.invoiceNumber}.pdf`.replace(/[^\w.\-]+/g, '_'));
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
