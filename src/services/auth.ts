import { UserAccount } from '../types';

// Cache local (pour fonctionner hors-ligne) du dernier utilisateur connecté.
const CACHE_KEY = 'soutrabiz_cached_session_v2';

export const DEMO_USER: UserAccount = {
  id: 'demo',
  email: '',
  name: 'Mamadou Konaté (Démo)',
  phone: '',
  role: 'merchant',
  shopId: 'shop-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: '2026-01-01T00:00:00.000Z',
  status: 'active',
};

export const authCache = {
  get(): UserAccount | null {
    try {
      const d = localStorage.getItem(CACHE_KEY);
      return d ? JSON.parse(d) : null;
    } catch { return null; }
  },
  set(user: UserAccount): void {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(user)); } catch { /* ignore */ }
  },
  clear(): void {
    try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
  },
};
