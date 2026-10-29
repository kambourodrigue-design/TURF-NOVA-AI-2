import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Sparkles, Send, Lightbulb, Loader2 } from 'lucide-react';
import { Sale, Expense, Customer, Supplier, Product, ShopSettings } from '../../types';
import { api, ApiError } from '../../services/api';
import { buildAiSummary } from '../../services/aiSummary';

interface Props {
  sales: Sale[]; expenses: Expense[]; customers: Customer[]; suppliers: Supplier[];
  products: Product[]; settings: ShopSettings;
}
interface Msg { role: 'user' | 'ai'; text: string }

const QUESTIONS = [
  'Comment vont mes ventes cette semaine ?',
  'Quels produits dois-je racheter en priorité ?',
  'Quel est mon bénéfice des 30 derniers jours ?',
  'Combien d\'argent ai-je vraiment en caisse ?',
];

const errText = (e: unknown) => {
  if (e instanceof ApiError) {
    if (e.status === 0) return 'Pas de connexion internet : l\'assistant a besoin d\'être en ligne.';
    return e.message;
  }
  return 'Une erreur est survenue. Réessayez.';
};

export const AssistantView: React.FC<Props> = ({ sales, expenses, customers, suppliers, products, settings }) => {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [advice, setAdvice] = useState<string>('');
  const [adviceErr, setAdviceErr] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const summary = useMemo(
    () => buildAiSummary(sales, expenses, customers, suppliers, products, settings),
    [sales, expenses, customers, suppliers, products, settings],
  );
  const adviceKey = `soutrabiz_advice_${settings.shopId}_${new Date().toISOString().slice(0, 10)}`;

  useEffect(() => {
    try { const c = localStorage.getItem(adviceKey); if (c) setAdvice(c); } catch { /* ignore */ }
  }, [adviceKey]);
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [msgs, busy]);

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    setMsgs(m => [...m, { role: 'user', text }]);
    setQ(''); setBusy(true);
    try {
      const r = await api.ai({ mode: 'ask', summary, question: text });
      setMsgs(m => [...m, { role: 'ai', text: r.text }]);
      setRemaining(r.remaining);
    } catch (e) {
      setMsgs(m => [...m, { role: 'ai', text: '⚠️ ' + errText(e) }]);
    } finally { setBusy(false); }
  };

  const getAdvice = async () => {
    if (busy) return;
    setBusy(true); setAdviceErr('');
    try {
      const r = await api.ai({ mode: 'advice', summary });
      setAdvice(r.text); setRemaining(r.remaining);
      try { localStorage.setItem(adviceKey, r.text); } catch { /* ignore */ }
    } catch (e) { setAdviceErr(errText(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-amber-500" />
        <h2 className="text-lg font-extrabold text-stone-900">Assistant ✨</h2>
        {remaining !== null && <span className="ml-auto text-xs text-stone-500">{remaining} question(s) restante(s) aujourd'hui</span>}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-bold text-amber-900 text-sm"><Lightbulb className="w-4 h-4" /> Conseils du jour</div>
          <button onClick={getAdvice} disabled={busy} data-testid="advice-btn"
            className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold disabled:opacity-50">
            {advice ? 'Actualiser' : 'Obtenir mes conseils'}
          </button>
        </div>
        {advice && <p className="text-sm text-stone-800 whitespace-pre-wrap" data-testid="advice-text">{advice}</p>}
        {adviceErr && <p className="text-xs text-red-700">{adviceErr}</p>}
      </div>

      <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {QUESTIONS.map(s => (
            <button key={s} onClick={() => ask(s)} disabled={busy}
              className="px-3 py-1.5 rounded-full bg-stone-100 hover:bg-emerald-100 text-xs text-stone-700 disabled:opacity-50">{s}</button>
          ))}
        </div>
        <div className="space-y-2 max-h-[45vh] overflow-y-auto" data-testid="chat">
          {msgs.length === 0 && <p className="text-sm text-stone-400">Posez une question sur vos ventes, votre stock, vos dettes ou votre trésorerie.</p>}
          {msgs.map((m, i) => (
            <div key={i} className={`text-sm rounded-2xl px-3 py-2 whitespace-pre-wrap max-w-[90%] ${m.role === 'user' ? 'bg-emerald-700 text-white ml-auto' : 'bg-stone-100 text-stone-800'}`}>{m.text}</div>
          ))}
          {busy && <div className="text-xs text-stone-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Réflexion…</div>}
          <div ref={endRef} />
        </div>
        <form onSubmit={e => { e.preventDefault(); ask(q); }} className="flex gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} maxLength={500} placeholder="Votre question…"
            className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-stone-300 text-sm" data-testid="ask-input" />
          <button type="submit" disabled={busy || !q.trim()} aria-label="Envoyer"
            className="px-3 rounded-xl bg-emerald-700 text-white disabled:opacity-50"><Send className="w-4 h-4" /></button>
        </form>
        <p className="text-[11px] text-stone-400">L'assistant s'appuie sur vos chiffres (sans noms ni téléphones de clients). Il peut se tromper : vérifiez avant de décider.</p>
      </div>
    </div>
  );
};
