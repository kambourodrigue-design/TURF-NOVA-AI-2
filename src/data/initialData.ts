import { Product, Sale, Expense, Customer, Supplier, ShopSettings } from '../types';

export const initialShopSettings: ShopSettings = {
  shopId: "shop-1",
  shopName: "Boutique La Grâce & Progrès",
  ownerName: "Mamadou Konaté",
  country: "Côte d'Ivoire",
  city: "Abidjan (Cocody Angré)",
  phone: "+225 07 48 92 10 33",
  currency: "XOF",
  isFormalized: false, // Démarre informel pour illustrer le parcours vers la formalisation
  businessType: "Commerce Général & Alimentation",
  businessCategory: "retail_food",
  foundedYear: 2023,
};

export const initialProducts: Product[] = [
  {
    id: "prod-1",
    name: "Riz Parfumé Jasmin 5kg",
    category: "Alimentation",
    purchasePrice: 3800,
    sellingPrice: 4700,
    stockQuantity: 18,
    minAlertThreshold: 5,
    unit: "sac",
  },
  {
    id: "prod-2",
    name: "Huile Végétale Raffinée 1L",
    category: "Alimentation",
    purchasePrice: 1100,
    sellingPrice: 1400,
    stockQuantity: 34,
    minAlertThreshold: 8,
    unit: "bouteille",
  },
  {
    id: "prod-3",
    name: "Lait Concentré Sucré 397g",
    category: "Alimentation",
    purchasePrice: 650,
    sellingPrice: 850,
    stockQuantity: 42,
    minAlertThreshold: 10,
    unit: "boîte",
  },
  {
    id: "prod-4",
    name: "Pâtes Alimentaires 500g",
    category: "Alimentation",
    purchasePrice: 350,
    sellingPrice: 500,
    stockQuantity: 4, // Stock faible !
    minAlertThreshold: 12,
    unit: "paquet",
  },
  {
    id: "prod-5",
    name: "Sucre Blanc en Morceaux 1kg",
    category: "Alimentation",
    purchasePrice: 800,
    sellingPrice: 1000,
    stockQuantity: 2, // Stock critique !
    minAlertThreshold: 10,
    unit: "paquet",
  },
  {
    id: "prod-6",
    name: "Savon de Ménage Gros Morceau",
    category: "Hygiène & Entretien",
    purchasePrice: 300,
    sellingPrice: 450,
    stockQuantity: 28,
    minAlertThreshold: 10,
    unit: "morceau",
  },
  {
    id: "prod-7",
    name: "Boisson Gazeuse Canette 33cl",
    category: "Boissons",
    purchasePrice: 400,
    sellingPrice: 600,
    stockQuantity: 20,
    minAlertThreshold: 6,
    unit: "canette",
  },
  {
    id: "prod-8",
    name: "Paquet d'Allumettes (lot de 10)",
    category: "Divers",
    purchasePrice: 350,
    sellingPrice: 500,
    stockQuantity: 15,
    minAlertThreshold: 5,
    unit: "paquet",
  }
];

export const initialCustomers: Customer[] = [
  {
    id: "cust-1",
    name: "Mme Fatou Bamba",
    phone: "+2250708091011",
    address: "Angré Terminus 81",
    totalDebt: 14500,
    creditLimit: 30000,
    notes: "Bonne payeuse en fin de mois. Fonctionnaire.",
    createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
    payments: [
      {
        id: "pay-1",
        date: new Date(Date.now() - 15 * 86400000).toISOString(),
        amount: 20000,
        paymentMethod: "wave",
        note: "Règlement partiel salaire"
      }
    ],
    lastReminderSentDate: new Date(Date.now() - 5 * 86400000).toISOString()
  },
  {
    id: "cust-2",
    name: "M. Ibrahima Diop",
    phone: "+221776543210",
    address: "Rue du Marché",
    totalDebt: 8500,
    creditLimit: 20000,
    notes: "Prend souvent à crédit le vendredi, règle par Orange Money",
    createdAt: new Date(Date.now() - 40 * 86400000).toISOString(),
    payments: [
      {
        id: "pay-2",
        date: new Date(Date.now() - 7 * 86400000).toISOString(),
        amount: 5000,
        paymentMethod: "orange_money",
        note: "Avance Orange Money"
      }
    ]
  },
  {
    id: "cust-3",
    name: "M. Koffi Jean-Baptiste",
    phone: "+2250544332211",
    address: "Carrefour Glacier",
    totalDebt: 22000,
    creditLimit: 25000,
    notes: "Dette ancienne, relance WhatsApp nécessaire",
    createdAt: new Date(Date.now() - 90 * 86400000).toISOString(),
    payments: []
  }
];

