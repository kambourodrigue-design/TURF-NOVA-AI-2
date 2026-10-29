import React, { useEffect, useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import { api, Announcement } from '../../services/api';

/** Messages de l'équipe Nafora : affichés en haut jusqu'à ce que l'utilisateur les ferme. */
const KEY = 'sb_ann_closed';
const closedIds = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const rememberClosed = (id: string) => { try { localStorage.setItem(KEY, JSON.stringify([...closedIds(), id].slice(-100))); } catch { /* ignore */ } };

export const AnnouncementsBar: React.FC<{ userId: string }> = ({ userId }) => {
  const [items, setItems] = useState<Announcement[]>([]);
  useEffect(() => {
    let off = false;
    const load = () => api.announcements().then(r => { if (!off) setItems(r.items.filter(a => !a.read && !closedIds().includes(a.id))); }).catch(() => { /* hors-ligne ou base non migrée */ });
    load();
    const t = setInterval(load, 10 * 60 * 1000);
    return () => { off = true; clearInterval(t); };
  }, [userId]);
  if (!items.length) return null;
  const close = (id: string) => { rememberClosed(id); setItems(l => l.filter(a => a.id !== id)); api.announcementRead(id).catch(() => { /* réessayé au prochain chargement */ }); };
  return (
    <div className="space-y-1.5 px-3 pt-2 max-w-7xl mx-auto w-full" data-testid="announcements">
      {items.slice(0, 3).map(a => (
        <div key={a.id} className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${a.level === 'important' ? 'bg-amber-50 border-amber-300 text-amber-950' : 'bg-emerald-50 border-emerald-200 text-emerald-950'}`}>
          <Megaphone className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1"><div className="font-bold">{a.title}</div><div className="whitespace-pre-wrap break-words">{a.body}</div></div>
          <button onClick={() => close(a.id)} aria-label="Fermer ce message"><X className="w-4 h-4" /></button>
        </div>
      ))}
    </div>
  );
};
