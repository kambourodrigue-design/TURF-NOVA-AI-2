import React, { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { currentTheme, setTheme, type Theme } from '../../services/theme';

/** Bouton soleil / lune : bascule entre mode clair et mode nuit. */
export const ThemeToggle: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [theme, setT] = useState<Theme>(currentTheme());
  useEffect(() => {
    const on = () => setT(currentTheme());
    window.addEventListener('sb-theme', on);
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', on);
    return () => { window.removeEventListener('sb-theme', on); mq?.removeEventListener?.('change', on); };
  }, []);
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      className={`p-2 rounded-xl bg-emerald-800 hover:bg-emerald-700 text-amber-300 transition active:scale-95 ${className}`}
      title={dark ? 'Passer en mode clair' : 'Passer en mode nuit'}
      aria-label={dark ? 'Passer en mode clair' : 'Passer en mode nuit'}
      data-testid="theme-toggle"
    >
      {dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
    </button>
  );
};
