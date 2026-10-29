import { newId } from '../../../shared/syncCore';
import React, { useState, useMemo } from 'react';
import { Customer, DebtPayment, Supplier, SupplierPayment, PaymentMethod, ShopSettings, Expense, Product } from '../../types';
import { RemindersPanel } from './RemindersPanel';
import { PurchaseModal } from '../common/PurchaseModal';
import { formatCurrency, getPaymentMethodDetails } from '../../services/financials';
import { generateDebtReminderWhatsAppUrl, cleanPhoneNumber } from '../../services/whatsapp';
import { api } from '../../services/api';
import { 
  BookUser, 
  Truck, 
  Plus, 
  MessageCircle, 
  CheckCircle, 
  Clock, 
  Search, 
  ArrowDownLeft, 
  ArrowUpRight, 
  History, 
  Trash2,
  AlertCircle,
  Calendar,
  Building,
  Scale,
  Sparkles
} from 'lucide-react';
import { Select } from '../common/dialogs';
import { uiAlert } from '../common/dialogs';

interface DebtsViewProps {
  customers: Customer[];
  suppliers: Supplier[];
  settings: ShopSettings;
  onUpdateCustomers: (customers: Customer[]) => void;
  onUpdateSuppliers: (suppliers: Supplier[]) => void;
  allowSuppliers?: boolean;
  onAddExpense?: (expense: Expense) => void;
  products?: Product[];
  onUpdateProducts?: (products: Product[]) => void;
}

