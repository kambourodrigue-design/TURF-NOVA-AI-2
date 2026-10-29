import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { ShopSettings, Sale } from '../../types';
import { Star, X } from 'lucide-react';

interface Props { settings: ShopSettings; sales: Sale[] }

const DISMISS_KEY = 'nafora-feedback-dismissed';
const MIN_SALES = 10;   // on ne demande l'avis qu'après un vrai usage

export const FeedbackCard: React.FC<Props> = ({ settings, sales }) => {
  const [state, setState] = useState<'loading' | 'hidden' | 'ask' | 'form' | 'thanks'>('loading');
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let dismissed = false;
    try { const t = Number(localStorage.getItem(DISMISS_KEY) || 0); dismissed = t > Date.now() - 7 * 86400000; } catch { /* ignore */ }
    if (dismissed || sales.filter(s => s.status !== 'cancelled').length < MIN_SALES) { setState('hidden'); return; }
    api.feedback().then(r => setState(r.feedback ? 'hidden' : 'ask')).catch(() => setState('hidden'));
  }, [sales.length]);

  if (state === 'loading' || state === 'hidden') return null;

  const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ } setState('hidden'); };

  const send = async () => {
    setErr('');
    if (!rating) { setErr('Choisissez une note.'); return; }
    if (text.trim().length < 10) { setErr('Écrivez au moins une phrase.'); return; }
    setBusy(true);
    try {
      await api.feedbackSend({ rating, text, consent, name, shopLabel: settings.shopName || '', city: settings.city || '' });
      setState('thanks');
    } catch (e: any) { setErr(e?.message || "Envoi impossible, réessayez."); }
    finally { setBusy(false); }
  };

  if (state === 'thanks') {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 flex items-start justify-between gap-3">
        <span>🙏 Merci pour votre avis, il nous aide à améliorer Nafora.</span>
        <button onClick={() => setState('hidden')} aria-label="Fermer"><X className="w-4 h-4" /></button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-extrabold text-stone-900 text-sm">Votre avis compte 🙏</h3>
          <p className="text-xs text-stone-600">Que pensez-vous de Nafora jusqu'ici ?</p>
        </div>
        <button onClick={dismiss} aria-label="Plus tard" className="text-stone-400 hover:text-stone-700"><X className="w-4 h-4" /></button>
      </div>

      {state === 'ask' ? (
        <button onClick={() => setState('form')} className="px-4 py-2 rounded-xl bg-emerald-800 text-white text-sm font-bold">Donner mon avis (1 minute)</button>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-1" role="radiogroup" aria-label="Note">
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} sur 5`} className="p-0.5">
                <Star className={`w-7 h-7 ${n <= rating ? 'fill-amber-400 text-amber-400' : 'text-stone-300'}`} />
              </button>
            ))}
          </div>
          <textarea value={text} onChange={e => setText(e.target.value)} maxLength={400} rows={3} placeholder="Ce qui vous plaît, ce qui a changé pour vous, ce qu'on peut améliorer…"
            className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white text-sm" />
          <input value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="Votre prénom (affiché si vous acceptez la publication)"
            className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white text-sm" />
          <label className="flex items-start gap-2 text-xs text-stone-700">
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5" />
            <span>J'autorise Nafora à afficher mon avis, avec mon prénom, le nom de ma boutique et ma ville, sur la page d'accueil. (Facultatif, vous pouvez refuser : l'avis nous sera quand même utile.)</span>
          </label>
          {err && <p className="text-xs font-semibold text-rose-700">{err}</p>}
          <button onClick={send} disabled={busy} className="px-4 py-2 rounded-xl bg-emerald-800 text-white text-sm font-bold disabled:opacity-60">{busy ? 'Envoi…' : 'Envoyer'}</button>
        </div>
      )}
    </div>
  );
};
