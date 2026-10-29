import { newId } from '../../../shared/syncCore';
import React, { useState, useMemo, useEffect } from 'react';
import { Product, SaleItem, Sale, PaymentMethod, Customer, ShopSettings } from '../../types';
import { formatCurrency, getPaymentMethodDetails } from '../../services/financials';
import { ReceiptModal } from './ReceiptModal';
import { VoiceSaleModal } from './VoiceSaleModal';
import { 
  Search, 
  Plus, 
  Minus, 
  Trash2, 
  CreditCard, 
  Banknote, 
  Smartphone, 
  BookUser, 
  ArrowRight, 
  Check, 
  Package, 
  UserPlus,
  Coins,
  Mic
} from 'lucide-react';
import { Select } from '../common/dialogs';
import { uiAlert } from '../common/dialogs';

interface POSViewProps {
  products: Product[];
  customers: Customer[];
  settings: ShopSettings;
  onRecordSale: (sale: Sale, updatedProducts: Product[], updatedCustomers: Customer[]) => void;
}

export const POSView: React.FC<POSViewProps> = ({
  products,
  customers,
  settings,
  onRecordSale,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [cart, setCart] = useState<SaleItem[]>([]);

  // Message de stock (rupture / stock restant), affiché quelques secondes
  const [stockNotice, setStockNotice] = useState<string>('');
  useEffect(() => {
    if (!stockNotice) return;
    const t = setTimeout(() => setStockNotice(''), 4000);
    return () => clearTimeout(t);
  }, [stockNotice]);
  const qtyInCart = (productId: string) => cart.find(i => i.productId === productId)?.quantity ?? 0;
  const unitLabel = (p: Product, n: number) => {
    const u = p.unit || 'pièce';
    return `${n} ${n > 1 && ['pièce', 'carton', 'paquet', 'sac', 'litre', 'mètre', 'bouteille'].includes(u) ? u + 's' : u}`;
  };
  /** Peut-on ajouter `add` unités de ce produit au panier ? Sinon, explique pourquoi. */
  const checkStock = (p: Product, add: number): boolean => {
    if (p.stockQuantity <= 0) { setStockNotice(`⛔ « ${p.name} » est en rupture de stock.`); return false; }
    if (qtyInCart(p.id) + add > p.stockQuantity) {
      const left = p.stockQuantity;
      setStockNotice(`⚠️ Stock insuffisant pour « ${p.name} » : il n'en reste que ${unitLabel(p, left)}${qtyInCart(p.id) > 0 ? ' (déjà tout dans le panier)' : ''}.`);
      return false;
    }
    return true;
  };
  
  // Checkout flow state
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [amountPaid, setAmountPaid] = useState<number>(0);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [newCustomerName, setNewCustomerName] = useState<string>('');
  const [newCustomerPhone, setNewCustomerPhone] = useState<string>('');
  const [creditDueDate, setCreditDueDate] = useState<string>('');
  
  // Post-sale receipt state
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);

  // Categories list
  const categories = useMemo(() => {
    const set = new Set(products.map(p => p.category));
    return ['all', ...Array.from(set)];
  }, [products]);

  // Filtered products
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.barcode && p.barcode.includes(searchQuery));
      const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [products, searchQuery, selectedCategory]);

  // Cart calculations
  const cartSubtotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.totalPrice, 0);
  }, [cart]);

  const cartTotalCost = useMemo(() => {
    return cart.reduce((sum, item) => sum + (item.costPrice * item.quantity), 0);
  }, [cart]);

  const cartTotalItemsCount = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  }, [cart]);

  // Add to cart
  const addToCart = (product: Product) => {
    if (!checkStock(product, 1)) return;
    setCart(prev => {
      const existing = prev.find(item => item.productId === product.id);
      if (existing) {
        return prev.map(item => 
          item.productId === product.id 
            ? { ...item, quantity: item.quantity + 1, totalPrice: (item.quantity + 1) * item.unitPrice }
            : item
        );
      } else {
        return [...prev, {
          productId: product.id,
          productName: product.name,
          quantity: 1,
          unitPrice: product.sellingPrice,
          totalPrice: product.sellingPrice,
          costPrice: product.purchasePrice,
        }];
      }
    });
  };

  // Ajout depuis la dictée vocale
  const applyVoice = (rawLines: { product: Product; qty: number }[], payment: string | null, customerId: string | null) => {
    // On ne dépasse jamais le stock disponible (stock − déjà dans le panier)
    const notes: string[] = [];
    const lines = rawLines.map(({ product, qty }) => {
      const free = Math.max(0, product.stockQuantity - qtyInCart(product.id));
      if (qty > free) notes.push(free <= 0 ? `« ${product.name} » : rupture` : `« ${product.name} » : seulement ${unitLabel(product, free)} disponible(s)`);
      return { product, qty: Math.min(qty, free) };
    }).filter(l => l.qty > 0);
    if (notes.length) setStockNotice(`⚠️ Stock limité — ${notes.join(' ; ')}.`);
    setCart(prev => {
      let next = [...prev];
      for (const { product, qty } of lines) {
        const ex = next.find(i => i.productId === product.id);
        if (ex) next = next.map(i => i.productId === product.id ? { ...i, quantity: i.quantity + qty, totalPrice: (i.quantity + qty) * i.unitPrice } : i);
        else next.push({ productId: product.id, productName: product.name, quantity: qty, unitPrice: product.sellingPrice, totalPrice: qty * product.sellingPrice, costPrice: product.purchasePrice });
      }
      return next;
    });
    if (payment === 'credit' || payment === 'cash') setPaymentMethod(payment);
    if (customerId) setSelectedCustomerId(customerId);
  };

  // Modify quantity
  const updateQuantity = (productId: string, delta: number) => {
    if (delta > 0) {
      const prod = products.find(x => x.id === productId);
      if (prod && !checkStock(prod, delta)) return;
    }
    setCart(prev => {
      return prev.map(item => {
        if (item.productId === productId) {
          const newQty = item.quantity + delta;
          if (newQty <= 0) return null;
          return {
            ...item,
            quantity: newQty,
            totalPrice: newQty * item.unitPrice,
          };
        }
        return item;
      }).filter(Boolean) as SaleItem[];
    });
  };

  // Open checkout modal
  const handleOpenCheckout = () => {
    if (cart.length === 0) return;
    setAmountPaid(cartSubtotal);
    setIsCheckoutOpen(true);
  };

  // Preset cash quick buttons
  const cashSuggestions = useMemo(() => {
    const base = cartSubtotal;
    const suggestions: number[] = [base];
    const steps = [500, 1000, 2000, 5000, 10000, 20000];
    for (const step of steps) {
      if (step > base && !suggestions.includes(step)) {
        suggestions.push(step);
      }
      const roundedUp = Math.ceil(base / step) * step;
      if (roundedUp > base && !suggestions.includes(roundedUp)) {
        suggestions.push(roundedUp);
      }
    }
    return suggestions.sort((a, b) => a - b).slice(0, 5);
  }, [cartSubtotal]);

  // Submit sale
  const handleFinalizeSale = () => {
    if (cart.length === 0) return;
    for (const it of cart) {
      const prod = products.find(x => x.id === it.productId);
      if (prod && it.quantity > prod.stockQuantity) {
        uiAlert(prod.stockQuantity <= 0
          ? `« ${prod.name} » est maintenant en rupture de stock. Retirez-le du panier.`
          : `Stock insuffisant pour « ${prod.name} » : il n'en reste que ${unitLabel(prod, prod.stockQuantity)}. Réduisez la quantité.`);
        return;
      }
    }
    // Une vente à crédit doit être rattachée à un client, sinon la dette serait perdue.
    if (paymentMethod === 'credit' && !selectedCustomerId && !newCustomerName.trim()) {
      uiAlert('Vente à crédit : choisissez un client ou saisissez son nom pour enregistrer la dette.');
      return;
    }
    // Espèces : le montant reçu doit couvrir la vente (sinon, passer en « À crédit »).
    if (paymentMethod === 'cash' && amountPaid < cartSubtotal) {
      uiAlert('Le montant reçu est inférieur au total. Corrigez-le, ou choisissez « À crédit » pour noter le reste en dette.');
      return;
    }

    let customerName = '';
    let customerId = selectedCustomerId;
    let updatedCustomers = [...customers];

    // If credit or customer selected
    if (paymentMethod === 'credit' || selectedCustomerId || newCustomerName.trim()) {
      if (selectedCustomerId) {
        const found = customers.find(c => c.id === selectedCustomerId);
        if (found) customerName = found.name;
      } else if (newCustomerName.trim()) {
        const newCust: Customer = {
          id: newId('cust'),
          name: newCustomerName.trim(),
          phone: newCustomerPhone.trim() || 'Non spécifié',
          totalDebt: 0,
          creditLimit: 50000,
          createdAt: new Date().toISOString(),
          payments: []
        };
        updatedCustomers.push(newCust);
        customerId = newCust.id;
        customerName = newCust.name;
      }

      // If credit sale, increment customer's debt
      if (paymentMethod === 'credit' && customerId) {
        updatedCustomers = updatedCustomers.map(c => 
          c.id === customerId ? { ...c, totalDebt: c.totalDebt + cartSubtotal } : c
        );
      }
    }

    // Deduct stock from products
    const updatedProducts = products.map(p => {
      const cartItem = cart.find(ci => ci.productId === p.id);
      if (cartItem) {
        return {
          ...p,
          stockQuantity: Math.max(0, p.stockQuantity - cartItem.quantity)
        };
      }
      return p;
    });

    const isCredit = paymentMethod === 'credit';
    // Mobile Money / banque : le client paie exactement le total ; seul le cash donne lieu à de la monnaie.
    const finalAmountPaid = isCredit ? 0 : paymentMethod === 'cash' ? amountPaid : cartSubtotal;
    const changeGiven = paymentMethod === 'cash' ? Math.max(0, amountPaid - cartSubtotal) : 0;

    const invoiceNumber = `FAC-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    const newSale: Sale = {
      id: newId('sale'),
      date: new Date().toISOString(),
      items: [...cart],
      subtotal: cartSubtotal,
      discount: 0,
      total: cartSubtotal,
      totalCost: cartTotalCost,
      profit: cartSubtotal - cartTotalCost,
      paymentMethod,
      amountPaid: finalAmountPaid,
      changeGiven,
      customerId: customerId || undefined,
      customerName: customerName || undefined,
      isCredit,
      creditDueDate: isCredit && creditDueDate ? new Date(creditDueDate).toISOString() : undefined,
      status: 'completed',
      invoiceNumber
    };

    onRecordSale(newSale, updatedProducts, updatedCustomers);
    setIsCheckoutOpen(false);
    setCompletedSale(newSale);
    setCart([]);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 pb-20">
      {stockNotice && (
        <div role="alert" onClick={() => setStockNotice('')} data-testid="stock-notice"
          className="fixed top-20 left-3 right-3 z-[60] mx-auto max-w-md rounded-2xl bg-rose-700 text-white text-sm font-bold px-4 py-3 shadow-xl cursor-pointer">
          {stockNotice}
        </div>
      )}
      
      {/* Left side: Product Catalog (8 cols on desktop) */}
      <div className="lg:col-span-7 xl:col-span-8 space-y-4">
        
        {/* Search & Category Filter */}
        <div className="bg-white rounded-2xl p-3 sm:p-4 border border-stone-200 shadow-xs space-y-3">
          <div className="flex gap-2 items-center">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              type="text"
              placeholder="Rechercher un article (riz, huile, savon, boisson...)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
            />
          </div>
          <button onClick={() => setVoiceOpen(true)} data-testid="voice-open"
            className="shrink-0 flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold">
            <Mic className="w-4 h-4" /><span>Dicter</span>
          </button>
          </div>

          {/* Category Chips Horizontal Scroll */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition capitalize ${
                  selectedCategory === cat
                    ? 'bg-emerald-800 text-white shadow-xs'
                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}
              >
                {cat === 'all' ? 'Tous les rayons' : cat}
              </button>
            ))}
          </div>
        </div>

        {/* Product Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-3">
          {filteredProducts.map(product => {
            const inCart = cart.find(ci => ci.productId === product.id);
            const isOutOfStock = product.stockQuantity <= 0;
            const isLowStock = product.stockQuantity > 0 && product.stockQuantity <= product.minAlertThreshold;

            return (
              <div
                key={product.id}
                onClick={() => (isOutOfStock ? setStockNotice(`⛔ « ${product.name} » est en rupture de stock.`) : addToCart(product))}
                className={`relative flex flex-col justify-between p-3 rounded-2xl border transition active:scale-97 select-none cursor-pointer ${
                  isOutOfStock 
                    ? 'bg-stone-100 border-stone-200 opacity-60 cursor-not-allowed'
                    : inCart
                      ? 'bg-emerald-50/70 border-emerald-300 ring-2 ring-emerald-600/30'
                      : 'bg-white border-stone-200 hover:border-emerald-200 shadow-xs'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-stone-600 bg-stone-100 px-1.5 py-0.5 rounded-md">
                      {product.category}
                    </span>
                    {isLowStock && (
                      <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-md">
                        Reste {product.stockQuantity}
                      </span>
                    )}
                    {isOutOfStock && (
                      <span className="text-[10px] font-bold text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded-md">
                        Rupture
                      </span>
                    )}
                  </div>

                  <h4 className="font-bold text-xs sm:text-sm text-stone-900 mt-2 line-clamp-2 leading-snug">
                    {product.name}
                  </h4>
                </div>

                <div className="mt-3 pt-2 border-t border-stone-100 flex items-end justify-between">
                  <div>
                    <div className="text-xs text-stone-500 font-medium">Prix unitaire</div>
                    <div className="font-black text-stone-950 text-sm font-mono-num">
                      {formatCurrency(product.sellingPrice, settings.currency)}
                    </div>
                  </div>

                  {inCart ? (
                    <div className="w-7 h-7 rounded-xl bg-emerald-800 text-white font-bold text-xs flex items-center justify-center shadow-xs">
                      {inCart.quantity}
                    </div>
                  ) : (
                    <div className="w-7 h-7 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center hover:bg-emerald-200 transition">
                      <Plus className="w-4 h-4" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

      </div>

      {/* Right side: Shopping Cart & Instant Pay (4 cols desktop, bottom tray on mobile) */}
      <div className="lg:col-span-5 xl:col-span-4">
        <div className="sticky top-20 bg-white rounded-3xl border border-stone-200 shadow-md p-4 sm:p-5 flex flex-col h-[calc(100vh-110px)] max-h-[640px]">
          
          {/* Cart Header */}
          <div className="flex items-center justify-between pb-3 border-b border-stone-100">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
                {cartTotalItemsCount}
              </div>
              <h3 className="font-extrabold text-stone-900 text-base">Panier Caisse</h3>
            </div>
            {cart.length > 0 && (
              <button
                onClick={() => setCart([])}
                className="text-xs text-rose-600 font-bold hover:underline flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" /> Vider
              </button>
            )}
          </div>

          {/* Cart Items Scroll Area */}
          <div className="flex-1 overflow-y-auto py-3 space-y-2.5">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-stone-400">
                <Package className="w-12 h-12 text-stone-300 mb-2 stroke-1" />
                <p className="text-sm font-semibold text-stone-600">Le panier est vide</p>
                <p className="text-xs text-stone-400 mt-1 max-w-[200px]">
                  Touchez un article sur la gauche pour l'ajouter à la vente.
                </p>
              </div>
            ) : (
              cart.map((item) => (
                <div 
                  key={item.productId}
                  className="flex items-center justify-between p-2.5 bg-stone-50 rounded-2xl border border-stone-100 text-sm"
                >
                  <div className="min-w-0 pr-2">
                    <h5 className="font-bold text-stone-900 truncate text-xs sm:text-sm">
                      {item.productName}
                    </h5>
                    <div className="text-xs text-stone-500 font-mono-num">
                      {formatCurrency(item.unitPrice, settings.currency)} × {item.quantity}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center gap-1 bg-white border border-stone-200 rounded-xl p-0.5 shadow-2xs">
                      <button
                        onClick={() => updateQuantity(item.productId, -1)}
                        className="w-6 h-6 rounded-lg hover:bg-stone-100 text-stone-600 flex items-center justify-center font-bold transition"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-6 text-center font-black text-xs font-mono-num">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQuantity(item.productId, 1)}
                        aria-label="Ajouter une unité"
                        className={`w-6 h-6 rounded-lg hover:bg-stone-100 text-stone-600 flex items-center justify-center font-bold transition ${item.quantity >= (products.find(x => x.id === item.productId)?.stockQuantity ?? Infinity) ? 'opacity-30' : ''}`}
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>

                    <div className="text-right min-w-[65px]">
                      <span className="font-extrabold text-stone-900 text-xs sm:text-sm font-mono-num">
                        {formatCurrency(item.totalPrice, settings.currency)}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Cart Bottom Summary & Checkout Button */}
          <div className="pt-3 border-t border-stone-200 space-y-3">
            <div className="flex justify-between items-baseline">
              <span className="text-xs uppercase font-extrabold text-stone-500 tracking-wider">Total à encaisser :</span>
              <span className="text-2xl font-black text-stone-950 font-mono-num">
                {formatCurrency(cartSubtotal, settings.currency)}
              </span>
            </div>

            <button
              disabled={cart.length === 0}
              onClick={handleOpenCheckout}
              className={`w-full py-3.5 rounded-2xl font-black text-base shadow-md transition flex items-center justify-center gap-2 active:scale-98 ${
                cart.length === 0
                  ? 'bg-stone-200 text-stone-400 cursor-not-allowed shadow-none'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-700/25'
              }`}
            >
              <span>Encaisser Vente</span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>

        </div>
      </div>

      {/* Mobile Floating Sticky Quick Checkout Pill (shows when cart has items) */}
      {cart.length > 0 && !isCheckoutOpen && (
        <div className="lg:hidden fixed bottom-16 left-3 right-3 z-30 animate-in slide-in-from-bottom-4">
          <button
            onClick={handleOpenCheckout}
            className="w-full bg-emerald-700 hover:bg-emerald-800 text-white p-3.5 rounded-2xl shadow-xl shadow-emerald-950/30 flex items-center justify-between font-extrabold active:scale-98 transition border border-emerald-600/50 backdrop-blur-md"
          >
            <div className="flex items-center gap-2.5">
              <span className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center text-xs font-black">
                {cartTotalItemsCount}
              </span>
              <span className="text-xs sm:text-sm font-semibold">Panier</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm sm:text-base font-black font-mono-num">
                {formatCurrency(cartSubtotal, settings.currency)}
              </span>
              <div className="bg-amber-400 text-emerald-950 px-3 py-1 rounded-xl text-xs font-black flex items-center gap-1 shadow-xs">
                <span>Encaisser</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </div>
            </div>
          </button>
        </div>
      )}

      {/* Checkout / Payment Modal */}
      {isCheckoutOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-stone-200 p-5 sm:p-6 my-auto animate-in fade-in zoom-in-95 space-y-5">
            
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <div>
                <h3 className="font-black text-lg text-stone-900">Finaliser l'Encaissement</h3>
                <p className="text-xs text-stone-500">{cartTotalItemsCount} article(s) • Total : {formatCurrency(cartSubtotal, settings.currency)}</p>
              </div>
              <button
                onClick={() => setIsCheckoutOpen(false)}
                className="text-stone-400 hover:text-stone-700 p-1.5 rounded-xl hover:bg-stone-100"
              >
                ✕
              </button>
            </div>

            {/* Payment Method Selector */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-stone-600">
                Mode de règlement
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { id: 'cash', label: '💵 Espèces', color: 'hover:border-emerald-500' },
                  { id: 'wave', label: '🌊 Wave', color: 'hover:border-sky-500' },
                  { id: 'orange_money', label: '🍊 Orange Money', color: 'hover:border-orange-500' },
                  { id: 'mtn_momo', label: '💛 MTN MoMo', color: 'hover:border-yellow-500' },
                  { id: 'moov_money', label: '💙 Moov Money', color: 'hover:border-blue-500' },
                  { id: 'credit', label: '📒 À Crédit (Dette)', color: 'hover:border-red-500' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setPaymentMethod(item.id as PaymentMethod);
                      if (item.id === 'cash') setAmountPaid(cartSubtotal);
                    }}
                    className={`p-2.5 rounded-xl border text-xs font-bold text-left transition ${
                      paymentMethod === item.id
                        ? 'border-emerald-700 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-700/20'
                        : 'border-stone-200 bg-stone-50 text-stone-700'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Cash: Quick change calculator */}
            {paymentMethod === 'cash' && (
              <div className="p-4 bg-stone-50 rounded-2xl border border-stone-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-stone-600">Montant reçu du client :</span>
                  <div className="relative w-36">
                    <input
                      type="number"
                      value={amountPaid || ''}
                      onChange={(e) => setAmountPaid(Number(e.target.value))}
                      className="w-full px-3 py-1.5 bg-white border border-stone-300 rounded-xl text-right font-black font-mono-num text-base text-stone-900 focus:ring-2 focus:ring-emerald-700"
                    />
                  </div>
                </div>

                {/* Preset quick buttons */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                  <span className="text-stone-400 text-[11px] shrink-0">Billets :</span>
                  {cashSuggestions.map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setAmountPaid(val)}
                      className={`px-2.5 py-1 rounded-lg border font-mono-num font-bold transition shrink-0 ${
                        amountPaid === val
                          ? 'bg-emerald-800 text-white border-emerald-800'
                          : 'bg-white text-stone-700 border-stone-300 hover:bg-stone-100'
                      }`}
                    >
                      {val.toLocaleString('fr-FR')} F
                    </button>
                  ))}
                </div>

                {/* Change to return */}
                <div className="pt-2 border-t border-stone-200 flex justify-between items-center text-sm">
                  <span className="font-semibold text-stone-600">Monnaie à rendre :</span>
                  <span className={`text-base font-black font-mono-num ${amountPaid >= cartSubtotal ? 'text-emerald-700' : 'text-rose-600'}`}>
                    {amountPaid >= cartSubtotal 
                      ? formatCurrency(amountPaid - cartSubtotal, settings.currency)
                      : `Manque ${formatCurrency(cartSubtotal - amountPaid, settings.currency)}`}
                  </span>
                </div>
              </div>
            )}

            {/* Credit Sale: Customer Selection or Fast Creation */}
            {paymentMethod === 'credit' && (
              <div className="p-4 bg-red-50/70 rounded-2xl border border-red-200 space-y-3">
                <div className="flex items-center gap-2 text-red-900 font-bold text-xs">
                  <BookUser className="w-4 h-4 text-red-700" />
                  <span>Enregistrement au Carnet de Créances</span>
                </div>

                {/* Select Existing Customer */}
                <div className="space-y-1">
                  <label className="text-xs text-stone-600 font-semibold">Choisir un client habituel :</label>
                  <Select
                    value={selectedCustomerId}
                    onChange={(e) => {
                      setSelectedCustomerId(e.target.value);
                      if (e.target.value) setNewCustomerName('');
                    }}
                    className="w-full px-3 py-2 bg-white border border-stone-300 rounded-xl text-xs sm:text-sm text-stone-900 font-medium"
                  >
                    <option value="">-- Nouveau client / Saisie manuelle --</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.phone}) - Dette actuelle : {formatCurrency(c.totalDebt, settings.currency)}
                      </option>
                    ))}
                  </Select>
                </div>

                {/* Or new customer entry */}
                {!selectedCustomerId && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Nom complet du client"
                      value={newCustomerName}
                      onChange={(e) => setNewCustomerName(e.target.value)}
                      className="px-3 py-2 bg-white border border-stone-300 rounded-xl text-xs sm:text-sm"
                    />
                    <input
                      type="tel"
                      placeholder="N° Téléphone (ex: +225 07...)"
                      value={newCustomerPhone}
                      onChange={(e) => setNewCustomerPhone(e.target.value)}
                      className="px-3 py-2 bg-white border border-stone-300 rounded-xl text-xs sm:text-sm"
                    />
                  </div>
                )}

                {/* Due Date */}
                <div className="space-y-1">
                  <label className="text-xs text-stone-600 font-semibold">Date convenue de remboursement :</label>
                  <input
                    type="date"
                    value={creditDueDate}
                    onChange={(e) => setCreditDueDate(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-stone-300 rounded-xl text-xs sm:text-sm"
                  />
                </div>
              </div>
            )}

            {/* Validation Buttons */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsCheckoutOpen(false)}
                className="flex-1 py-3 rounded-xl border border-stone-300 text-stone-700 font-bold text-sm hover:bg-stone-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleFinalizeSale}
                className="flex-2 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black text-sm shadow-md shadow-emerald-800/25 flex items-center justify-center gap-2 active:scale-95"
              >
                <Check className="w-5 h-5" />
                <span>Valider et Imprimer Ticket</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Post-Sale Receipt Modal */}
      {completedSale && (
        <ReceiptModal
          sale={completedSale}
          settings={settings}
          onClose={() => setCompletedSale(null)}
          onNewSale={() => setCompletedSale(null)}
          customerPhone={customers.find(c => c.id === completedSale.customerId)?.phone}
        />
      )}

      {voiceOpen && <VoiceSaleModal products={products} customers={customers} onClose={() => setVoiceOpen(false)} onApply={applyVoice} />}
    </div>
  );
};
