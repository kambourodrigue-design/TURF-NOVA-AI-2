import { newId } from '../../../shared/syncCore';
import React, { useState, useMemo } from 'react';
import { Expense, ExpenseCategory, PaymentMethod, ShopSettings, Supplier, Product } from '../../types';
import { PurchaseModal } from '../common/PurchaseModal';
import { SupplierCreditFields } from '../common/SupplierCreditFields';
import { applyPurchaseCredit } from '../../services/purchases';
import { creditPart } from '../../services/treasury';
import { formatCurrency, getExpenseCategoryDetails, getPaymentMethodDetails } from '../../services/financials';
import { 
  Receipt, 
  Plus, 
  Trash2, 
  Calendar, 
  PieChart, 
  TrendingDown, 
  Wallet,
  AlertCircle
} from 'lucide-react';
import { Select } from '../common/dialogs';
import { uiAlert, uiConfirm } from '../common/dialogs';

interface ExpensesViewProps {
  expenses: Expense[];
  settings: ShopSettings;
  onAddExpense: (expense: Expense) => void;
  onDeleteExpense: (expenseId: string) => void;
  suppliers?: Supplier[];
  onUpdateSuppliers?: (suppliers: Supplier[]) => void;
  products?: Product[];
  onUpdateProducts?: (products: Product[]) => void;
}

