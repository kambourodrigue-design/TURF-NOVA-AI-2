import React, { useEffect, useRef, useState } from 'react';
import { Mic, X, Loader2, Check } from 'lucide-react';
import { Product, Customer } from '../../types';
import { analyseSale, matchProduct, VoiceResult } from '../../services/voiceSale';
import { Select } from '../common/dialogs';

interface Props {
  products: Product[];
  customers: Customer[];
  onClose: () => void;
  onApply: (lines: { product: Product; qty: number }[], payment: VoiceResult['payment'], customerId: string | null) => void;
}

export const VoiceSaleModal: React.FC<Props> = ({ products, customers, onClose, onApply }) => {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<VoiceResult | null>(null);
  const [err, setErr] = useState('');
  const recRef = useRef<any>(null);
  const SR: any = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;

  useEffect(() => () => { try { recRef.current?.abort(); } catch { /* ignore */ } }, []);

  const start = () => {
    if (!SR) return;
    setErr(''); setRes(null);
    const r = new SR();
    r.lang = 'fr-FR'; r.interimResults = true; r.continuous = false;
    r.onresult = (e: any) => setText(Array.from(e.results).map((x: any) => x[0].transcript).join(' '));
    r.onerror = (e: any) => { setListening(false); setErr(e.error === 'not-allowed' ? 'Micro refusé : autorisez-le dans le navigateur, ou tapez la phrase.' : e.error === 'no-speech' ? "Rien entendu, réessayez." : 'Reconnaissance vocale indisponible : tapez la phrase.'); };
    r.onend = () => setListening(false);
    recRef.current = r; setListening(true);
    try { r.start(); } catch { setListening(false); }
  };
  const stop = () => { try { recRef.current?.stop(); } catch { /* ignore */ } };

  const analyse = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setErr('');
    try { setRes(await analyseSale(text, products, customers)); } finally { setBusy(false); }
  };
  const setQty = (i: number, q: number) => setRes(r => r && ({ ...r, lines: r.lines.map((l, k) => k === i ? { ...l, qty: Math.max(1, q || 1) } : l) }));
  const setProd = (i: number, id: string) => setRes(r => r && ({ ...r, lines: r.lines.map((l, k) => k === i ? { ...l, product: products.find(p => p.id === id) || null } : l) }));
  const ok = res?.lines.filter(l => l.product) ?? [];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog">
      <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl p-4 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-extrabold text-stone-900">Dicter une vente</h3>
          <button onClick={onClose} aria-label="Fermer"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-stone-500">Ex : « deux sucre, une huile et trois savons, à crédit pour Moussa ».</p>
        <div className="flex gap-2">
          {SR && (
            <button onClick={listening ? stop : start} data-testid="mic-btn" aria-label="Micro"
              className={`w-12 h-12 shrink-0 rounded-full flex items-center justify-center text-white ${listening ? 'bg-rose-600 animate-pulse' : 'bg-emerald-700'}`}>
              <Mic className="w-5 h-5" />
            </button>
          )}
          <textarea value={text} onChange={e => { setText(e.target.value); setRes(null); }} rows={2} maxLength={300} data-testid="voice-text"
            placeholder={SR ? 'Appuyez sur le micro ou tapez…' : 'Tapez la vente (ou utilisez le micro du clavier)…'}
            className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-stone-300 text-sm" />
        </div>
        {err && <p className="text-xs text-red-700">{err}</p>}
        {!res && (
          <button onClick={analyse} disabled={!text.trim() || busy} data-testid="voice-analyse"
            className="w-full py-2.5 rounded-xl bg-emerald-700 text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
            {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Analyse…</> : 'Analyser'}
          </button>
        )}
        {res && (
          <div className="space-y-2" data-testid="voice-result">
            {res.lines.length === 0 && <p className="text-sm text-stone-500">Aucun article compris. Reformulez la phrase.</p>}
            {res.lines.map((l, i) => (
              <div key={i} className={`flex items-center gap-2 p-2 rounded-xl border ${l.product ? 'border-emerald-200 bg-emerald-50' : 'border-amber-300 bg-amber-50'}`}>
                <input type="number" min={1} value={l.qty} onChange={e => setQty(i, parseInt(e.target.value, 10))} className="w-14 px-2 py-1 rounded-lg border border-stone-300 text-sm" />
                <Select value={l.product?.id || ''} onChange={e => setProd(i, e.target.value)} className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-stone-300 text-sm">
                  <option value="">« {l.label} » : choisir…</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
                {l.product && l.qty > l.product.stockQuantity && <span className="text-[10px] text-rose-700 font-bold">Stock {l.product.stockQuantity}</span>}
              </div>
            ))}
            {res.payment && <p className="text-xs text-stone-600">Paiement détecté : <b>{res.payment === 'credit' ? 'à crédit' : res.payment === 'mobile' ? 'mobile money (à choisir à l\'encaissement)' : 'espèces'}</b>{res.customerId ? ` • client : ${customers.find(c => c.id === res.customerId)?.name}` : ''}</p>}
            {!res.viaAi && <p className="text-[11px] text-stone-400">Analyse simple (IA indisponible) : vérifiez les articles.</p>}
            <div className="flex gap-2">
              <button onClick={() => setRes(null)} className="px-3 py-2 rounded-xl bg-stone-100 text-sm font-bold">Modifier</button>
              <button disabled={ok.length === 0} data-testid="voice-apply"
                onClick={() => { onApply(ok.map(l => ({ product: l.product!, qty: l.qty })), res.payment, res.customerId); onClose(); }}
                className="flex-1 py-2 rounded-xl bg-emerald-700 text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-1">
                <Check className="w-4 h-4" /> Ajouter au panier ({ok.length})
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
export { matchProduct };
