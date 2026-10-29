import React from 'react';
import { Sale, ShopSettings } from '../../types';
import { formatCurrency, getPaymentMethodDetails } from '../../services/financials';
import { generateReceiptWhatsAppUrl } from '../../services/whatsapp';
import { shareReceiptPdf, downloadReceiptPdf } from '../../services/receiptPdf';
import { Printer, Share2, CheckCircle, X, ShoppingCart, FileDown } from 'lucide-react';
import { uiAlert } from '../common/dialogs';

interface ReceiptModalProps {
  sale: Sale;
  settings: ShopSettings;
  onClose: () => void;
  onNewSale: () => void;
  customerPhone?: string;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  sale,
  settings,
  onClose,
  onNewSale,
  customerPhone,
}) => {
  const [busy, setBusy] = React.useState(false);
  const paymentDetails = getPaymentMethodDetails(sale.paymentMethod);
  const whatsappUrl = generateReceiptWhatsAppUrl(sale, settings, customerPhone);

  const handleSharePdf = async () => {
    setBusy(true);
    try { await shareReceiptPdf(sale, settings, whatsappUrl); }
    catch { uiAlert('Impossible de générer le PDF. Réessayez.'); }
    finally { setBusy(false); }
  };

  const handleDownloadPdf = async () => {
    setBusy(true);
    try { await downloadReceiptPdf(sale, settings); }
    catch { uiAlert('Impossible de générer le PDF. Réessayez.'); }
    finally { setBusy(false); }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-stone-200 overflow-hidden animate-in fade-in zoom-in-95 my-auto">
        
        {/* Modal Top Bar */}
        <div className="bg-emerald-900 text-white p-4 flex items-center justify-between no-print">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-emerald-400" />
            <h3 className="font-bold text-base">Vente Encaissée avec Succès !</h3>
          </div>
          <button 
            onClick={onClose}
            className="p-1 rounded-lg text-emerald-200 hover:text-white hover:bg-emerald-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Printable Receipt Paper Container */}
        <div className="p-6 bg-stone-50/50 print:bg-white text-stone-900 font-mono-num text-sm print-card">
          
          {/* Receipt Header */}
          <div className="text-center pb-4 border-b border-dashed border-stone-300">
            {settings.logo ? (
              <img src={settings.logo} alt="Logo" className="w-16 h-16 object-contain mx-auto mb-2" />
            ) : (
              <div className="w-12 h-12 rounded-2xl bg-emerald-800 text-white font-black text-2xl flex items-center justify-center mx-auto mb-2 shadow-xs">
                {settings.shopName.charAt(0).toUpperCase()}
              </div>
            )}
            <h2 className="font-extrabold text-lg tracking-tight uppercase text-stone-900">
              {settings.shopName}
            </h2>
            <p className="text-xs text-stone-600 mt-0.5">{settings.city} • {settings.country}</p>
            <p className="text-xs text-stone-600">Tel: {settings.phone}</p>
            {settings.rccmNumber && (
              <p className="text-[11px] text-stone-500 mt-0.5">RCCM: {settings.rccmNumber}</p>
            )}
          </div>

          {/* Ticket Metadata */}
          <div className="py-3 border-b border-dashed border-stone-300 text-xs text-stone-600 space-y-1">
            <div className="flex justify-between">
              <span>N° Reçu :</span>
              <span className="font-bold text-stone-900">{sale.invoiceNumber}</span>
            </div>
            <div className="flex justify-between">
              <span>Date :</span>
              <span>{new Date(sale.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            {sale.customerName && (
              <div className="flex justify-between">
                <span>Client :</span>
                <span className="font-bold text-stone-900">{sale.customerName}</span>
              </div>
            )}
          </div>

          {/* Purchased Items List */}
          <div className="py-3 border-b border-dashed border-stone-300 space-y-2">
            <div className="text-xs font-bold text-stone-500 uppercase tracking-wider grid grid-cols-6 pb-1">
              <span className="col-span-3">Article</span>
              <span className="col-span-1 text-center">Qté</span>
              <span className="col-span-2 text-right">Total</span>
            </div>

            {sale.items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-6 text-xs sm:text-sm items-center py-0.5">
                <div className="col-span-3 font-medium text-stone-900 truncate">
                  {item.productName}
                </div>
                <div className="col-span-1 text-center text-stone-600">
                  x{item.quantity}
                </div>
                <div className="col-span-2 text-right font-bold text-stone-900">
                  {formatCurrency(item.totalPrice, settings.currency)}
                </div>
              </div>
            ))}
          </div>

          {/* Total & Payment details */}
          <div className="py-3 border-b border-dashed border-stone-300 space-y-1.5 text-sm">
            <div className="flex justify-between text-base font-black text-stone-950 pt-1">
              <span>TOTAL :</span>
              <span>{formatCurrency(sale.total, settings.currency)}</span>
            </div>

            <div className="flex justify-between text-xs text-stone-600 pt-1">
              <span>Mode de paiement :</span>
              <span className="font-semibold text-stone-900">{paymentDetails.label}</span>
            </div>

            {sale.isCredit ? (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-bold text-center mt-2">
                Achat à crédit — Reste dû : {formatCurrency(sale.total, settings.currency)}
                {sale.creditDueDate && (
                  <div className="text-[11px] font-normal text-red-700 mt-0.5">
                    Échéance : {new Date(sale.creditDueDate).toLocaleDateString('fr-FR')}
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="flex justify-between text-xs text-stone-600">
                  <span>Montant Reçu :</span>
                  <span>{formatCurrency(sale.amountPaid, settings.currency)}</span>
                </div>
                {sale.changeGiven > 0 && (
                  <div className="flex justify-between text-xs text-emerald-700 font-bold">
                    <span>Monnaie Rendue :</span>
                    <span>{formatCurrency(sale.changeGiven, settings.currency)}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer note */}
          <div className="text-center pt-4 text-xs text-stone-500">
            <p className="font-bold text-stone-800">Merci pour votre confiance !</p>
            <p className="text-[11px] mt-0.5">Les marchandises vendues ne sont ni reprises ni échangées.</p>
            <p className="text-[10px] text-stone-400 mt-2">Certifié conforme par Nafora</p>
          </div>

        </div>

        {/* Action Buttons for Merchant */}
        <div className="p-4 bg-white border-t border-stone-200 space-y-2 no-print">
          
          <button
            onClick={handleSharePdf}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-sm transition shadow-sm active:scale-95"
          >
            <Share2 className="w-4 h-4" />
            <span>{busy ? 'Préparation du PDF…' : 'Envoyer le reçu PDF (WhatsApp)'}</span>
          </button>

          <div className="grid grid-cols-3 gap-2">
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 p-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 font-bold text-xs transition active:scale-95 border border-stone-200"
            >
              <span>💬 Texte</span>
            </a>
            <button
              onClick={handleDownloadPdf}
              disabled={busy}
              className="flex items-center justify-center gap-1.5 p-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 font-bold text-xs transition active:scale-95 border border-stone-200"
            >
              <FileDown className="w-4 h-4" />
              <span>PDF</span>
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center justify-center gap-1.5 p-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 font-bold text-xs transition active:scale-95 border border-stone-200"
            >
              <Printer className="w-4 h-4" />
              <span>Imprimer</span>
            </button>
          </div>

          <button
            onClick={onNewSale}
            className="w-full py-2.5 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white font-bold text-sm transition flex items-center justify-center gap-2 active:scale-95"
          >
            <ShoppingCart className="w-4 h-4" />
            <span>Nouvelle Vente Caisse</span>
          </button>

        </div>

      </div>
    </div>
  );
};
