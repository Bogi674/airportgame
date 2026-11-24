export type Theme = 'dark' | 'light';
const KEY = 'airfield.theme';
const MOTION_KEY = 'airfield.reducedMotion';

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode: the choice lasts for this session only */
  }
}

/** Reduced motion (T35): the saved choice, else the system preference. Stops the menu camera drift. */
export function reducedMotion(): boolean {
  try {
    const v = localStorage.getItem(MOTION_KEY);
    if (v === '1' || v === '0') return v === '1';
  } catch {
    /* private mode: fall back to the system preference */
  }
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function setReducedMotion(on: boolean): void {
  try {
    localStorage.setItem(MOTION_KEY, on ? '1' : '0');
  } catch {
    /* private mode: the choice lasts for this session only */
  }
}

/** Saved choice first, then the system preference. */
export function initTheme(): void {
  const saved = stored();
  const prefersLight = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
  document.documentElement.dataset.theme = saved ?? (prefersLight ? 'light' : 'dark');
}
