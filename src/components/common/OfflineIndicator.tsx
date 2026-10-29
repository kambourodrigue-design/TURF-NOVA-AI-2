import React, { useEffect, useRef, useState } from 'react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { WifiOff, Wifi } from 'lucide-react';

/** Pastille centrée sous l'en-tête : « Hors ligne » en permanence, « De nouveau en ligne » 3 secondes au retour du réseau. */
export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  const wasOffline = useRef(false);
  const [backOnline, setBackOnline] = useState(false);

  useEffect(() => {
    if (!isOnline) { wasOffline.current = true; setBackOnline(false); return; }
    if (wasOffline.current) {
      wasOffline.current = false;
      setBackOnline(true);
      const t = setTimeout(() => setBackOnline(false), 3000);
      return () => clearTimeout(t);
    }
  }, [isOnline]);

  if (isOnline && !backOnline) return null;
  const offline = !isOnline;

  return (
    <div className="fixed inset-x-0 top-[74px] z-50 flex justify-center px-4 pointer-events-none" role="status" aria-live="polite">
      <div
        key={offline ? 'off' : 'on'}
        className={`sb-pop inline-flex max-w-full items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-semibold leading-none shadow-lg ring-1 backdrop-blur ${
          offline ? 'bg-amber-50/95 text-amber-950 ring-amber-300' : 'bg-emerald-50/95 text-emerald-900 ring-emerald-300'
        }`}
      >
        {offline ? <WifiOff className="w-4 h-4 shrink-0 text-amber-600" /> : <Wifi className="w-4 h-4 shrink-0 text-emerald-600" />}
        <span>{offline ? 'Hors ligne · ventes enregistrées' : 'De nouveau en ligne'}</span>
      </div>
    </div>
  );
};
