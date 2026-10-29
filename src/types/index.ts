export type CurrencyCode = 'XOF' | 'GNF' | 'USD' | 'EUR';

export type PaymentMethod = 
  | 'cash' 
  | 'wave' 
  | 'orange_money' 
  | 'mtn_momo' 
  | 'moov_money' 
  | 'bank_transfer' 
  | 'credit';

export type ExpenseCategory = 
  | 'supply'           // Achat de marchandises
  | 'rent'             // Loyer boutique / entrepôt
  | 'transport'        // Transport / Livraison / Moto-taxi / Carburant
  | 'utilities'        // Électricité CIE/Senelec, Eau, Internet, Crédit appel
  | 'salary'           // Salaire / Main d'œuvre / Manutention
  | 'taxes'            // Taxes municipales, Patente, Impôts
  | 'personal_draw'    // Prélèvement personnel (Séparation pro/perso)
  | 'maintenance'      // Réparations / Imprévus
  | 'other';           // Autre dépense

export interface Product {
  id: string;
  name: string;
  category: string;
  barcode?: string;
  purchasePrice: number;   // Prix d'achat unitaire (coût de revient)
  sellingPrice: number;    // Prix de vente unitaire
  stockQuantity: number;   // Quantité disponible
  minAlertThreshold: number; // Seuil d'alerte rupture
  unit: string;            // 'pièce', 'kg', 'carton', 'paquet', 'litre', 'mètre'
  lastRestockedDate?: string;
}

export interface SaleItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  costPrice: number;
}

export interface Sale {
  id: string;
  date: string;            // ISO String
  items: SaleItem[];
  subtotal: number;
  discount: number;
  total: number;
  totalCost: number;       // Coût d'achat total pour calcul marge
  profit: number;          // Marge brute = total - totalCost
  paymentMethod: PaymentMethod;
  amountPaid: number;      // Pour calcul monnaie
  changeGiven: number;     // Monnaie rendue
  customerId?: string;
  customerName?: string;
  isCredit: boolean;
  creditDueDate?: string;
  status: 'completed' | 'cancelled' | 'pending_payment';
  invoiceNumber: string;
}

export interface Expense {
  id: string;
  date: string;
  title: string;
  amount: number;
  category: ExpenseCategory;
  paymentMethod: PaymentMethod;
  notes?: string;
  isRecurring?: boolean;
  supplierId?: string;      // achat chez un fournisseur
  paidAmount?: number;      // montant payé tout de suite (le reste = dette fournisseur)
}

export interface DebtPayment {
  id: string;
  date: string;
  amount: number;
  paymentMethod: PaymentMethod;
  note?: string;
}

export interface SupplierPayment {
  id: string;
  date: string;
  amount: number;
  paymentMethod: PaymentMethod;
  note?: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  companyOrMarket?: string; // ex: Grossiste Adjamé Roxy, Dépôt Central
  address?: string;
  totalDebt: number;        // Montant que le commerçant doit au fournisseur
  dueDate?: string;         // Échéance de paiement convenue
  notes?: string;
  createdAt: string;
  payments: SupplierPayment[];
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address?: string;
  totalDebt: number;       // Solde restant dû par le client
  creditLimit: number;     // Plafond de crédit accordé
  notes?: string;
  createdAt: string;
  payments: DebtPayment[];
  lastReminderSentDate?: string;
}

export interface CreditScoreFactor {
  id: string;
  name: string;
  score: number;       // Points obtenus
  maxScore: number;    // Points maximum
  weight: number;      // Pourcentage
  status: 'excellent' | 'good' | 'average' | 'poor';
  feedback: string;    // Commentaire explicatif pour le commerçant
  recommendation: string; // Action concrète pour améliorer le score
}

export interface CreditScoreResult {
  totalScore: number;  // 0 à 1000
  rating: 'A+' | 'A' | 'B' | 'C' | 'D';
  label: string;
  color: string;
  riskAssessment: string;
  maxRecommendedLoan: number; // Montant max recommandé en FCFA
  maxMonthlyPayment: number;  // Mensualité soutenable max
  factors: CreditScoreFactor[];
  eligibilityVerdict: 'HIGHLY_ELIGIBLE' | 'ELIGIBLE_WITH_CONDITIONS' | 'NEED_MORE_HISTORY' | 'HIGH_RISK';
}

export type UserRole = 'admin' | 'merchant';

export interface UserAccount {
  id: string;
  email: string;
  name: string;
  phone: string;
  role: UserRole;
  shopRole?: 'owner' | 'manager' | 'cashier';
  shopId: string;
  createdAt: string;
  lastLoginAt: string;
  status: 'active' | 'suspended';
  avatar?: string;
}

export type BusinessCategoryType = 
  | 'retail_food'       // Commerce Général, Épicerie, Alimentation
  | 'fashion_tailor'    // Couture, Mode, Prêt-à-porter, Tissus
  | 'hardware_craft'    // Quincaillerie, Matériaux, Menuiserie, Artisanat
  | 'restaurant_maquis' // Restaurant, Fast-food, Maquis, Débit de boisson
  | 'beauty_salon'      // Salon de coiffure, Esthétique, Vente de mèches
  | 'garage_mechanic'   // Garage, Mécanique, Pièces détachées
  | 'services_cyber'    // Services, Bureautique, Cyber, Transferts Mobile Money
  | 'health_pharma'     // Dépôt pharmaceutique, Cosmétique médicale
  | 'other';            // Autre activité

export interface BusinessActivityPreset {
  id: BusinessCategoryType;
  title: string;
  icon: string;
  tagline: string;
  terminology: {
    itemLabel: string;        // "Article" vs "Prestation" vs "Plat"
    itemPlural: string;       // "Articles" vs "Prestations" vs "Plats"
    catalogTitle: string;     // "Rayons & Produits" vs "Carte du Maquis"
  };
  defaultUnits: string[];
  suggestedCategories: string[];
  isServiceOriented: boolean;
}

export interface ShopSettings {
  shopId: string;
  shopName: string;
  ownerName: string;
  country: string;       // Côte d'Ivoire, Sénégal, etc.
  city: string;
  phone: string;
  currency: CurrencyCode;
  rccmNumber?: string;   // Numéro RCCM si formalisé
  taxId?: string;        // Numéro CC / NINEA / IFU
  isFormalized: boolean; // Si inscrit au registre du commerce
  businessType: string;  // Alimentation, Quincaillerie, Mode, etc.
  businessCategory: BusinessCategoryType;
  foundedYear: number;
  logo?: string;         // Logo de la boutique (data URL, redimensionné)
  openingCash?: number;   // Trésorerie de départ : espèces en caisse
  openingMobile?: number; // … sur les comptes Mobile Money
  openingBank?: number;   // … en banque
}