export const ExpensesView: React.FC<ExpensesViewProps> = ({
  expenses,
  settings,
  onAddExpense,
  onDeleteExpense,
  suppliers = [],
  onUpdateSuppliers,
  products = [],
  onUpdateProducts,
}) => {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isPurchaseOpen, setIsPurchaseOpen] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>('all');

  // Form states
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [category, setCategory] = useState<ExpenseCategory>('transport');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [notes, setNotes] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [newSupplierName, setNewSupplierName] = useState('');
  const [paidInput, setPaidInput] = useState<number | null>(null);
  const isPurchase = category === 'supply' && !!onUpdateSuppliers;
  const paidValue = paidInput ?? amount;

  // 30 days cutoff
  const now = Date.now();
  const last30dCutoff = now - 30 * 86400000;
  
  const recentExpenses = useMemo(() => {
    return expenses.filter(e => new Date(e.date).getTime() >= last30dCutoff);
  }, [expenses, last30dCutoff]);

  const totalLast30d = useMemo(() => {
    return recentExpenses.reduce((sum, e) => sum + e.amount, 0);
  }, [recentExpenses]);

  // Breakdown by category
  const categoryBreakdown = useMemo(() => {
    const map = new Map<ExpenseCategory, number>();
    recentExpenses.forEach(e => {
      const current = map.get(e.category) || 0;
      map.set(e.category, current + e.amount);
    });

    return Array.from(map.entries()).map(([cat, total]) => ({
      category: cat,
      total,
      pct: totalLast30d > 0 ? (total / totalLast30d) * 100 : 0,
      details: getExpenseCategoryDetails(cat),
    })).sort((a, b) => b.total - a.total);
  }, [recentExpenses, totalLast30d]);

  // Personal draws warning calculation
  const personalDrawsTotal = useMemo(() => {
    return recentExpenses
      .filter(e => e.category === 'personal_draw')
      .reduce((sum, e) => sum + e.amount, 0);
  }, [recentExpenses]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || amount <= 0) return;

    let supplierRef: string | undefined;
    let paidAmount: number | undefined;
    if (isPurchase) {
      const paid = Math.min(Math.max(0, paidValue), Number(amount));
      if (paid < Number(amount) && !supplierId && !newSupplierName.trim()) {
        uiAlert('Pour un achat à crédit, choisissez ou saisissez le fournisseur.');
        return;
      }
      const res = applyPurchaseCredit({
        total: Number(amount), paid, supplierId, newSupplierName, suppliers,
      });
      if (res.supplierId) {
        if (res.suppliers !== suppliers) onUpdateSuppliers!(res.suppliers);
        supplierRef = res.supplierId;
      }
      paidAmount = paid;
    }

    const newExpense: Expense = {
      id: newId('exp'),
      date: new Date().toISOString(),
      title: title.trim(),
      amount: Number(amount),
      category,
      paymentMethod,
      notes: notes.trim() || undefined,
      ...(isPurchase ? { supplierId: supplierRef, paidAmount } : {}),
    };

    onAddExpense(newExpense);
    setIsAddModalOpen(false);
    setTitle('');
    setAmount(0);
    setNotes('');
    setSupplierId('');
    setNewSupplierName('');
    setPaidInput(null);
  };

  const handleDelete = async (exp: Expense) => {
    const credit = creditPart(exp);
    if (exp.supplierId && credit > 0 && onUpdateSuppliers) {
      const sup = suppliers.find(x => x.id === exp.supplierId);
      if (sup && await uiConfirm(`Cet achat avait ${formatCurrency(credit, settings.currency)} à crédit chez ${sup.name}. Annuler aussi cette dette ?`)) {
        onUpdateSuppliers(suppliers.map(x => x.id === sup.id ? { ...x, totalDebt: Math.max(0, x.totalDebt - credit) } : x));
      }
    }
    onDeleteExpense(exp.id);
  };

  const filteredExpenses = useMemo(() => {
    return expenses.filter(e => {
      if (filterCategory === 'all') return true;
      return e.category === filterCategory;
    });
  }, [expenses, filterCategory]);

  return (
    <div className="space-y-5 pb-20">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-stone-900 tracking-tight">
            Suivi des Dépenses Quotidiennes
          </h2>
          <p className="text-xs sm:text-sm text-stone-500">
            Enregistrez chaque sortie d'argent pour calculer votre rentabilité exacte.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 shrink-0">
          {onUpdateSuppliers && (
            <button
              onClick={() => setIsPurchaseOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-bold text-sm shadow-sm transition active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>Achat fournisseur</span>
            </button>
          )}
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm shadow-sm transition active:scale-95 shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Nouvelle Dépense</span>
        </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
        
        <div className="bg-white rounded-2xl p-4 border border-stone-200 shadow-xs">
          <span className="text-xs font-semibold text-stone-500">Dépenses (30 derniers jours)</span>
          <div className="text-2xl font-black text-rose-600 mt-1 font-mono-num">
            {formatCurrency(totalLast30d, settings.currency)}
          </div>
          <div className="text-xs text-stone-500 mt-0.5">
            {recentExpenses.length} transactions enregistrées
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-stone-200 shadow-xs">
          <span className="text-xs font-semibold text-stone-500">Prélèvements Personnels</span>
          <div className="text-2xl font-black text-purple-700 mt-1 font-mono-num">
            {formatCurrency(personalDrawsTotal, settings.currency)}
          </div>
          <div className="text-xs text-stone-500 mt-0.5">
            Argent retiré pour la famille / dépenses privées
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-stone-200 shadow-xs">
          <span className="text-xs font-semibold text-stone-500">Charges d'Exploitation</span>
          <div className="text-2xl font-black text-stone-900 mt-1 font-mono-num">
            {formatCurrency(totalLast30d - personalDrawsTotal, settings.currency)}
          </div>
          <div className="text-xs text-stone-500 mt-0.5">
            Transport, loyer, factures, salaires
          </div>
        </div>

      </div>

      {/* Personal Draw Warning Banner */}
      {personalDrawsTotal > 0 && (
        <div className="p-3.5 bg-purple-50 border border-purple-200 rounded-2xl text-xs text-purple-900 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-purple-700 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Astuce Trésorerie : </span>
            Vous avez prélevé {formatCurrency(personalDrawsTotal, settings.currency)} pour convenance personnelle. Nafora sépare ces montants de vos charges professionnelles afin de ne pas fausser votre marge d'exploitation devant le banquier.
          </div>
        </div>
      )}

      {/* Category Breakdown Progress Bars */}
      <div className="bg-white rounded-3xl p-5 border border-stone-200 shadow-xs space-y-3">
        <h3 className="font-bold text-sm text-stone-900 flex items-center gap-2">
          <PieChart className="w-4 h-4 text-emerald-800" />
          <span>Répartition des Dépenses par Poste (30 jours)</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          {categoryBreakdown.map((item) => (
            <div key={item.category} className="p-3 rounded-2xl bg-stone-50 border border-stone-100">
              <div className="flex justify-between items-center gap-2 text-xs font-semibold">
                <span className="text-stone-800 truncate min-w-0">{item.details.label}</span>
                <span className="font-mono-num font-bold text-stone-900 whitespace-nowrap shrink-0">{formatCurrency(item.total, settings.currency)}</span>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-stone-200 h-2 rounded-full overflow-hidden mt-2">
                <div 
                  className="bg-emerald-800 h-full rounded-full transition-all"
                  style={{ width: `${Math.min(100, Math.max(5, item.pct))}%` }}
                />
              </div>

              <div className="text-right text-[10px] text-stone-500 font-bold mt-1">
                {item.pct.toFixed(0)}% du total
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Expenses History List */}
      <div className="bg-white rounded-3xl border border-stone-200 overflow-hidden shadow-xs">
        <div className="p-4 border-b border-stone-100 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-sm text-stone-900">Historique des Dépenses</h3>
          <Select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="text-xs bg-stone-50 border border-stone-200 rounded-xl px-2.5 py-1.5 font-medium"
          >
            <option value="all">Toutes les catégories</option>
            <option value="supply">Achat de marchandises (stock à revendre)</option>
            <option value="transport">Transport</option>
            <option value="rent">Loyer</option>
            <option value="utilities">Factures</option>
            <option value="salary">Salaires</option>
            <option value="taxes">Taxes</option>
            <option value="personal_draw">Prélèvements perso</option>
          </Select>
        </div>

        <div className="divide-y divide-stone-100">
          {filteredExpenses.length === 0 ? (
            <div className="p-8 text-center text-stone-400 text-sm">
              Aucune dépense enregistrée.
            </div>
          ) : (
            filteredExpenses.slice().reverse().map((expense) => {
              const catDetails = getExpenseCategoryDetails(expense.category);
              const payDetails = getPaymentMethodDetails(expense.paymentMethod);

              return (
                <div key={expense.id} className="p-3 sm:p-4 flex items-start gap-3 hover:bg-stone-50/70 transition">
                  <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center shrink-0">
                    <Receipt className="w-5 h-5" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-sm text-stone-900 break-words">{expense.title}</h4>
                    <div className="text-[11px] text-stone-500 flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5">
                      <span className="font-medium text-stone-600">{catDetails.label}</span>
                      <span>•</span>
                      <span>{new Date(expense.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${payDetails.badgeBg}`}>
                        {payDetails.label}
                      </span>
                    </div>
                    {creditPart(expense) > 0 && (
                      <p className="text-[11px] font-bold text-indigo-700 mt-1 break-words">
                        🚚 À crédit : {formatCurrency(creditPart(expense), settings.currency)} dû{expense.supplierId ? ` à ${suppliers.find(x => x.id === expense.supplierId)?.name || 'un fournisseur'}` : ''}
                      </p>
                    )}
                    {expense.notes && (
                      <p className="text-[11px] text-stone-400 italic mt-0.5 break-words">{expense.notes}</p>
                    )}
                  </div>

                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <span className="font-black text-rose-700 font-mono-num text-sm sm:text-base whitespace-nowrap">
                      -{formatCurrency(expense.amount, settings.currency)}
                    </span>
                    <button
                      onClick={() => handleDelete(expense)}
                      className="text-stone-300 hover:text-rose-600 p-1 rounded-lg"
                      title="Supprimer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Add Expense Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-stone-200 p-5 sm:p-6 my-auto animate-in fade-in zoom-in-95 space-y-4">
            
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <h3 className="font-black text-lg text-stone-900">Enregistrer une Dépense</h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-stone-400 p-1">✕</button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div>
                <label className="text-xs font-bold text-stone-700">Motif de la dépense *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Transport Adjamé, Loyer, Facture CIE..."
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-stone-700">Montant ({settings.currency}) *</label>
                <input
                  type="number"
                  required
                  min="50"
                  value={amount || ''}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-base font-black font-mono-num text-rose-700"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-stone-700">Catégorie</label>
                  <Select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                    className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs sm:text-sm font-medium"
                  >
                    <option value="transport">Transport / Gbaka / Fret</option>
                    <option value="supply">Achat de marchandises (stock à revendre)</option>
                    <option value="rent">Loyer boutique</option>
                    <option value="utilities">Factures CIE/Eau/Internet</option>
                    <option value="salary">Salaires / Aides</option>
                    <option value="taxes">Taxes Mairie / ODP</option>
                    <option value="personal_draw">Prélèvement Personnel</option>
                    <option value="maintenance">Imprévus / Réparation</option>
                    <option value="other">Autre</option>
                  </Select>
                  {category === 'supply' && <p className="mt-1 text-[11px] text-amber-800">Pour du stock à revendre seulement. Eau, électricité, loyer, transport… : choisissez la catégorie correspondante, sinon elles ne seront pas déduites du bénéfice.</p>}
                </div>

                <div>
                  <label className="text-xs font-bold text-stone-700">{isPurchase ? 'Partie payée par' : 'Payé par'}</label>
                  <Select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs sm:text-sm font-medium"
                  >
                    <option value="cash">Espèces Caisse</option>
                    <option value="wave">Wave</option>
                    <option value="orange_money">Orange Money</option>
                    <option value="mtn_momo">MTN MoMo</option>
                    <option value="moov_money">Moov Money</option>
                    <option value="bank_transfer">Compte Bancaire</option>
                  </Select>
                </div>
              </div>

              {isPurchase && amount > 0 && (
                <SupplierCreditFields
                  total={Number(amount)} currency={settings.currency} suppliers={suppliers}
                  supplierId={supplierId} setSupplierId={setSupplierId}
                  newSupplierName={newSupplierName} setNewSupplierName={setNewSupplierName}
                  paid={Math.min(paidValue, Number(amount))} setPaid={setPaidInput}
                />
              )}

              <div>
                <label className="text-xs font-bold text-stone-700">Notes / Précisions</label>
                <input
                  type="text"
                  placeholder="Optionnel..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-stone-300 text-stone-700 font-bold text-sm"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm shadow-sm"
                >
                  Valider Dépense
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {isPurchaseOpen && onUpdateSuppliers && onUpdateProducts && (
        <PurchaseModal
          settings={settings} products={products} onUpdateProducts={onUpdateProducts} suppliers={suppliers}
          onUpdateSuppliers={onUpdateSuppliers} onAddExpense={onAddExpense}
          onClose={() => setIsPurchaseOpen(false)}
        />
      )}
    </div>
  );
};
