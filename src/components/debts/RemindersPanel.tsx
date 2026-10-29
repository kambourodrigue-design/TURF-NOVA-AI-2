import React, { useMemo, useState } from 'react';
import { MessageCircle, BellRing } from 'lucide-react';
import { Customer, ShopSettings } from '../../types';
import { api } from '../../services/api';
import { formatCurrency } from '../../services/financials';
import { cleanPhoneNumber, generateDebtReminderWhatsAppUrl } from '../../services/whatsapp';
import { dueReminders, daysSince, REMINDER_GAP_DAYS } from '../../services/reminders';
import { Select } from '../common/dialogs';

interface Props {
  customers: Customer[];
  settings: ShopSettings;
  onUpdateCustomers: (customers: Customer[]) => void;
  /** false pour un caissier : pas de rédaction par l'IA */
  allowAi?: boolean;
}

/** Liste des clients à relancer aujourd'hui : un appui = message WhatsApp prêt à envoyer, et la relance est notée. */
export const RemindersPanel: React.FC<Props> = ({ customers, settings, onUpdateCustomers, allowAi = true }) => {
  const due = useMemo(() => dueReminders(customers), [customers]);
  const [tone, setTone] = useState<'amical' | 'ferme'>('amical');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  if (due.length === 0) return null;
  const total = due.reduce((s, c) => s + c.totalDebt, 0);

  const remind = async (c: Customer) => {
    if (busyId) return;
    setBusyId(c.id); setNote('');
    const win = window.open('about:blank', '_blank');          // évite le blocage des popups
    let url = generateDebtReminderWhatsAppUrl(c, settings);
    if (allowAi) {
      try {
        const r = await api.ai({
          mode: 'reminder', tone, firstName: (c.name || '').trim().split(/\s+/)[0],
          amount: formatCurrency(c.totalDebt, settings.currency),
          shopName: settings.shopName, ownerName: settings.ownerName, payPhone: settings.phone,
        });
        url = `https://wa.me/${cleanPhoneNumber(c.phone)}?text=${encodeURIComponent(r.text)}`;
      } catch { setNote("L'assistant n'est pas disponible : message standard utilisé."); }
    }
    if (win) win.location.href = url; else window.location.href = url;
    onUpdateCustomers(customers.map((x) => (x.id === c.id ? { ...x, lastReminderSentDate: new Date().toISOString() } : x)));
    setBusyId(null);
  };

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 space-y-3" data-testid="reminders-panel">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-black text-stone-900 text-sm flex items-center gap-1.5"><BellRing className="w-4 h-4 text-amber-600" /> {due.length} client{due.length > 1 ? 's' : ''} à relancer</h3>
          <p className="text-[11px] text-stone-600">{formatCurrency(total, settings.currency)} à récupérer. Un client déjà relancé n'apparaît plus avant {REMINDER_GAP_DAYS} jours.</p>
        </div>
        {allowAi && (
          <Select value={tone} onChange={(e) => setTone(e.target.value as 'amical' | 'ferme')} className="text-[11px] font-bold border border-amber-300 rounded-lg px-1.5 py-1 bg-white" aria-label="Ton du message">
            <option value="amical">Ton amical</option><option value="ferme">Ton ferme</option>
          </Select>
        )}
      </div>
      <div className="space-y-2">
        {due.slice(0, 8).map((c) => {
          const d = daysSince(c.lastReminderSentDate);
          return (
            <div key={c.id} className="flex items-center justify-between gap-2 bg-white rounded-xl border border-amber-200 p-2.5">
              <div className="min-w-0">
                <div className="font-bold text-sm text-stone-900 truncate">{c.name}</div>
                <div className="text-[11px] text-stone-500">{formatCurrency(c.totalDebt, settings.currency)} • {d === null ? 'jamais relancé' : `relancé il y a ${d} j`}</div>
              </div>
              <button onClick={() => remind(c)} disabled={busyId === c.id} data-testid={`remind-${c.id}`}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs active:scale-95 disabled:opacity-60">
                <MessageCircle className="w-3.5 h-3.5" />{busyId === c.id ? '…' : 'Relancer'}
              </button>
            </div>
          );
        })}
        {due.length > 8 && <p className="text-[11px] text-stone-500 text-center">+ {due.length - 8} autre(s) : relancez ceux-ci d'abord.</p>}
      </div>
      {note && <p className="text-[11px] text-amber-800">{note}</p>}
    </div>
  );
};