export const initialSuppliers: Supplier[] = [
  {
    id: "sup-1",
    name: "Ets Bamba & Frères (Grossiste Denrées)",
    phone: "+2250755443322",
    companyOrMarket: "Grand Marché d'Adjamé Roxy",
    address: "Allée des Grossistes Riz & Sucre",
    totalDebt: 185000,
    dueDate: new Date(Date.now() + 12 * 86400000).toISOString(),
    notes: "Livraison 30 sacs de riz et 15 cartons d'huile. Accord de paiement fin de quinzaine.",
    createdAt: new Date(Date.now() - 45 * 86400000).toISOString(),
    payments: [
      {
        id: "spay-1",
        date: new Date(Date.now() - 8 * 86400000).toISOString(),
        amount: 150000,
        paymentMethod: "wave",
        note: "Acompte par Wave pro"
      }
    ]
  },
  {
    id: "sup-2",
    name: "Comptoir Ouest-Africain de Boissons",
    phone: "+2250505123456",
    companyOrMarket: "Zone Industrielle Yopougon",
    address: "Dépôt Central Boissons",
    totalDebt: 75000,
    dueDate: new Date(Date.now() + 5 * 86400000).toISOString(),
    notes: "Livraison 25 casiers de boissons gazeuses et canettes. Règlement par Orange Money.",
    createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    payments: [
      {
        id: "spay-2",
        date: new Date(Date.now() - 14 * 86400000).toISOString(),
        amount: 80000,
        paymentMethod: "orange_money",
        note: "Versement acompte quinzaine"
      }
    ]
  },
  {
    id: "sup-3",
    name: "Savonnerie & Produits d'Hygiène CI",
    phone: "+2250102030405",
    companyOrMarket: "Abobo Avocatier",
    address: "Fabrique & Entrepôt",
    totalDebt: 35000,
    dueDate: new Date(Date.now() + 20 * 86400000).toISOString(),
    notes: "Cartons de savon de ménage et détergents.",
    createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
    payments: []
  }
];

// Generate realistic sales over the past 6 months (180 days)
export function generateInitialSales(): Sale[] {
  const sales: Sale[] = [];
  const now = Date.now();
  
  // Growth multipliers from 6 months ago to now:
  // Month -5 (~150-180 days ago): base ~450k-550k/mo
  // Month -4 (~120-150 days ago): ~580k-650k/mo
  // Month -3 (~90-120 days ago): ~700k-780k/mo
  // Month -2 (~60-90 days ago): ~820k-900k/mo
  // Month -1 (~30-60 days ago): ~950k-1.05M/mo
  // Month 0 (past 30 days): ~1.1M-1.25M/mo
  
  // We generate sales distributed over 180 days
  for (let d = 179; d >= 0; d--) {
    // Skip some days (e.g., Sundays or slower days)
    if (d % 7 === 0 && d > 14) continue;
    
    const dayTimestamp = now - d * 86400000;
    const monthIndex = Math.floor(d / 30); // 5 (oldest) down to 0 (recent)
    
    // Recent days have more transactions (representing merchant business growth)
    const baseSalesPerDay = monthIndex >= 4 ? 2 : monthIndex >= 2 ? 3 : 5;
    const numSales = d < 5 ? 5 : (d % 2 === 0 ? baseSalesPerDay : baseSalesPerDay + 1);

    for (let s = 0; s < numSales; s++) {
      const saleDate = new Date(dayTimestamp + (s * 3600000) + Math.floor(Math.random() * 1800000)).toISOString();
      const invoiceNumber = `FAC-${new Date(saleDate).getFullYear()}-${String(sales.length + 101).padStart(4, '0')}`;
      
      const isMobile = Math.random() > 0.45;
      const paymentMethod = isMobile ? (Math.random() > 0.5 ? 'wave' : 'orange_money') : 'cash';
      
      // Randomize cart items slightly
      const variant = (d + s) % 3;
      let items = [];
      let subtotal = 0;
      let totalCost = 0;

      if (variant === 0) {
        items = [
          {
            productId: "prod-1",
            productName: "Riz Parfumé Jasmin 5kg",
            quantity: 1,
            unitPrice: 4700,
            totalPrice: 4700,
            costPrice: 3800,
          },
          {
            productId: "prod-2",
            productName: "Huile Végétale Raffinée 1L",
            quantity: 2,
            unitPrice: 1400,
            totalPrice: 2800,
            costPrice: 1100,
          }
        ];
        subtotal = 7500;
        totalCost = 6000;
      } else if (variant === 1) {
        items = [
          {
            productId: "prod-3",
            productName: "Lait Concentré Sucré 397g",
            quantity: 3,
            unitPrice: 850,
            totalPrice: 2550,
            costPrice: 650,
          },
          {
            productId: "prod-4",
            productName: "Pâtes Alimentaires 500g",
            quantity: 4,
            unitPrice: 500,
            totalPrice: 2000,
            costPrice: 350,
          },
          {
            productId: "prod-5",
            productName: "Sucre Blanc en Morceaux 1kg",
            quantity: 2,
            unitPrice: 1000,
            totalPrice: 2000,
            costPrice: 800,
          }
        ];
        subtotal = 6550;
        totalCost = 4950;
      } else {
        items = [
          {
            productId: "prod-6",
            productName: "Savon de Ménage Gros Morceau",
            quantity: 4,
            unitPrice: 450,
            totalPrice: 1800,
            costPrice: 300,
          },
          {
            productId: "prod-7",
            productName: "Boisson Gazeuse Canette 33cl",
            quantity: 6,
            unitPrice: 600,
            totalPrice: 3600,
            costPrice: 400,
          }
        ];
        subtotal = 5400;
        totalCost = 3600;
      }

      sales.push({
        id: `sale-${d}-${s}`,
        date: saleDate,
        items,
        subtotal,
        discount: 0,
        total: subtotal,
        totalCost,
        profit: subtotal - totalCost,
        paymentMethod,
        amountPaid: subtotal,
        changeGiven: 0,
        isCredit: false,
        status: 'completed',
        invoiceNumber
      });
    }
  }

  // Add credit sale for Mme Bamba
  sales.push({
    id: "sale-credit-1",
    date: new Date(now - 3 * 86400000).toISOString(),
    items: [
      {
        productId: "prod-1",
        productName: "Riz Parfumé Jasmin 5kg",
        quantity: 2,
        unitPrice: 4700,
        totalPrice: 9400,
        costPrice: 3800,
      },
      {
        productId: "prod-3",
        productName: "Lait Concentré Sucré 397g",
        quantity: 6,
        unitPrice: 850,
        totalPrice: 5100,
        costPrice: 650,
      }
    ],
    subtotal: 14500,
    discount: 0,
    total: 14500,
    totalCost: 11500,
    profit: 3000,
    paymentMethod: 'credit',
    amountPaid: 0,
    changeGiven: 0,
    customerId: "cust-1",
    customerName: "Mme Fatou Bamba",
    isCredit: true,
    creditDueDate: new Date(now + 10 * 86400000).toISOString(),
    status: 'completed',
    invoiceNumber: `FAC-CRD-${new Date().getFullYear()}-002`
  });

  return sales;
}