export const DebtsView: React.FC<DebtsViewProps> = ({
  customers,
  suppliers = [],
  settings,
  onUpdateCustomers,
  onUpdateSuppliers,
  allowSuppliers = true,
  onAddExpense,
  products = [],
  onUpdateProducts,
}) => {
  const [isPurchaseOpen, setIsPurchaseOpen] = useState(false);
  const [aiBusyId, setAiBusyId] = useState<string | null>(null);
  const [aiMsg, setAiMsg] = useState('');
  const aiReminder = async (customer: Customer) => {
    if (aiBusyId) return;
    setAiBusyId(customer.id); setAiMsg('');
    // Ouvrir la fenêtre tout de suite (anti-blocage des popups), puis la rediriger.
    const win = window.open('about:blank', '_blank');
    let url = generateDebtReminderWhatsAppUrl(customer, settings);
    try {
      const r = await api.ai({
        mode: 'reminder', tone: 'amical',
        firstName: (customer.name || '').trim().split(/\s+/)[0],
        amount: formatCurrency(customer.totalDebt, settings.currency),
        shopName: settings.shopName, ownerName: settings.ownerName, payPhone: settings.phone,
      });
      url = `https://wa.me/${cleanPhoneNumber(customer.phone)}?text=${encodeURIComponent(r.text)}`;
    } catch {
      setAiMsg("L'IA n'est pas disponible : message standard utilisé.");
    }
    if (win) win.location.href = url; else window.location.href = url;
    onUpdateCustomers(customers.map((x) => (x.id === customer.id ? { ...x, lastReminderSentDate: new Date().toISOString() } : x)));
    setAiBusyId(null);
  };
  const [activeTabRaw, setActiveTab] = useState<'customers' | 'suppliers'>('customers');
  const activeTab = allowSuppliers ? activeTabRaw : 'customers';
  const [searchQuery, setSearchQuery] = useState('');
  const [filterDebtorsOnly, setFilterDebtorsOnly] = useState(true);

  // Customer Modals state
  const [isNewCustomerModalOpen, setIsNewCustomerModalOpen] = useState(false);
  const [isRepaymentModalOpen, setIsRepaymentModalOpen] = useState(false);
  const [isAddCreditModalOpen, setIsAddCreditModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // Supplier Modals state
  const [isNewSupplierModalOpen, setIsNewSupplierModalOpen] = useState(false);
  const [isSupplierRepaymentModalOpen, setIsSupplierRepaymentModalOpen] = useState(false);
  const [isAddSupplierCreditModalOpen, setIsAddSupplierCreditModalOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);

  // Customer Form states
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custAddress, setCustAddress] = useState('');
  const [custInitialDebt, setCustInitialDebt] = useState<number>(0);
  const [custNotes, setCustNotes] = useState('');

  // Customer Repayment form
  const [repayAmount, setRepayAmount] = useState<number>(0);
  const [repayMethod, setRepayMethod] = useState<PaymentMethod>('wave');
  const [repayNote, setRepayNote] = useState('');

  // Customer Add credit form
  const [creditAmount, setCreditAmount] = useState<number>(0);
  const [creditReason, setCreditReason] = useState('');

  // Supplier Form states
  const [supName, setSupName] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supMarket, setSupMarket] = useState('');
  const [supInitialDebt, setSupInitialDebt] = useState<number>(0);
  const [supDueDate, setSupDueDate] = useState('');
  const [supNotes, setSupNotes] = useState('');

  // Supplier Repayment form
  const [supRepayAmount, setSupRepayAmount] = useState<number>(0);
  const [supRepayMethod, setSupRepayMethod] = useState<PaymentMethod>('wave');
  const [supRepayNote, setSupRepayNote] = useState('');

  // Supplier Add credit form
  const [supCreditAmount, setSupCreditAmount] = useState<number>(0);
  const [supCreditReason, setSupCreditReason] = useState('');

  // Computations
  const totalCustomerDebts = useMemo(() => customers.reduce((sum, c) => sum + c.totalDebt, 0), [customers]);
  const totalSupplierDebts = useMemo(() => suppliers.reduce((sum, s) => sum + s.totalDebt, 0), [suppliers]);
  const netDebtPosition = totalCustomerDebts - totalSupplierDebts;

  const activeCustomerDebtors = useMemo(() => customers.filter(c => c.totalDebt > 0), [customers]);
  const activeSupplierDebts = useMemo(() => suppliers.filter(s => s.totalDebt > 0), [suppliers]);

  // Filtered lists
  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      const matchSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.phone.includes(searchQuery);
      if (filterDebtorsOnly) return matchSearch && c.totalDebt > 0;
      return matchSearch;
    });
  }, [customers, searchQuery, filterDebtorsOnly]);

  const filteredSuppliers = useMemo(() => {
    return suppliers.filter(s => {
      const matchSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.phone.includes(searchQuery) ||
        (s.companyOrMarket && s.companyOrMarket.toLowerCase().includes(searchQuery.toLowerCase()));
      if (filterDebtorsOnly) return matchSearch && s.totalDebt > 0;
      return matchSearch;
    });
  }, [suppliers, searchQuery, filterDebtorsOnly]);

  // Customer actions
  const handleSaveCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!custName.trim()) return;

    const newCust: Customer = {
      id: newId('cust'),
      name: custName.trim(),
      phone: custPhone.trim() || 'Non renseigné',
      address: custAddress.trim() || undefined,
      totalDebt: Number(custInitialDebt) || 0,
      creditLimit: 50000,
      notes: custNotes.trim() || undefined,
      createdAt: new Date().toISOString(),
      payments: []
    };

    onUpdateCustomers([...customers, newCust]);
    setIsNewCustomerModalOpen(false);
    setCustName('');
    setCustPhone('');
    setCustAddress('');
    setCustInitialDebt(0);
    setCustNotes('');
  };

  const handleSubmitRepayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer || repayAmount <= 0) return;
    // On n'enregistre jamais plus que la dette restante (sinon la caisse compterait de l'argent en trop).
    const repayNow = Math.min(Number(repayAmount), selectedCustomer.totalDebt);
    if (repayNow <= 0) { uiAlert("Ce client n'a plus de dette."); return; }

    const newPayment: DebtPayment = {
      id: newId('pay'),
      date: new Date().toISOString(),
      amount: repayNow,
      paymentMethod: repayMethod,
      note: repayNote || undefined,
    };

    const updated = customers.map(c => {
      if (c.id === selectedCustomer.id) {
        const remaining = Math.max(0, c.totalDebt - repayNow);
        return {
          ...c,
          totalDebt: remaining,
          payments: [newPayment, ...(c.payments || [])],
        };
      }
      return c;
    });

    onUpdateCustomers(updated);
    setIsRepaymentModalOpen(false);
    setSelectedCustomer(null);
  };

  const handleSubmitAddCredit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer || creditAmount <= 0) return;

    const updated = customers.map(c => {
      if (c.id === selectedCustomer.id) {
        return {
          ...c,
          totalDebt: c.totalDebt + Number(creditAmount),
          notes: creditReason ? `${c.notes ? c.notes + ' | ' : ''}+${creditAmount} F (${creditReason})` : c.notes
        };
      }
      return c;
    });

    onUpdateCustomers(updated);
    setIsAddCreditModalOpen(false);
    setSelectedCustomer(null);
  };

  // Supplier actions
  const handleSaveSupplier = (e: React.FormEvent) => {
    e.preventDefault();
    if (!supName.trim()) return;

    const newSup: Supplier = {
      id: newId('sup'),
      name: supName.trim(),
      phone: supPhone.trim() || 'Non renseigné',
      companyOrMarket: supMarket.trim() || undefined,
      totalDebt: Number(supInitialDebt) || 0,
      dueDate: supDueDate ? new Date(supDueDate).toISOString() : undefined,
      notes: supNotes.trim() || undefined,
      createdAt: new Date().toISOString(),
      payments: []
    };

    onUpdateSuppliers([...suppliers, newSup]);
    setIsNewSupplierModalOpen(false);
    setSupName('');
    setSupPhone('');
    setSupMarket('');
    setSupInitialDebt(0);
    setSupDueDate('');
    setSupNotes('');
  };

  const handleSubmitSupplierRepayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplier || supRepayAmount <= 0) return;
    const supRepayNow = Math.min(Number(supRepayAmount), selectedSupplier.totalDebt);
    if (supRepayNow <= 0) { uiAlert("Ce fournisseur n'a plus de dette."); return; }

    const newPayment: SupplierPayment = {
      id: newId('spay'),
      date: new Date().toISOString(),
      amount: supRepayNow,
      paymentMethod: supRepayMethod,
      note: supRepayNote || undefined,
    };

    const updated = suppliers.map(s => {
      if (s.id === selectedSupplier.id) {
        const remaining = Math.max(0, s.totalDebt - supRepayNow);
        return {
          ...s,
          totalDebt: remaining,
          payments: [newPayment, ...(s.payments || [])],
        };
      }
      return s;
    });

    onUpdateSuppliers(updated);
    setIsSupplierRepaymentModalOpen(false);
    setSelectedSupplier(null);
  };

  const handleSubmitAddSupplierCredit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplier || supCreditAmount <= 0) return;

    const updated = suppliers.map(s => {
      if (s.id === selectedSupplier.id) {
        return {
          ...s,
          totalDebt: s.totalDebt + Number(supCreditAmount),
          notes: supCreditReason ? `${s.notes ? s.notes + ' | ' : ''}+${supCreditAmount} F (${supCreditReason})` : s.notes
        };
      }
      return s;
    });

    onUpdateSuppliers(updated);
    setIsAddSupplierCreditModalOpen(false);
    setSelectedSupplier(null);
  };

  const generateSupplierWhatsAppUrl = (supplier: Supplier, amountPaid?: number) => {
    const lines = [
      `Bonjour *${supplier.name}*,`,
      `C'est la boutique *${settings.shopName}* (${settings.ownerName}) qui vous contacte.`,
      ``,
    ];

    if (amountPaid && amountPaid > 0) {
      lines.push(`Nous venons d'effectuer un règlement de *${formatCurrency(amountPaid, settings.currency)}* sur notre compte.`);
      lines.push(`Solde restant convenu : *${formatCurrency(Math.max(0, supplier.totalDebt - amountPaid), settings.currency)}*.`);
    } else {
      lines.push(`Concernant notre compte fournisseur pour les livraisons de marchandises :`);
      lines.push(`Solde en cours d'apurement : *${formatCurrency(supplier.totalDebt, settings.currency)}*.`);
    }

    lines.push(``);
    lines.push(`Merci pour votre confiance et excellent partenariat commercial !`);
    lines.push(`🙏 *${settings.shopName}*`);

    const text = encodeURIComponent(lines.join('\n'));
    return `https://wa.me/${cleanPhoneNumber(supplier.phone)}?text=${text}`;
  };

  return (
    <div className="space-y-5 pb-20">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-stone-900 tracking-tight">
            Carnet des Créances & Dettes
          </h2>
          <p className="text-xs sm:text-sm text-stone-500">
            Suivi complet des crédits clients et des dettes envers vos grossistes/fournisseurs.
          </p>
        </div>

        {activeTab === 'customers' ? (
          <button
            onClick={() => setIsNewCustomerModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white font-bold text-xs sm:text-sm shadow-sm transition active:scale-95 shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Nouveau Client Débiteur</span>
          </button>
        ) : (
          <div className="flex flex-wrap gap-2 shrink-0">
          {onAddExpense && (
            <button
              onClick={() => setIsPurchaseOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-stone-950 font-bold text-xs sm:text-sm shadow-sm transition active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>Achat fournisseur (à crédit)</span>
            </button>
          )}
          <button
            onClick={() => setIsNewSupplierModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-bold text-xs sm:text-sm shadow-sm transition active:scale-95 shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Nouveau Fournisseur Grossiste</span>
          </button>
          </div>
        )}
      </div>

      {/* Global Net Debt Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        
        {/* Total Owed by Customers */}
        <div 
          onClick={() => setActiveTab('customers')}
          className={`p-4 rounded-2xl border transition cursor-pointer ${
            activeTab === 'customers' ? 'bg-amber-50/60 border-amber-300 ring-2 ring-amber-400/20' : 'bg-white border-stone-200 hover:border-amber-200'
          }`}
        >
          <div className="flex items-center justify-between text-stone-500 text-xs font-semibold">
            <span>Créances Clients (À Encaisser)</span>
            <div className="w-7 h-7 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center font-bold">
              <BookUser className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-black text-amber-600 mt-2 font-mono-num">
            {formatCurrency(totalCustomerDebts, settings.currency)}
          </div>
          <div className="text-xs text-stone-500 mt-0.5">
            {activeCustomerDebtors.length} client(s) doivent de l'argent
          </div>
        </div>

        {allowSuppliers && (<>
        {/* Total Owed to Suppliers */}
        <div 
          onClick={() => setActiveTab('suppliers')}
          className={`p-4 rounded-2xl border transition cursor-pointer ${
            activeTab === 'suppliers' ? 'bg-indigo-50/60 border-indigo-300 ring-2 ring-indigo-400/20' : 'bg-white border-stone-200 hover:border-indigo-200'
          }`}
        >
          <div className="flex items-center justify-between text-stone-500 text-xs font-semibold">
            <span>Dettes Fournisseurs (À Payer)</span>
            <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-800 flex items-center justify-center font-bold">
              <Truck className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-black text-indigo-700 mt-2 font-mono-num">
            {formatCurrency(totalSupplierDebts, settings.currency)}
          </div>
          <div className="text-xs text-stone-500 mt-0.5">
            {activeSupplierDebts.length} grossiste(s) à régler
          </div>
        </div>

        {/* Net Debt Position */}
        <div className="bg-white rounded-2xl p-4 border border-stone-200 shadow-xs">
          <div className="flex items-center justify-between text-stone-500 text-xs font-semibold">
            <span>Position Nette de Créance</span>
            <div className="w-7 h-7 rounded-lg bg-stone-100 text-stone-700 flex items-center justify-center font-bold">
              <Scale className="w-4 h-4" />
            </div>
          </div>
          <div className={`text-xl sm:text-2xl font-black mt-2 font-mono-num ${netDebtPosition >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
            {netDebtPosition >= 0 ? `+${formatCurrency(netDebtPosition, settings.currency)}` : formatCurrency(netDebtPosition, settings.currency)}
          </div>
          <div className="text-xs text-stone-500 mt-0.5">
            {netDebtPosition >= 0 ? "Vos créances couvrent vos dettes" : "Vos dettes dépassent vos créances"}
          </div>
        </div>

        </>)}

      </div>

      {/* Main Tab Switcher: Clients vs Fournisseurs */}
      <div className="flex bg-stone-200/80 p-1 rounded-2xl font-bold text-xs sm:text-sm">
        <button
          onClick={() => setActiveTab('customers')}
          className={`flex-1 py-2.5 rounded-xl transition flex items-center justify-center gap-2 ${
            activeTab === 'customers'
              ? 'bg-white text-emerald-950 shadow-sm'
              : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          <BookUser className="w-4 h-4 text-amber-600" />
          <span>Dettes Clients (À Encaisser) • {formatCurrency(totalCustomerDebts, settings.currency)}</span>
        </button>

        {allowSuppliers && (
        <button
          onClick={() => setActiveTab('suppliers')}
          className={`flex-1 py-2.5 rounded-xl transition flex items-center justify-center gap-2 ${
            activeTab === 'suppliers'
              ? 'bg-white text-indigo-950 shadow-sm'
              : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          <Truck className="w-4 h-4 text-indigo-700" />
          <span>Dettes Fournisseurs (À Payer) • {formatCurrency(totalSupplierDebts, settings.currency)}</span>
        </button>
        )}
      </div>

      {/* Search and Filter */}
      <div className="bg-white rounded-2xl p-3 sm:p-4 border border-stone-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            type="text"
            placeholder={activeTab === 'customers' ? "Rechercher un client..." : "Rechercher un grossiste, marché..."}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs sm:text-sm focus:ring-2 focus:ring-emerald-700"
          />
        </div>

        <button
          onClick={() => setFilterDebtorsOnly(!filterDebtorsOnly)}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition w-full sm:w-auto ${
            filterDebtorsOnly
              ? 'bg-stone-900 text-white'
              : 'bg-stone-100 text-stone-700'
          }`}
        >
          {filterDebtorsOnly ? "Seulement avec solde restant" : "Tous les comptes"}
        </button>
      </div>

      {aiMsg && <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">{aiMsg}</div>}
      {/* ==================== TAB 1: CUSTOMERS ==================== */}
      {activeTab === 'customers' && (
        <div className="space-y-3">
          <RemindersPanel customers={customers} settings={settings} onUpdateCustomers={onUpdateCustomers} allowAi={allowSuppliers} />
          {filteredCustomers.length === 0 ? (
            <div className="bg-white rounded-3xl p-8 text-center text-stone-400 border border-stone-200 text-sm">
              Aucun compte client trouvé pour ce filtre.
            </div>
          ) : (
            filteredCustomers.map((customer) => {
              const hasDebt = customer.totalDebt > 0;
              const whatsappUrl = generateDebtReminderWhatsAppUrl(customer, settings);

              return (
                <div 
                  key={customer.id}
                  className="bg-white rounded-2xl border border-stone-200 p-4 sm:p-5 shadow-xs hover:border-amber-300 transition space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className={`w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-sm shrink-0 ${
                        hasDebt ? 'bg-amber-100 text-amber-900 border border-amber-200' : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {customer.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <h4 className="font-extrabold text-base text-stone-900 break-words">{customer.name}</h4>
                          {hasDebt ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                              Dette en cours
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                              À jour
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-stone-500 mt-0.5">
                          📞 {customer.phone} {customer.address ? `• 📍 ${customer.address}` : ''}
                        </div>
                        {customer.notes && (
                          <p className="text-xs text-stone-600 bg-stone-50 p-1.5 rounded-lg mt-1 italic border border-stone-100">
                            {customer.notes}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="text-left sm:text-right mt-1 sm:mt-0">
                      <span className="text-xs text-stone-500 font-medium">Solde dû par le client :</span>
                      <div className={`text-xl sm:text-2xl font-black font-mono-num ${hasDebt ? 'text-amber-600' : 'text-emerald-700'}`}>
                        {formatCurrency(customer.totalDebt, settings.currency)}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="pt-2 border-t border-stone-100 flex flex-wrap items-center justify-between gap-2">
                    {hasDebt ? (
                      <a
                        href={whatsappUrl}
                        onClick={() => onUpdateCustomers(customers.map((x) => (x.id === customer.id ? { ...x, lastReminderSentDate: new Date().toISOString() } : x)))}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition active:scale-95"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        <span>Rappel WhatsApp</span>
                      </a>
                    ) : null}
                    {hasDebt && allowSuppliers ? (
                      <button
                        onClick={() => aiReminder(customer)}
                        disabled={aiBusyId === customer.id}
                        data-testid={`ai-reminder-${customer.id}`}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs shadow-xs transition active:scale-95 disabled:opacity-60"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>{aiBusyId === customer.id ? 'Rédaction…' : 'Relance IA'}</span>
                      </button>
                    ) : (
                      <div className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                        <CheckCircle className="w-3.5 h-3.5" /> Compte soldé
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setSelectedCustomer(customer);
                          setCreditAmount(5000);
                          setCreditReason('Achats divers à crédit');
                          setIsAddCreditModalOpen(true);
                        }}
                        className="px-3 py-1.5 rounded-xl border border-stone-300 text-stone-700 hover:bg-stone-50 font-bold text-xs transition"
                      >
                        + Accorder Crédit
                      </button>

                      {hasDebt && (
                        <button
                          onClick={() => {
                            setSelectedCustomer(customer);
                            setRepayAmount(customer.totalDebt);
                            setRepayMethod('wave');
                            setRepayNote('Règlement partiel ou solde');
                            setIsRepaymentModalOpen(true);
                          }}
                          className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-stone-950 font-bold text-xs shadow-xs transition active:scale-95"
                        >
                          Encaisser Règlement
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Payment history */}
                  {customer.payments && customer.payments.length > 0 && (
                    <div className="pt-2 border-t border-stone-100">
                      <div className="text-[11px] font-bold text-stone-400 uppercase tracking-wider mb-1">
                        Derniers règlements reçus :
                      </div>
                      <div className="space-y-1">
                        {customer.payments.slice(0, 2).map((pay) => (
                          <div key={pay.id} className="text-xs text-stone-600 flex justify-between gap-2 bg-stone-50 px-2.5 py-1 rounded-lg">
                            <span className="min-w-0 break-words">
                              {new Date(pay.date).toLocaleDateString('fr-FR')} • {getPaymentMethodDetails(pay.paymentMethod).label}
                              {pay.note ? ` (${pay.note})` : ''}
                            </span>
                            <span className="font-bold text-emerald-700 font-mono-num whitespace-nowrap shrink-0">
                              +{formatCurrency(pay.amount, settings.currency)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ==================== TAB 2: SUPPLIERS ==================== */}
      {activeTab === 'suppliers' && (
        <div className="space-y-3">
          {filteredSuppliers.length === 0 ? (
            <div className="bg-white rounded-3xl p-8 text-center text-stone-400 border border-stone-200 text-sm">
              Aucun fournisseur grossiste trouvé.
            </div>
          ) : (
            filteredSuppliers.map((supplier) => {
              const hasDebt = supplier.totalDebt > 0;
              const isOverdue = supplier.dueDate && new Date(supplier.dueDate).getTime() < Date.now() && hasDebt;

              return (
                <div 
                  key={supplier.id}
                  className="bg-white rounded-2xl border border-stone-200 p-4 sm:p-5 shadow-xs hover:border-indigo-300 transition space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className={`w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-sm shrink-0 ${
                        hasDebt ? 'bg-indigo-100 text-indigo-900 border border-indigo-200' : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        <Truck className="w-5 h-5 text-indigo-700" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <h4 className="font-extrabold text-base text-stone-900 break-words">{supplier.name}</h4>
                          {isOverdue ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200 animate-pulse">
                              Échéance Dépassée
                            </span>
                          ) : hasDebt ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800">
                              À Payer
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                              Compte Soldé
                            </span>
                          )}
                        </div>

                        <div className="text-xs text-stone-500 mt-0.5">
                          📞 {supplier.phone} {supplier.companyOrMarket ? `• 🏪 ${supplier.companyOrMarket}` : ''}
                        </div>

                        {supplier.dueDate && hasDebt && (
                          <div className="text-[11px] font-semibold text-amber-700 flex items-center gap-1 mt-1">
                            <Calendar className="w-3 h-3" />
                            <span>Échéance de paiement : {new Date(supplier.dueDate).toLocaleDateString('fr-FR')}</span>
                          </div>
                        )}

                        {supplier.notes && (
                          <p className="text-xs text-stone-600 bg-stone-50 p-1.5 rounded-lg mt-1 italic border border-stone-100">
                            {supplier.notes}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="text-left sm:text-right mt-1 sm:mt-0">
                      <span className="text-xs text-stone-500 font-medium">Ce que vous devez au grossiste :</span>
                      <div className={`text-xl sm:text-2xl font-black font-mono-num ${hasDebt ? 'text-indigo-700' : 'text-emerald-700'}`}>
                        {formatCurrency(supplier.totalDebt, settings.currency)}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="pt-2 border-t border-stone-100 flex flex-wrap items-center justify-between gap-2">
                    
                    {/* WhatsApp link to grossiste */}
                    <a
                      href={generateSupplierWhatsAppUrl(supplier)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 font-bold text-xs transition"
                    >
                      <MessageCircle className="w-3.5 h-3.5 text-emerald-700" />
                      <span>WhatsApp Grossiste</span>
                    </a>

                    <div className="flex items-center gap-2">
                      {/* Add credit taken from supplier */}
                      <button
                        onClick={() => {
                          setSelectedSupplier(supplier);
                          setSupCreditAmount(50000);
                          setSupCreditReason('Nouvel arrivage marchandises à crédit');
                          setIsAddSupplierCreditModalOpen(true);
                        }}
                        className="px-3 py-1.5 rounded-xl border border-stone-300 text-stone-700 hover:bg-stone-50 font-bold text-xs transition"
                      >
                        + Arrivage à Crédit
                      </button>

                      {/* Repay supplier */}
                      {hasDebt && (
                        <button
                          onClick={() => {
                            setSelectedSupplier(supplier);
                            setSupRepayAmount(supplier.totalDebt);
                            setSupRepayMethod('wave');
                            setSupRepayNote('Règlement acompte grossiste');
                            setIsSupplierRepaymentModalOpen(true);
                          }}
                          className="px-3.5 py-1.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-bold text-xs shadow-xs transition active:scale-95"
                        >
                          Enregistrer Versement
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Supplier Repayments History */}
                  {supplier.payments && supplier.payments.length > 0 && (
                    <div className="pt-2 border-t border-stone-100">
                      <div className="text-[11px] font-bold text-stone-400 uppercase tracking-wider mb-1">
                        Derniers versements effectués au grossiste :
                      </div>
                      <div className="space-y-1">
                        {supplier.payments.slice(0, 2).map((pay) => (
                          <div key={pay.id} className="text-xs text-stone-600 flex justify-between gap-2 bg-stone-50 px-2.5 py-1 rounded-lg">
                            <span className="min-w-0 break-words">
                              {new Date(pay.date).toLocaleDateString('fr-FR')} • {getPaymentMethodDetails(pay.paymentMethod).label}
                              {pay.note ? ` (${pay.note})` : ''}
                            </span>
                            <span className="font-bold text-indigo-700 font-mono-num">
                              -{formatCurrency(pay.amount, settings.currency)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                </div>
              );
            })
          )}
        </div>
      )}

      {/* ==================== MODALS ==================== */}

      {/* New Customer Modal */}
      {isNewCustomerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-stone-200 p-5 sm:p-6 my-auto animate-in fade-in zoom-in-95 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <h3 className="font-black text-lg text-stone-900">Nouveau Client Débiteur</h3>
              <button onClick={() => setIsNewCustomerModalOpen(false)} className="text-stone-400 p-1">✕</button>
            </div>
            <form onSubmit={handleSaveCustomer} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-stone-700">Nom du client *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Mme Awa Traoré"
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-stone-700">Téléphone / WhatsApp</label>
                <input
                  type="tel"
                  placeholder="+225 07..."
                  value={custPhone}
                  onChange={(e) => setCustPhone(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-stone-700">Dette initiale ({settings.currency})</label>
                <input
                  type="number"
                  value={custInitialDebt || ''}
                  onChange={(e) => setCustInitialDebt(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm font-mono-num font-bold text-amber-600"
                />
              </div>
              <div className="pt-2 flex gap-2">
                <button type="button" onClick={() => setIsNewCustomerModalOpen(false)} className="flex-1 py-2.5 rounded-xl border border-stone-300 text-stone-700 font-bold text-sm">Annuler</button>
                <button type="submit" className="flex-1 py-2.5 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white font-bold text-sm">Créer le Compte</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Customer Repayment Modal */}
      {isRepaymentModalOpen && selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl border border-stone-200 p-5 sm:p-6 my-auto animate-in fade-in zoom-in-95 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-stone-100">
              <div>
                <h3 className="font-black text-base text-stone-900">Encaisser un Remboursement</h3>
                <p className="text-xs text-stone-500">{selectedCustomer.name}</p>
              </div>
              <button onClick={() => setIsRepaymentModalOpen(false)} className="text-stone-400 p-1">✕</button>
            </div>
            <form onSubmit={handleSubmitRepayment} className="space-y-3">
              <div className="p-3 bg-amber-50 rounded-xl text-xs text-amber-900 flex justify-between">
                <span>Dette actuelle :</span>
                <span className="font-black font-mono-num">{formatCurrency(selectedCustomer.totalDebt, settings.currency)}</span>
              </div>
              <div>
                <label className="text-xs font-bold text-stone-700">Montant versé par le client *</label>
                <input
                  type="number"
                  required
                  min="100"
                  max={selectedCustomer.totalDebt}
                  value={repayAmount || ''}
                  onChange={(e) => setRepayAmount(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-300 rounded-xl text-base font-black font-mono-num text-emerald-800"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-stone-700">Mode de versement</label>
                <Select
                  value={repayMethod}
                  onChange={(e) => setRepayMethod(e.target.value as PaymentMethod)}
                  className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-300 rounded-xl text-xs sm:text-sm font-medium"
                >
                  <option value="cash">💵 Espèces (Cash)</option>
                  <option value="wave">🌊 Wave</option>
                  <option value="orange_money">🍊 Orange Money</option>
                  <option value="mtn_momo">💛 MTN MoMo</option>
                  <option value="moov_money">💙 Moov Money</option>
                </Select>
              </div>
              <div className="pt-2 flex gap-2">
                <button type="button" onClick={() => setIsRepaymentModalOpen(false)} className="flex-1 py-2.5 rounded-xl border border-stone-300 text-stone-700 font-bold text-xs">Annuler</button>
                <button type="submit" className="flex-1 py-2.5 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white font-bold text-xs">Valider Encaissement</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Customer Add Credit Modal */}
      {isAddCreditModalOpen && selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl border border-stone-200 p-5 sm:p-6 my-auto animate-in fade-in zoom-in-95 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-stone-100">
              <div>
                <h3 className="font-black text-base text-stone-900">Accorder un Nouveau Crédit</h3>
                <p className="text-xs text-stone-500">{selectedCustomer.name}</p>
              </div>
              <button onClick={() => setIsAddCreditModalOpen(false)} className="text-stone-400 p-1">✕</button>
            </div>
            <form onSubmit={handleSubmitAddCredit} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-stone-700">Montant du crédit ({settings.currency})</label>
                <input
                  type="number"
                  required
                  min="100"
                  value={creditAmount || ''}
                  onChange={(e) => setCreditAmount(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-300 rounded-xl font-mono-num font-bold text-base text-amber-600"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-stone-700">Motif ou articles pris</label>
                <input
                  type="text"
                  placeholder="Ex: 2 sacs de riz, sucre..."
                  value={creditReason}
                  onChange={(e) => setCreditReason(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs"
                />
              </div>
              <div className="pt-2 flex gap-2">
                <button type="button" onClick={() => setIsAddCreditModalOpen(false)} className="flex-1 py-2.5 rounded-xl border border-stone-300 text-stone-700 font-bold text-xs">Annuler</button>
                <button type="submit" className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-stone-950 font-bold text-xs">Ajouter au Compte</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* NEW SUPPLIER MODAL */}
      {isNewSupplierModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-stone-200 p-5 sm:p-6 my-auto animate-in fade-in zoom-in-95 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <div className="flex items-center gap-2">
                <Truck className="w-5 h-5 text-indigo-700" />
                <h3 className="font-black text-lg text-stone-900">Nouveau Fournisseur / Grossiste</h3>
              </div>
              <button onClick={() => setIsNewSupplierModalOpen(false)} className="text-stone-400 p-1">✕</button>
            </div>
            <form onSubmit={handleSaveSupplier} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-stone-700">Nom du grossiste / Entreprise fournisseur *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Ets Bamba & Frères Grossiste, Dangote..."
                  value={supName}
                  onChange={(e) => setSupName(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-stone-700">Téléphone / WhatsApp</label>
                  <input
                    type="tel"
                    placeholder="+225 07..."
                    value={supPhone}
                    onChange={(e) => setSupPhone(e.target.value)}
                    className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-stone-700">Marché / Dépôt</label>
                  <input
                    type="text"
                    placeholder="Ex: Roxy Adjamé, Treichville..."
                    value={supMarket}
                    onChange={(e) => setSupMarket(e.target.value)}
                    className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-stone-700">Montant dû actuel ({settings.currency})</label>
                  <input
                    type="number"
                    value={supInitialDebt || ''}
                    onChange={(e) => setSupInitialDebt(Number(e.target.value))}
                    className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm font-mono-num font-bold text-indigo-700"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-stone-700">Date d'échéance convenue</label>
                  <input
                    type="date"
                    value={supDueDate}
                    onChange={(e) => setSupDueDate(e.target.value)}
                    className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs sm:text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-stone-700">Notes / Conditions d'approvisionnement</label>
                <input
                  type="text"
                  placeholder="Ex: Livraison sacs de riz, paiement quinzaine"
                  value={supNotes}
                  onChange={(e) => setSupNotes(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button type="button" onClick={() => setIsNewSupplierModalOpen(false)} className="flex-1 py-2.5 rounded-xl border border-stone-300 text-stone-700 font-bold text-sm">Annuler</button>
                <button type="submit" className="flex-1 py-2.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-bold text-sm">Enregistrer Grossiste</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SUPPLIER REPAYMENT MODAL */}
      {isSupplierRepaymentModalOpen && selectedSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl border border-stone-200 p-5 sm:p-6 my-auto animate-in fade-in zoom-in-95 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-stone-100">
              <div>
                <h3 className="font-black text-base text-stone-900">Règlement au Grossiste</h3>
                <p className="text-xs text-stone-500">{selectedSupplier.name}</p>
              </div>
              <button onClick={() => setIsSupplierRepaymentModalOpen(false)} className="text-stone-400 p-1">✕</button>
            </div>
            <form onSubmit={handleSubmitSupplierRepayment} className="space-y-3">
              <div className="p-3 bg-indigo-50 rounded-xl text-xs text-indigo-900 flex justify-between">
                <span>Dette actuelle :</span>
                <span className="font-black font-mono-num">{formatCurrency(selectedSupplier.totalDebt, settings.currency)}</span>
              </div>
              <div>
                <label className="text-xs font-bold text-stone-700">Montant versé au fournisseur *</label>
                <input
                  type="number"
                  required
                  min="100"
                  max={selectedSupplier.totalDebt}
                  value={supRepayAmount || ''}
                  onChange={(e) => setSupRepayAmount(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-300 rounded-xl text-base font-black font-mono-num text-indigo-800"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-stone-700">Mode de paiement utilisé</label>
                <Select
                  value={supRepayMethod}
                  onChange={(e) => setSupRepayMethod(e.target.value as PaymentMethod)}
                  className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-300 rounded-xl text-xs sm:text-sm font-medium"
                >
                  <option value="wave">🌊 Wave Pro</option>
                  <option value="orange_money">🍊 Orange Money</option>
                  <option value="mtn_momo">💛 MTN MoMo</option>
                  <option value="cash">💵 Espèces (Remis en main propre)</option>
                  <option value="bank_transfer">🏦 Virement Bancaire</option>
                </Select>
              </div>
              <div>
                <label className="text-xs font-bold text-stone-700">Note ou référence de reçu</label>
                <input
                  type="text"
                  placeholder="Ex: Acompte livraison du 12..."
                  value={supRepayNote}
                  onChange={(e) => setSupRepayNote(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs"
                />
              </div>
              <div className="pt-2 flex gap-2">
                <button type="button" onClick={() => setIsSupplierRepaymentModalOpen(false)} className="flex-1 py-2.5 rounded-xl border border-stone-300 text-stone-700 font-bold text-xs">Annuler</button>
                <button type="submit" className="flex-1 py-2.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-bold text-xs">Confirmer Versement</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SUPPLIER ADD CREDIT / ARRIVAGE MODAL */}
      {isAddSupplierCreditModalOpen && selectedSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl border border-stone-200 p-5 sm:p-6 my-auto animate-in fade-in zoom-in-95 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-stone-100">
              <div>
                <h3 className="font-black text-base text-stone-900">Nouvel Arrivage à Crédit</h3>
                <p className="text-xs text-stone-500">{selectedSupplier.name}</p>
              </div>
              <button onClick={() => setIsAddSupplierCreditModalOpen(false)} className="text-stone-400 p-1">✕</button>
            </div>
            <form onSubmit={handleSubmitAddSupplierCredit} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-stone-700">Valeur marchande reçue à crédit ({settings.currency})</label>
                <input
                  type="number"
                  required
                  min="100"
                  value={supCreditAmount || ''}
                  onChange={(e) => setSupCreditAmount(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-300 rounded-xl font-mono-num font-bold text-base text-indigo-700"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-stone-700">Détail des marchandises livrées</label>
                <input
                  type="text"
                  placeholder="Ex: 50 sacs de riz, 20 cartons d'huile..."
                  value={supCreditReason}
                  onChange={(e) => setSupCreditReason(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs sm:text-sm"
                />
              </div>
              <div className="pt-2 flex gap-2">
                <button type="button" onClick={() => setIsAddSupplierCreditModalOpen(false)} className="flex-1 py-2.5 rounded-xl border border-stone-300 text-stone-700 font-bold text-xs">Annuler</button>
                <button type="submit" className="flex-1 py-2.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-bold text-xs">Ajouter à la Dette</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isPurchaseOpen && onAddExpense && onUpdateProducts && (
        <PurchaseModal
          settings={settings} products={products} onUpdateProducts={onUpdateProducts} suppliers={suppliers}
          onUpdateSuppliers={onUpdateSuppliers} onAddExpense={onAddExpense}
          onClose={() => setIsPurchaseOpen(false)}
        />
      )}
    </div>
  );
};
