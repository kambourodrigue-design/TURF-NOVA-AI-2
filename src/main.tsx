import React from 'react';
import {createRoot} from 'react-dom/client';
import { DialogHost } from './components/common/dialogs';
import App from './App.tsx';
import './index.css';
import { api } from './services/api';
import { initTheme } from './services/theme';

initTheme();

// Surveillance : les erreurs inattendues sont signalées au serveur (au plus 5 par session, sans donnée personnelle).
let reported = 0;
const report = (where: string, message: string) => {
  if (reported >= 5) return;
  reported++;
  api.logClient(where, message).catch(() => { /* hors-ligne : ignoré */ });
};
window.addEventListener('error', e => report('window', `${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
window.addEventListener('unhandledrejection', e => report('promise', String((e.reason && (e.reason.message || e.reason)) || 'rejet')));

class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { report('react', error?.message || 'erreur d\'affichage'); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#0b1f66', color: '#eef3ff', textAlign: 'center', fontFamily: 'sans-serif' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800 }}>Une erreur est survenue</h1>
          <p style={{ margin: '12px 0 20px' }}>Vos données sont conservées. Rechargez l'application pour continuer.</p>
          <button onClick={() => location.reload()} style={{ padding: '10px 20px', borderRadius: 12, border: 0, fontWeight: 700 }}>Recharger</button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(<Boundary><App /><DialogHost /></Boundary>);
