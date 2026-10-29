import React from 'react';
import { Supplier, CurrencyCode } from '../../types';
import { formatCurrency } from '../../services/financials';
import { Select } from './dialogs';

interface Props {
  total: number;
  currency: CurrencyCode;
  suppliers: Supplier[];
  supplierId: string;
  setSupplierId: (v: string) => void;
  newSupplierName: string;
  setNewSupplierName: (v: string) => void;
  paid: number;
  setPaid: (v: number) => void;
}

/** Choix du fournisseur + montant payé maintenant : le reste devient une dette fournisseur. */
export const SupplierCreditFields: React.FC<Props> = ({
  total, currency, suppliers, supplierId, setSupplierId, newSupplierName, setNewSupplierName, paid, setPaid,
}) => {
  const credit = Math.max(0, total - Math.min(paid, total));
  const hasSupplier = !!supplierId || !!newSupplierName.trim();
  const field = 'w-full mt-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm';
  return (
    <div className="p-3 rounded-2xl bg-indigo-50/60 border border-indigo-200 space-y-2.5">
      <div className="text-xs font-extrabold text-indigo-900">🚚 Fournisseur & paiement</div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[11px] font-bold text-stone-700">Fournisseur</label>
          <Select className={field} value={supplierId} onChange={(e) => { setSupplierId(e.target.value); if (e.target.value) setNewSupplierName(''); }}>
            <option value="">— Aucun / nouveau —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.totalDebt > 0 ? ` (doit ${Math.round(s.totalDebt)})` : ''}</option>)}
          </Select>
        </div>
        <div>
          <label className="text-[11px] font-bold text-stone-700">Ou nouveau fournisseur</label>
          <input className={field} placeholder="Nom du grossiste" value={newSupplierName} disabled={!!supplierId}
            onChange={(e) => setNewSupplierName(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="text-[11px] font-bold text-stone-700">Payé maintenant ({currency})</label>
        <input type="number" min="0" max={total} className={field + ' font-mono-num font-bold'} value={paid}
          onChange={(e) => setPaid(Math.min(total, Math.max(0, Number(e.target.value))))} />
        <div className="flex gap-1.5 mt-1.5">
          <button type="button" onClick={() => setPaid(total)} className="px-2.5 py-1 rounded-lg bg-white border border-stone-200 text-[11px] font-bold">Tout payé</button>
          <button type="button" onClick={() => setPaid(Math.round(total / 2))} className="px-2.5 py-1 rounded-lg bg-white border border-stone-200 text-[11px] font-bold">Moitié</button>
          <button type="button" onClick={() => setPaid(0)} className="px-2.5 py-1 rounded-lg bg-white border border-amber-300 text-amber-900 text-[11px] font-bold">Tout à crédit</button>
        </div>
      </div>
      {credit > 0 && (
        <div className={`text-[11px] font-semibold ${hasSupplier ? 'text-indigo-900' : 'text-rose-700'}`}>
          {hasSupplier
            ? `➜ ${formatCurrency(credit, currency)} seront ajoutés aux dettes fournisseurs.`
            : '⚠️ Choisissez ou saisissez un fournisseur pour enregistrer la dette.'}
        </div>
      )}
    </div>
  );
};
