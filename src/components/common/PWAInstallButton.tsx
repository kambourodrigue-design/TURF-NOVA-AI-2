import React, { useState } from 'react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { Download, Smartphone, X, CheckCircle2 } from 'lucide-react';
import { uiAlert } from './dialogs';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already running as an installed PWA, hide the button
  if (isInstalled) {
    return (
      <div title="Application installée" className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1 text-xs font-medium text-emerald-800 bg-emerald-100/80 rounded-full border border-emerald-300">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
        <span className="hidden sm:inline xl:hidden 2xl:inline">Installé</span>
      </div>
    );
  }

  // Chromium / Android / Desktop flow
  if (isInstallable) {
    return (
      <button
        onClick={install}
        className="flex items-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-stone-900 px-2.5 sm:px-3.5 py-2 sm:py-1.5 text-xs sm:text-sm font-bold shadow-sm transition active:scale-95"
        title="Installer l'application sur votre téléphone"
      >
        <Download className="w-4 h-4 text-stone-950" />
        <span className="hidden sm:inline xl:hidden 2xl:inline">Installer l'App</span>
      </button>
    );
  }

  // iOS Safari flow
  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50 shadow-xs"
        >
          <Smartphone className="w-3.5 h-3.5 text-emerald-700" />
          <span className="hidden sm:inline">Installer</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-stone-200 animate-in fade-in zoom-in-95">
              <div className="flex items-center justify-between pb-3 border-b border-stone-100">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-800 flex items-center justify-center text-white font-bold">
                    S
                  </div>
                  <h3 className="font-bold text-stone-900">Installer Nafora sur iPhone</h3>
                </div>
                <button 
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 rounded-lg hover:bg-stone-100 text-stone-400 hover:text-stone-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-4 space-y-3 text-sm text-stone-600">
                <div className="flex items-start gap-3 p-3 bg-stone-50 rounded-xl">
                  <span className="w-6 h-6 rounded-full bg-emerald-700 text-white flex items-center justify-center text-xs font-bold shrink-0">1</span>
                  <p>Appuyez sur le bouton <strong>Partager</strong> <span className="inline-block px-1.5 py-0.5 bg-stone-200 rounded text-xs font-mono">⎋</span> dans la barre Safari en bas.</p>
                </div>

                <div className="flex items-start gap-3 p-3 bg-stone-50 rounded-xl">
                  <span className="w-6 h-6 rounded-full bg-emerald-700 text-white flex items-center justify-center text-xs font-bold shrink-0">2</span>
                  <p>Faites défiler vers le bas et touchez <strong>« Sur l'écran d'accueil »</strong> <span className="inline-block px-1.5 py-0.5 bg-stone-200 rounded text-xs">➕</span>.</p>
                </div>

                <div className="flex items-start gap-3 p-3 bg-stone-50 rounded-xl">
                  <span className="w-6 h-6 rounded-full bg-emerald-700 text-white flex items-center justify-center text-xs font-bold shrink-0">3</span>
                  <p>Validez en haut à droite en touchant <strong>Ajouter</strong>. L'application fonctionnera hors-ligne !</p>
                </div>
              </div>

              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-xl bg-emerald-700 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 transition"
              >
                J'ai compris
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  // Fallback indicator button if browser already handled or doesn't support beforeinstallprompt
  return (
    <button
      onClick={() => uiAlert("Pour installer l'application sur votre écran d'accueil : Ouvrez le menu de votre navigateur (les 3 points verticaux) puis sélectionnez « Ajouter à l'écran d'accueil ».")}
      className="flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white/80 px-2.5 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50 shadow-xs"
      title="Application Web Progressive"
    >
      <Smartphone className="w-3.5 h-3.5 text-emerald-700" />
      <span className="hidden sm:inline xl:hidden 2xl:inline">PWA Mobile</span>
    </button>
  );
};
