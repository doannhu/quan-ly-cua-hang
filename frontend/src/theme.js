// Appearance preference: 'auto' (follow the device), 'light' or 'dark'. Stored per device.
const KEY = 'theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function getTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyTheme(theme = getTheme()) {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  const dark = theme === 'dark' || (theme === 'auto' && media.matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#f2f2f7');
}

export function setTheme(theme) {
  try {
    if (theme === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    /* storage unavailable: still apply for this session */
  }
  applyTheme(theme);
}

// keep the browser bar color in sync when the device switches light/dark in "auto"
media.addEventListener?.('change', () => applyTheme());
