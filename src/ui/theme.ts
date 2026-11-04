export type Theme = 'dark' | 'light';
const KEY = 'airfield.theme';

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

/** Saved choice first, then the system preference. */
export function initTheme(): void {
  const saved = stored();
  const prefersLight = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
  document.documentElement.dataset.theme = saved ?? (prefersLight ? 'light' : 'dark');
}
