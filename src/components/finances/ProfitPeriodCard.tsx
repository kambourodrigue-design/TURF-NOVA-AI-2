import React, { useMemo, useState } from 'react';
import { Sale, Expense, ShopSettings } from '../../types';
import { formatCurrency, localDay } from '../../services/financials';
import { CalendarRange } from 'lucide-react';

interface Props {
  sales: Sale[];
  expenses: Expense[];
  settings: ShopSettings;
}

type Preset = 'this' | 'last' | '3m' | 'year' | 'custom';

const monthKeyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const shiftMonth = (offset: number) => {
  const n = new Date();
  return monthKeyOf(new Date(n.getFullYear(), n.getMonth() + offset, 1));
};
const monthName = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
};
const monthsBetween = (from: string, to: string) => {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length < 120) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
};

export const ProfitPeriodCard: React.FC<Props> = ({ sales, expenses, settings }) => {
  const [preset, setPreset] = useState<Preset>('last');
  const [customFrom, setCustomFrom] = useState(shiftMonth(-2));
  const [customTo, setCustomTo] = useState(shiftMonth(0));

  const nowKey = shiftMonth(0);
  const range = useMemo(() => {
    switch (preset) {
      case 'this': return { from: nowKey, to: nowKey };
      case 'last': return { from: shiftMonth(-1), to: shiftMonth(-1) };
      case '3m': return { from: shiftMonth(-2), to: nowKey };
      case 'year': return { from: `${new Date().getFullYear()}-01`, to: nowKey };
      default: {
        // si l'utilisateur inverse les dates, on les remet dans l'ordre
        return customFrom <= customTo ? { from: customFrom, to: customTo } : { from: customTo, to: customFrom };
      }
    }
  }, [preset, customFrom, customTo, nowKey]);

  const rows = useMemo(() => {
    return monthsBetween(range.from, range.to).map(key => {
      const mSales = sales.filter(s => s.status !== 'cancelled' && localDay(s.date).startsWith(key));
      const mExp = expenses.filter(e => localDay(e.date).startsWith(key));
      const revenue = mSales.reduce((a, s) => a + s.total, 0);
      const grossProfit = mSales.reduce((a, s) => a + s.profit, 0);
      // même règle que partout : hors achats de marchandises (déjà dans le coût des ventes) et prélèvements perso
      const charges = mExp.filter(e => e.category !== 'supply' && e.category !== 'personal_draw').reduce((a, e) => a + e.amount, 0);
      return { key, revenue, grossProfit, charges, net: grossProfit - charges, count: mSales.length };
    });
  }, [sales, expenses, range]);

  const tot = useMemo(() => rows.reduce((a, r) => ({
    revenue: a.revenue + r.revenue, grossProfit: a.grossProfit + r.grossProfit,
    charges: a.charges + r.charges, net: a.net + r.net, count: a.count + r.count,
  }), { revenue: 0, grossProfit: 0, charges: 0, net: 0, count: 0 }), [rows]);

  const margin = tot.revenue > 0 ? (tot.net / tot.revenue) * 100 : 0;
  const label = range.from === range.to ? monthName(range.from) : `${monthName(range.from)} → ${monthName(range.to)}`;
  const cur = settings.currency;

  const presets: { id: Preset; label: string }[] = [
    { id: 'this', label: 'Ce mois' },
    { id: 'last', label: 'Mois dernier' },
    { id: '3m', label: '3 derniers mois' },
    { id: 'year', label: 'Cette année' },
    { id: 'custom', label: 'Personnalisé' },
  ];

  return (
    <div className="bg-white rounded-2xl p-4 sm:p-5 border border-stone-200 shadow-xs space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-800 flex items-center justify-center">
          <CalendarRange className="w-4 h-4" />
        </div>
        <div>
          <h3 className="font-extrabold text-stone-900 text-sm sm:text-base">Bénéfice par période</h3>
          <p className="text-[11px] text-stone-500">Choisissez un mois ou une plage de mois.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {presets.map(p => (
          <button
            key={p.id}
            onClick={() => setPreset(p.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${
              preset === p.id ? 'bg-emerald-800 text-white border-emerald-800' : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === 'custom' && (
        <div className="grid grid-cols-2 gap-2 max-w-md">
          <label className="text-[11px] font-semibold text-stone-500">
            De (mois)
            <input type="month" value={customFrom} max={nowKey} onChange={e => e.target.value && setCustomFrom(e.target.value)}
              className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900" />
          </label>
          <label className="text-[11px] font-semibold text-stone-500">
            À (mois)
            <input type="month" value={customTo} max={nowKey} onChange={e => e.target.value && setCustomTo(e.target.value)}
              className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900" />
          </label>
        </div>
      )}

      <div className="rounded-2xl bg-emerald-50/70 border border-emerald-100 p-4">
        <div className="text-[11px] font-semibold text-stone-500 capitalize">{label}</div>
        <div className={`text-2xl sm:text-3xl font-black font-mono-num mt-0.5 ${tot.net < 0 ? 'text-rose-600' : 'text-emerald-800'}`}>
          {formatCurrency(tot.net, cur)}
        </div>
        <div className="text-[11px] text-stone-500 mt-0.5">
          Bénéfice net · marge nette {margin.toFixed(0)}% · {tot.count} vente(s)
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3 text-center">
          <div className="rounded-xl bg-white/70 border border-stone-100 p-2">
            <div className="text-[10px] text-stone-500">Ventes</div>
            <div className="text-xs sm:text-sm font-black text-stone-900 font-mono-num">{formatCurrency(tot.revenue, cur)}</div>
          </div>
          <div className="rounded-xl bg-white/70 border border-stone-100 p-2">
            <div className="text-[10px] text-stone-500">Marge brute</div>
            <div className="text-xs sm:text-sm font-black text-stone-900 font-mono-num">{formatCurrency(tot.grossProfit, cur)}</div>
          </div>
          <div className="rounded-xl bg-white/70 border border-stone-100 p-2">
            <div className="text-[10px] text-stone-500">Charges</div>
            <div className="text-xs sm:text-sm font-black text-rose-600 font-mono-num">-{formatCurrency(tot.charges, cur)}</div>
          </div>
        </div>
      </div>

      {rows.length > 1 && (
        <div className="divide-y divide-stone-100 rounded-xl border border-stone-100 overflow-hidden">
          {rows.map(r => (
            <div key={r.key} className="flex items-center justify-between px-3 py-2 text-xs">
              <span className="font-semibold text-stone-700 capitalize">{monthName(r.key)}</span>
              <span className={`font-mono-num font-black ${r.net < 0 ? 'text-rose-600' : 'text-emerald-800'}`}>{formatCurrency(r.net, cur)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