export const initialExpenses: Expense[] = [
  {
    id: "exp-1",
    date: new Date(Date.now() - 1 * 86400000).toISOString(),
    title: "Transport marchandises (Gbaka & Chariot)",
    amount: 3500,
    category: "transport",
    paymentMethod: "cash",
    notes: "Livraison depuis le grand marché d'Adjamé"
  },
  {
    id: "exp-2",
    date: new Date(Date.now() - 3 * 86400000).toISOString(),
    title: "Facture Électricité Boutique (CIE)",
    amount: 14000,
    category: "utilities",
    paymentMethod: "orange_money",
    notes: "Compteur à prépaiement"
  },
  {
    id: "exp-3",
    date: new Date(Date.now() - 5 * 86400000).toISOString(),
    title: "Aide / Manutentionnaire déchargement",
    amount: 5000,
    category: "salary",
    paymentMethod: "cash",
    notes: "Déchargement sacs de riz et cartons d'huile"
  },
  {
    id: "exp-4",
    date: new Date(Date.now() - 10 * 86400000).toISOString(),
    title: "Taxe municipale d'occupation (ODP Mairie)",
    amount: 3000,
    category: "taxes",
    paymentMethod: "cash",
    notes: "Ticket journalier régularisé"
  },
  {
    id: "exp-5",
    date: new Date(Date.now() - 12 * 86400000).toISOString(),
    title: "Crédit téléphonique & Pass internet boutique",
    amount: 2500,
    category: "utilities",
    paymentMethod: "wave",
    notes: "Pour contact fournisseurs et WhatsApp clients"
  },
  {
    id: "exp-6",
    date: new Date(Date.now() - 35 * 86400000).toISOString(),
    title: "Loyer mensuel magasin (Mois passé)",
    amount: 60000,
    category: "rent",
    paymentMethod: "bank_transfer",
    notes: "Règlement propriétaire"
  },
  {
    id: "exp-7",
    date: new Date(Date.now() - 65 * 86400000).toISOString(),
    title: "Loyer mensuel magasin (M-2)",
    amount: 60000,
    category: "rent",
    paymentMethod: "bank_transfer",
    notes: "Règlement propriétaire"
  },
  {
    id: "exp-8",
    date: new Date(Date.now() - 95 * 86400000).toISOString(),
    title: "Loyer mensuel magasin (M-3)",
    amount: 60000,
    category: "rent",
    paymentMethod: "bank_transfer",
    notes: "Règlement propriétaire"
  },
  {
    id: "exp-9",
    date: new Date(Date.now() - 125 * 86400000).toISOString(),
    title: "Loyer mensuel magasin (M-4)",
    amount: 60000,
    category: "rent",
    paymentMethod: "bank_transfer",
    notes: "Règlement propriétaire"
  },
  {
    id: "exp-10",
    date: new Date(Date.now() - 155 * 86400000).toISOString(),
    title: "Loyer mensuel magasin (M-5)",
    amount: 60000,
    category: "rent",
    paymentMethod: "bank_transfer",
    notes: "Règlement propriétaire"
  }
];
