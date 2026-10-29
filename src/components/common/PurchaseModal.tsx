import React, { useState } from 'react';
import { Expense, PaymentMethod, Product, ShopSettings, Supplier } from '../../types';
import { SupplierCreditFields } from './SupplierCreditFields';
import { applyPurchaseCredit, weightedCost } from '../../services/purchases';
import { formatCurrency } from '../../services/financials';
import { newId } from '../../../shared/syncCore';
import { Select } from './dialogs';
import { uiAlert } from './dialogs';

interface Line { key: string; productId: string; newName: string; newSelling: number; qty: number; unitPrice: number }
const NEW = '__new';
const emptyLine = (): Line => ({ key: newId('ln'), productId: '', newName: '', newSelling: 0, qty: 1, unitPrice: 0 });

interface Props {
  settings: ShopSettings;
  products: Product[];
  onUpdateProducts: (products: Product[]) => void;
  suppliers: Supplier[];
  presetSupplierId?: string;
  onUpdateSuppliers: (suppliers: Supplier[]) => void;
  onAddExpense: (expense: Expense) => void;
  onClose: () => void;
}

/** Achat de marchandises chez un fournisseur : payé, à crédit ou en partie. */
export const PurchaseModal: React.FC<Props> = ({
  settings, products, onUpdateProducts, suppliers, presetSupplierId = '', onUpdateSuppliers, onAddExpense, onClose,
}) => {
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const amount = lines.reduce((a, l) => a + Math.round((l.qty || 0) * (l.unitPrice || 0)), 0);
  const [supplierId, setSupplierId] = useState(presetSupplierId);
  const [newSupplier, setNewSupplier] = useState('');
  const [paidInput, setPaidInput] = useState<number | null>(0); // par défaut : à crédit
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [dueDate, setDueDate] = useState('');
  const paid = Math.min(paidInput ?? amount, amount);
  const field = 'w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm';

  const setLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pickProduct = (key: string, productId: string) => {
    const p = products.find((x) => x.id === productId);
    setLine(key, { productId, unitPrice: p ? p.purchasePrice : 0 });
  };
  const lineName = (l: Line) => (l.productId === NEW ? l.newName.trim() : products.find((p) => p.id === l.productId)?.name || '');
  const validLines = lines.filter((l) => l.productId && lineName(l) && l.qty > 0 && l.unitPrice > 0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validLines.length === 0 || amount <= 0) { uiAlert('Ajoutez au moins un article avec sa quantité et son prix d\'achat.'); return; }
    if (lines.some((l) => l.productId === NEW && l.newName.trim() && l.newSelling <= 0)) { uiAlert('Indiquez le prix de vente des nouveaux articles.'); return; }
    const title = ('Achat : ' + validLines.map((l) => `${lineName(l)} ×${l.qty}`).join(', ')).slice(0, 140);
    if (paid < amount && !supplierId && !newSupplier.trim()) {
      uiAlert('Pour un achat à crédit, choisissez ou saisissez le fournisseur.');
      return;
    }
    const res = applyPurchaseCredit({ total: amount, paid, supplierId, newSupplierName: newSupplier, suppliers });
    let list = res.suppliers;
    if (res.supplierId && res.credit > 0 && dueDate) {
      list = list.map((s) => (s.id === res.supplierId ? { ...s, dueDate: new Date(dueDate).toISOString() } : s));
    }
    if (list !== suppliers) onUpdateSuppliers(list);
    // Les marchandises reçues entrent en stock (quantité + prix d'achat moyen), ou créent un nouvel article
    let stock = products;
    const now = new Date().toISOString();
    for (const l of validLines) {
      if (l.productId === NEW) {
        const same = stock.find((p) => p.name.trim().toLowerCase() === l.newName.trim().toLowerCase());
        if (same) {
          stock = stock.map((p) => (p.id === same.id
            ? { ...p, stockQuantity: p.stockQuantity + l.qty, purchasePrice: weightedCost(p.stockQuantity, p.purchasePrice, l.qty, l.unitPrice), lastRestockedDate: now }
            : p));
        } else {
          stock = [...stock, {
            id: newId('prod'), name: l.newName.trim(), category: 'Divers', purchasePrice: l.unitPrice, sellingPrice: l.newSelling,
            stockQuantity: l.qty, minAlertThreshold: 5, unit: 'pièce', lastRestockedDate: now,
          }];
        }
      } else {
        stock = stock.map((p) => (p.id === l.productId
          ? { ...p, stockQuantity: p.stockQuantity + l.qty, purchasePrice: weightedCost(p.stockQuantity, p.purchasePrice, l.qty, l.unitPrice), lastRestockedDate: now }
          : p));
      }
    }
    onUpdateProducts(stock);
    onAddExpense({
      id: newId('exp'),
      date: now,
      title,
      amount,
      category: 'supply',
      paymentMethod: method,
      supplierId: res.supplierId,
      paidAmount: paid,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-stone-200 p-5 sm:p-6 my-auto space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-stone-100">
          <h3 className="font-black text-lg text-stone-900">🚚 Achat chez un fournisseur</h3>
          <button onClick={onClose} className="text-stone-400 p-1">✕</button>
        </div>
        <form onSubmit={submit} className="space-y-3.5">
          <div className="space-y-2.5">
            <div className="text-xs font-bold text-stone-700">Articles achetés *</div>
            {lines.map((l, idx) => {
              const p = products.find((x) => x.id === l.productId);
              return (
                <div key={l.key} className="p-3 rounded-2xl bg-stone-50 border border-stone-200 space-y-2">
                  <div className="flex items-start gap-2">
                    <Select className={field + ' !mt-0 flex-1 min-w-0'} value={l.productId} onChange={(e) => pickProduct(l.key, e.target.value)}>
                      <option value="">— Choisir un article —</option>
                      {products.map((x) => <option key={x.id} value={x.id}>{x.name} (en stock : {x.stockQuantity})</option>)}
                      <option value={NEW}>➕ Nouvel article</option>
                    </Select>
                    {lines.length > 1 && (
                      <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="p-2 text-stone-400 hover:text-rose-600" aria-label="Retirer cet article">✕</button>
                    )}
                  </div>
                  {l.productId === NEW && (
                    <div className="grid grid-cols-2 gap-2">
                      <input className={field + ' !mt-0'} placeholder="Nom du nouvel article" value={l.newName} onChange={(e) => setLine(l.key, { newName: e.target.value })} />
                      <input type="number" min="0" className={field + ' !mt-0 font-mono-num'} placeholder="Prix de vente" value={l.newSelling || ''} onChange={(e) => setLine(l.key, { newSelling: Number(e.target.value) })} />
                    </div>
                  )}
                  {l.productId && (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[11px] font-bold text-stone-600">Quantité reçue
                        <input type="number" min="1" className={field + ' font-mono-num'} value={l.qty || ''} onChange={(e) => setLine(l.key, { qty: Number(e.target.value) })} />
                      </label>
                      <label className="text-[11px] font-bold text-stone-600">Prix d'achat unitaire
                        <input type="number" min="0" className={field + ' font-mono-num'} value={l.unitPrice || ''} onChange={(e) => setLine(l.key, { unitPrice: Number(e.target.value) })} />
                      </label>
                    </div>
                  )}
                  {l.productId && l.qty > 0 && l.unitPrice > 0 && (
                    <div className="text-[11px] text-stone-500 flex justify-between gap-2">
                      <span>{p ? `Stock après achat : ${p.stockQuantity + l.qty} ${p.unit}` : 'Nouvel article ajouté au stock'}</span>
                      <b className="font-mono-num text-stone-700 whitespace-nowrap">{formatCurrency(Math.round(l.qty * l.unitPrice), settings.currency)}</b>
                    </div>
                  )}
                </div>
              );
            })}
            <button type="button" onClick={() => setLines((ls) => [...ls, emptyLine()])} className="w-full py-2 rounded-xl border border-dashed border-indigo-300 text-indigo-800 text-xs font-bold">+ Ajouter un autre article</button>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-indigo-50 border border-indigo-200 px-3 py-2.5">
            <span className="text-xs font-bold text-indigo-900">Montant total de l'achat</span>
            <span className="text-base font-black font-mono-num text-indigo-900">{formatCurrency(amount, settings.currency)}</span>
          </div>
          {amount > 0 && (
            <>
              <SupplierCreditFields
                total={amount} currency={settings.currency} suppliers={suppliers}
                supplierId={supplierId} setSupplierId={setSupplierId}
                newSupplierName={newSupplier} setNewSupplierName={setNewSupplier}
                paid={paid} setPaid={setPaidInput}
              />
              {paid > 0 && (
                <div>
                  <label className="text-xs font-bold text-stone-700">Partie payée par</label>
                  <Select className={field} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                    <option value="cash">Espèces Caisse</option>
                    <option value="wave">Wave</option>
                    <option value="orange_money">Orange Money</option>
                    <option value="mtn_momo">MTN MoMo</option>
                    <option value="moov_money">Moov Money</option>
                    <option value="bank_transfer">Compte Bancaire</option>
                  </Select>
                </div>
              )}
              {paid < amount && (
                <div>
                  <label className="text-xs font-bold text-stone-700">Date limite de paiement (optionnel)</label>
                  <input type="date" className={field} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              )}
            </>
          )}
          <p className="text-[11px] text-stone-500">Les quantités reçues sont ajoutées automatiquement à votre stock.</p>
          <div className="pt-1 flex gap-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-stone-300 text-stone-700 font-bold text-sm">Annuler</button>
            <button type="submit" className="flex-1 py-2.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-bold text-sm">Enregistrer l'achat</button>
          </div>
        </form>
      </div>
    </div>
  );
};
