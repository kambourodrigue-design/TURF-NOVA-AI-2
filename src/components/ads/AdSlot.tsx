import React, { useEffect, useRef } from 'react';
import type { AdsPublic } from '../../services/api';

let scriptFor = '';
function ensureScript(client: string) {
  if (scriptFor === client || typeof document === 'undefined') return;
  scriptFor = client;
  const s = document.createElement('script');
  s.async = true; s.crossOrigin = 'anonymous';
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  document.head.appendChild(s);
}

/** Bloc publicitaire AdSense. N'affiche rien si la publicité est désactivée, hors-ligne ou sans identifiant de bloc. */
export const AdSlot: React.FC<{ ads: AdsPublic | null; slot: 'dashboard' | 'assistant' | 'debts' }> = ({ ads, slot }) => {
  const ref = useRef<HTMLModElement>(null);
  const id = ads?.enabled && ads.client ? ads.slots?.[slot] : '';
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  useEffect(() => {
    if (!id || !online || !ads?.client) return;
    ensureScript(ads.client);
    try { ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({}); } catch { /* ignore */ }
  }, [id, online, ads?.client]);
  if (!id || !online) return null;
  return (
    <div className="my-4 text-center" data-testid={`ad-${slot}`}>
      <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-1">Publicité</div>
      <ins ref={ref} className="adsbygoogle" style={{ display: 'block' }}
        data-ad-client={ads!.client} data-ad-slot={id} data-ad-format="auto" data-full-width-responsive="true" />
    </div>
  );
};
