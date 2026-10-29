// Thème clair / nuit (Nafora). Choix mémorisé sur l'appareil ; sans choix, on suit le réglage du téléphone.
export type Theme = 'light' | 'dark';
const KEY = 'sb-theme';
const META_COLOR: Record<Theme, string> = { light: '#0b1f66', dark: '#050b24' };

export function storedTheme(): Theme | null {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : null; } catch { return null; }
}
export function currentTheme(): Theme {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) return 'dark';
  return storedTheme() || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
export function applyTheme(t: Theme, animate = false) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add('theme-anim');
    window.setTimeout(() => root.classList.remove('theme-anim'), 350);
  }
  root.classList.toggle('dark', t === 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META_COLOR[t]);
}
export function setTheme(t: Theme) {
  try { localStorage.setItem(KEY, t); } catch { /* stockage indisponible : le choix vaut pour cette session */ }
  applyTheme(t, true);
  window.dispatchEvent(new CustomEvent('sb-theme', { detail: t }));
}
/** À appeler une fois au démarrage : applique le thème et suit le téléphone tant que l'utilisateur n'a pas choisi. */
export function initTheme() {
  applyTheme(currentTheme());
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => {
    if (!storedTheme()) applyTheme(e.matches ? 'dark' : 'light', true);
  });
}
