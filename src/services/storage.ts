import { Product, Sale, Expense, Customer, Supplier, ShopSettings } from '../types';
import { 
  initialProducts, 
  initialExpenses, 
  initialCustomers, 
  initialSuppliers,
  initialShopSettings, 
  generateInitialSales 
} from '../data/initialData';

const STORAGE_KEYS = {
  PRODUCTS: 'soutrabiz_products_v1',
  SALES: 'soutrabiz_sales_v1',
  EXPENSES: 'soutrabiz_expenses_v1',
  CUSTOMERS: 'soutrabiz_customers_v1',
  SUPPLIERS: 'soutrabiz_suppliers_v1',
  SETTINGS: 'soutrabiz_settings_v1',
  LAST_SYNC: 'soutrabiz_last_sync_v1',
};

export const storage = {
  getProducts(): Product[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
      return data ? JSON.parse(data) : initialProducts;
    } catch {
      return initialProducts;
    }
  },

  saveProducts(products: Product[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
      localStorage.setItem(STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
    } catch (e) {
      console.error('Failed to save products to localStorage', e);
    }
  },

  getSales(): Sale[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SALES);
      return data ? JSON.parse(data) : generateInitialSales();
    } catch {
      return generateInitialSales();
    }
  },

  saveSales(sales: Sale[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.SALES, JSON.stringify(sales));
      localStorage.setItem(STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
    } catch (e) {
      console.error('Failed to save sales to localStorage', e);
    }
  },

  getExpenses(): Expense[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.EXPENSES);
      return data ? JSON.parse(data) : initialExpenses;
    } catch {
      return initialExpenses;
    }
  },

  saveExpenses(expenses: Expense[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.EXPENSES, JSON.stringify(expenses));
      localStorage.setItem(STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
    } catch (e) {
      console.error('Failed to save expenses to localStorage', e);
    }
  },

  getCustomers(): Customer[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.CUSTOMERS);
      return data ? JSON.parse(data) : initialCustomers;
    } catch {
      return initialCustomers;
    }
  },

  saveCustomers(customers: Customer[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify(customers));
      localStorage.setItem(STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
    } catch (e) {
      console.error('Failed to save customers to localStorage', e);
    }
  },

  getSuppliers(): Supplier[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SUPPLIERS);
      return data ? JSON.parse(data) : initialSuppliers;
    } catch {
      return initialSuppliers;
    }
  },

  saveSuppliers(suppliers: Supplier[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.SUPPLIERS, JSON.stringify(suppliers));
      localStorage.setItem(STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
    } catch (e) {
      console.error('Failed to save suppliers to localStorage', e);
    }
  },

  getSettings(): ShopSettings {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      return data ? JSON.parse(data) : initialShopSettings;
    } catch {
      return initialShopSettings;
    }
  },

  saveSettings(settings: ShopSettings): void {
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    } catch (e) {
      console.error('Failed to save settings to localStorage', e);
    }
  },

  exportBackupJson(): string {
    const backup = {
      exportDate: new Date().toISOString(),
      app: 'Nafora',
      version: '1.0',
      settings: this.getSettings(),
      products: this.getProducts(),
      sales: this.getSales(),
      expenses: this.getExpenses(),
      customers: this.getCustomers(),
      suppliers: this.getSuppliers(),
    };
    return JSON.stringify(backup, null, 2);
  },

  importBackupJson(jsonString: string): boolean {
    try {
      const data = JSON.parse(jsonString);
      if (data.products && Array.isArray(data.products)) {
        this.saveProducts(data.products);
      }
      if (data.sales && Array.isArray(data.sales)) {
        this.saveSales(data.sales);
      }
      if (data.expenses && Array.isArray(data.expenses)) {
        this.saveExpenses(data.expenses);
      }
      if (data.customers && Array.isArray(data.customers)) {
        this.saveCustomers(data.customers);
      }
      if (data.suppliers && Array.isArray(data.suppliers)) {
        this.saveSuppliers(data.suppliers);
      }
      if (data.settings) {
        this.saveSettings(data.settings);
      }
      return true;
    } catch (e) {
      console.error('Invalid backup file', e);
      return false;
    }
  },

  clearAll(): void {
    this.saveProducts([]);
    this.saveSales([]);
    this.saveExpenses([]);
    this.saveCustomers([]);
    this.saveSuppliers([]);
  },

  /** Efface tout le cache local (déconnexion) : les valeurs par défaut (démo) reviendront. */
  wipeLocal(): void {
    Object.values(STORAGE_KEYS).forEach(k => {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    });
  },

  resetToDemo(): void {
    localStorage.removeItem(STORAGE_KEYS.PRODUCTS);
    localStorage.removeItem(STORAGE_KEYS.SALES);
    localStorage.removeItem(STORAGE_KEYS.EXPENSES);
    localStorage.removeItem(STORAGE_KEYS.CUSTOMERS);
    localStorage.removeItem(STORAGE_KEYS.SUPPLIERS);
    localStorage.removeItem(STORAGE_KEYS.SETTINGS);
  }
};
